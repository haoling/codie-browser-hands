// Service Worker: Codie との接続維持・ツール登録・呼び出し処理。
import { CodieAPI, APIError, normalizeDeviceUrl } from "./codie.js";
import { buildCatalog, runTool } from "./tools.js";
import { UiError, detectLang, LANGS } from "./i18n.js";

const DEFAULTS = { deviceUrl: "", creds: null, integrationId: "", confirmWrites: true, autoConnect: false, authScope: "session", catalogHash: "", lang: "" };

let ws = null;
let reconnectTimer = null;
let backoff = 3000;
let status = { state: "offline", key: "", params: {} };
let connecting = false;

async function loadConfig() {
  const c = { ...DEFAULTS, ...(await chrome.storage.local.get(null)) };
  if (!c.integrationId) { c.integrationId = crypto.randomUUID(); await chrome.storage.local.set({ integrationId: c.integrationId }); }
  return c;
}

function setStatus(state, key = "", params = {}) {
  status = { state, key, params };
  chrome.storage.session.set({ status }).catch(() => {});
  chrome.action.setBadgeText({ text: state === "online" ? "ON" : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#2e7d32" });
}

async function hashOf(value) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** カタログを登録(内容が変わったときだけ PUT)。 */
async function registerCatalog(api, cfg) {
  const tools = buildCatalog({ confirmWrites: cfg.confirmWrites });
  const hash = await hashOf({ tools, name: "Chrome" });
  const root = "/v1/api/data/user/tool-integrations/" + cfg.integrationId;
  let revision = 0, existing = null;
  try { existing = (await api.request("GET", root)).data; revision = existing.revision; }
  catch (e) { if (!(e instanceof APIError) || e.status !== 404) throw e; }
  if (existing && existing.enabled && cfg.catalogHash === hash) return;
  const res = await api.request("PUT", root, { protocol_version: "v1", expected_revision: revision, name: "Chrome", enabled: true, tools });
  await chrome.storage.local.set({ catalogHash: hash });
  return res;
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => connect().catch(() => {}), backoff);
  backoff = Math.min(backoff * 2, 60000);
}

export async function disconnect() {
  clearTimeout(reconnectTimer);
  if (ws) { const w = ws; ws = null; w.onclose = null; w.close(); }
  setStatus("offline");
}

async function connect() {
  if (connecting || ws) return;
  const cfg = await loadConfig();
  if (!cfg.deviceUrl || !cfg.creds) { setStatus("offline", "m.notPaired"); return; }
  connecting = true;
  setStatus("connecting");
  try {
    const api = new CodieAPI(cfg.deviceUrl, cfg.creds);
    await registerCatalog(api, cfg);
    const path = "/v1/ws/tool-integrations/" + cfg.integrationId + "/executor";
    const socket = new WebSocket(await api.websocketUrl(path));
    await new Promise((resolve, reject) => {
      socket.onmessage = (ev) => { try { if (JSON.parse(ev.data).type === "ready") resolve(); else reject(new UiError("m.noReady")); } catch (e) { reject(e); } };
      socket.onerror = () => reject(new UiError("m.wsFail"));
      socket.onclose = () => reject(new UiError("m.wsClosed"));
      setTimeout(() => reject(new UiError("m.readyTimeout")), 15000);
    });
    ws = socket;
    backoff = 3000;
    socket.onmessage = (ev) => onMessage(socket, ev).catch((e) => console.error(e));
    socket.onclose = () => { if (ws === socket) { ws = null; setStatus("offline", "m.reconnecting"); scheduleReconnect(); } };
    setStatus("online");
  } catch (e) {
    ws = null;
    const authFailed = e instanceof APIError && e.status === 401;
    if (e instanceof UiError) setStatus("error", e.key, e.params);
    else setStatus("error", authFailed ? "m.authError" : "m.detail", { detail: String(e.message || e) });
    if (!authFailed) scheduleReconnect();
  } finally {
    connecting = false;
  }
}

async function onMessage(socket, ev) {
  const msg = JSON.parse(ev.data);
  if (msg.type === "error") { console.warn("protocol error", msg.data); return; }
  if (msg.type !== "invoke") return;
  const call = msg.data;
  let outcome;
  if (Date.now() > call.deadline_unix_ms) outcome = { status: "failed", code: "DEADLINE_EXCEEDED", data: { error: "Deadline exceeded" } };
  else outcome = await runTool(call.name, call.arguments);
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "result", data: { invocation_id: call.invocation_id, ...outcome } }));
}

// ---- ポップアップとのやり取り ----

const handlers = {
  async getState() {
    const cfg = await loadConfig();
    const { creds, ...rest } = cfg;
    const challenge = (await chrome.storage.session.get("challenge")).challenge || null;
    const lang = rest.lang || detectLang();
    return { ...rest, lang, langs: LANGS, paired: !!creds, scope: creds?.auth_scope || "", expiresAt: creds?.local_session_expires_at_ms || 0, pairing: !!challenge, status };
  },
  async pairStart({ deviceUrl, scope }) {
    const url = normalizeDeviceUrl(deviceUrl);
    const api = new CodieAPI(url);
    const { challenge_id, user_id } = await api.pairRequest();
    await chrome.storage.session.set({ challenge: { challenge_id, user_id, deviceUrl: url, scope } });
    return {};
  },
  async pairConfirm({ code }) {
    const { challenge } = await chrome.storage.session.get("challenge");
    if (!challenge) throw new UiError("m.noChallenge");
    const api = new CodieAPI(challenge.deviceUrl);
    const creds = await api.pairConfirm(challenge.challenge_id, code.trim(), challenge.user_id, challenge.scope);
    await chrome.storage.local.set({ deviceUrl: challenge.deviceUrl, creds, authScope: challenge.scope, catalogHash: "" });
    await chrome.storage.session.remove("challenge");
    return {};
  },
  async pairCancel() {
    const { challenge } = await chrome.storage.session.get("challenge");
    if (challenge) await new CodieAPI(challenge.deviceUrl).request("POST", "/v1/api/auth/pair/cancel", { challenge_id: challenge.challenge_id }, { pub: true }).catch(() => {});
    await chrome.storage.session.remove("challenge");
    return {};
  },
  /** local_api.py が作った credentials.json を貼り付けて取り込む(ブラウザーからのペアリングが拒否される場合の代替) */
  async importCreds({ deviceUrl, json }) {
    const url = normalizeDeviceUrl(deviceUrl);
    const c = JSON.parse(json);
    if (!c.local_secret || !c.user_id) throw new UiError("m.needCreds");
    await chrome.storage.local.set({ deviceUrl: url, creds: c, authScope: c.auth_scope || "session", catalogHash: "" });
    return {};
  },
  async unpair() {
    await disconnect();
    await chrome.storage.local.set({ creds: null, autoConnect: false, catalogHash: "" });
    return {};
  },
  async setLang({ lang }) { if (LANGS[lang]) await chrome.storage.local.set({ lang }); return {}; },
  async saveSettings({ confirmWrites }) {
    await chrome.storage.local.set({ confirmWrites: !!confirmWrites });
    if (ws) { await disconnect(); await connect(); } // 宣言の変更は再接続で反映
    return {};
  },
  async connectNow() { await chrome.storage.local.set({ autoConnect: true }); backoff = 3000; await connect(); return {}; },
  async disconnectNow() { await chrome.storage.local.set({ autoConnect: false }); await disconnect(); return {}; },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const fn = handlers[msg?.type];
  if (!fn) return false;
  fn(msg).then((r) => sendResponse({ ok: true, ...r }), (e) => sendResponse(e instanceof UiError ? { ok: false, key: e.key, params: e.params } : { ok: false, key: "m.detail", params: { detail: String(e.message || e) } }));
  return true;
});

// MV3 の Service Worker は止まることがあるため、アラームで起こして再接続する。
async function ensureConnected() {
  const cfg = await loadConfig();
  if (cfg.autoConnect && cfg.creds && !ws && !connecting) await connect();
}
chrome.alarms.create("keepalive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "keepalive") ensureConnected(); });
chrome.runtime.onStartup.addListener(ensureConnected);
chrome.runtime.onInstalled.addListener(ensureConnected);
ensureConnected();

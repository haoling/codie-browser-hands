import { t } from "../src/i18n.js";

const $ = (id) => document.getElementById(id);
let lang = "en";
function applyLang() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(lang, el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-ph]")) el.placeholder = t(lang, el.dataset.i18nPh);
}
const showError = (r) => { $("error").textContent = t(lang, r.key || "m.failed", r.params); };
const send = async (type, extra = {}) => {
  const r = await chrome.runtime.sendMessage({ type, ...extra });
  if (!r?.ok) throw r || { key: "m.failed" };
  return r;
};

async function refresh() {
  const s = await send("getState");
  const st = s.status || { state: "offline" };
  if (s.lang !== lang || !$("lang").options.length) {
    lang = s.lang;
    $("lang").replaceChildren(...Object.entries(s.langs).map(([k, v]) => new Option(v, k)));
    applyLang();
  }
  $("lang").value = lang;
  $("status").textContent = t(lang, "st." + st.state);
  $("status").className = st.state === "online" ? "online" : st.state === "error" ? "error" : "";
  $("msg").textContent = st.key ? t(lang, st.key, st.params) : "";
  $("unpaired").hidden = s.paired;
  $("paired").hidden = !s.paired;
  $("codeBox").hidden = !s.pairing;
  if (!$("deviceUrl").value) $("deviceUrl").value = s.deviceUrl || "";
  if (s.paired) $("scope").value = s.authScope || "session";
  $("confirmWrites").checked = s.confirmWrites;
  const exp = s.expiresAt ? "・" + t(lang, "expires") + " " + new Date(s.expiresAt).toLocaleString() : "";
  $("pairInfo").textContent = s.paired ? `${s.deviceUrl}(${s.scope || "?"}${exp})` : "";
}

function act(id, fn) {
  $(id).addEventListener("click", async () => {
    $("error").textContent = "";
    try { await fn(); } catch (e) { showError(e); }
    await refresh();
  });
}
act("pairStart", () => send("pairStart", { deviceUrl: $("deviceUrl").value, scope: $("scope").value }));
act("pairConfirm", async () => { await send("pairConfirm", { code: $("code").value }); await send("connectNow"); });
act("pairCancel", () => send("pairCancel"));
act("importCreds", async () => { await send("importCreds", { deviceUrl: $("deviceUrl").value, json: $("credsJson").value }); await send("connectNow"); });
act("connect", () => send("connectNow"));
act("disconnect", () => send("disconnectNow"));
act("unpair", () => send("unpair"));
$("confirmWrites").addEventListener("change", () => send("saveSettings", { confirmWrites: $("confirmWrites").checked }).catch(showError));

$("lang").addEventListener("change", async () => { await send("setLang", { lang: $("lang").value }); await refresh(); });

refresh();
setInterval(refresh, 2000);

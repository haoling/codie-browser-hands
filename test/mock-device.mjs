// Codie 1.6.0 の LAN API を最小限まねるモック。署名検証はドキュメント(GUIDE.ja.md §4)の仕様どおりに独立実装している。
import http from "node:http";
import crypto from "node:crypto";
import { WebSocketServer } from "ws";

export function startMock(port) {
  const SECRET = "s3cr3t-local-secret", SESSION = "sess-1", USER = "user-1", CODE = "123456";
  const nonces = new Set();
  const state = { integrations: {}, log: [], origins: [], wsOrigins: [], executor: null, results: new Map(), puts: 0 };

  function verify(method, path, headers, body, query) {
    const g = (k) => headers?.[k.toLowerCase()] ?? query?.get(k);
    const get = query ? (k, h) => query.get(k) : (k, h) => headers[h.toLowerCase()];
    const sig = get("sig", "X-Local-Sig"), ts = get("timestamp", "X-Local-Timestamp"), nonce = get("nonce", "X-Local-Nonce");
    const mode = get("payload_mode", "X-Local-Payload-Mode"), bh = get("body_hash", "X-Local-Body-Hash"), uid = get("user_id", "X-Local-User-Id");
    const sid = get("session_id", "X-Local-Session-Id");
    if (!sig) return "NO_SIG";
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return "REQUEST_EXPIRED";
    if (nonces.has(nonce)) return "NONCE_REUSED";
    if (uid !== USER) return "LOCAL_USER_MISMATCH";
    if (sid !== SESSION) return "LOCAL_SESSION_MISMATCH";
    const expectBodyHash = crypto.createHash("sha256").update(body).digest("hex");
    if (bh !== expectBodyHash) return "BODY_HASH_MISMATCH";
    if (mode !== (body.length ? "json" : "empty")) return "BAD_MODE";
    const canonical = [method, decodeURIComponent(path), ts, nonce, mode, bh, uid].join("|");
    const want = crypto.createHmac("sha256", SECRET).update(canonical).digest("hex");
    if (want !== sig) return "INVALID_SIGNATURE";
    nonces.add(nonce);
    return null;
  }

  const send = (res, status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

  function validateCatalog(c) {
    if (c.protocol_version !== "v1") return "protocol_version";
    if (!Array.isArray(c.tools) || c.tools.length > 16) return "tools";
    const bad = (s, d = 0) => {
      if (d > 6) return "depth";
      for (const k of ["$ref", "oneOf", "anyOf", "allOf", "pattern"]) if (k in s) return "unsupported " + k;
      if (s.properties) for (const v of Object.values(s.properties)) { const r = bad(v, d + 1); if (r) return r; }
      if (s.items) return bad(s.items, d + 1);
    };
    for (const t of c.tools) {
      if (!/^[a-z][a-z0-9_]{0,23}$/.test(t.name)) return "name " + t.name;
      if (!/^[A-Za-z0-9_.-]{1,32}$/.test(t.version)) return "version";
      for (const f of ["parameters", "result_schema"]) {
        if (t[f].type !== "object") return f + " root";
        if (JSON.stringify(t[f]).length > 8192) return f + " size " + t.name;
        const r = bad(t[f]); if (r) return t.name + " " + r;
      }
      if (!["read", "reversible", "consequential"].includes(t.risk)) return "risk";
      for (const f of ["description", "idempotent", "confirmation_required"]) if (!(f in t)) return "missing " + f;
    }
  }

  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, "http://x");
    state.origins.push(req.headers.origin || null);
    const path = url.pathname;
    state.log.push(`${req.method} ${path}`);
    // 実機と同様に、ブラウザー由来(Origin 付き)のペアリング要求は拒否する
    if (path.startsWith("/v1/api/auth/pair/") && req.headers.origin) return send(res, 403, { code: "PAIRING_SOURCE_NOT_ALLOWED", message: "Pairing request source not allowed", success: false });
    if (path === "/v1/api/auth/bootstrap") return send(res, 200, { success: true, data: { user_id: USER } });
    if (path === "/v1/api/auth/pair/request") return send(res, 200, { success: true, data: { challenge_id: "chal-1" } });
    if (path === "/v1/api/auth/pair/confirm") {
      const j = JSON.parse(body.toString());
      if (j.challenge_id !== "chal-1" || j.pairing_code !== CODE) return send(res, 403, { code: "PAIRING_CODE_INVALID" });
      return send(res, 200, { success: true, data: { local_secret: SECRET, local_session_id: SESSION, local_session_expires_at_ms: Date.now() + 12 * 3600e3, auth_scope: j.auth_scope } });
    }
    const m = path.match(/^\/v1\/api\/data\/user\/tool-integrations\/([0-9a-f-]+)$/);
    if (m) {
      const err = verify(req.method, path, req.headers, body, null);
      if (err) return send(res, 401, { code: err });
      const id = m[1], cur = state.integrations[id];
      if (req.method === "GET") return cur ? send(res, 200, { success: true, data: cur }) : send(res, 404, { code: "NOT_FOUND" });
      if (req.method === "PUT") {
        const c = JSON.parse(body.toString());
        if ((cur?.revision ?? 0) !== c.expected_revision) return send(res, 409, { code: "REVISION_CONFLICT" });
        const bad = validateCatalog(c);
        if (bad) return send(res, 400, { code: "INVALID_CATALOG", message: bad });
        state.puts++;
        state.integrations[id] = { integration_id: id, name: c.name, enabled: c.enabled, protocol_version: "v1", revision: (cur?.revision ?? 0) + 1, tools: c.tools, online: false };
        return send(res, 200, { success: true, data: state.integrations[id] });
      }
    }
    send(res, 404, { code: "NOT_FOUND" });
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://x");
    state.wsOrigins.push(req.headers.origin || null); // 公式資料に WebSocket の Origin 検証の記述はない。実機で要確認
    const m = url.pathname.match(/^\/v1\/ws\/tool-integrations\/([0-9a-f-]+)\/executor$/);
    const err = m && verify("GET", url.pathname, null, Buffer.alloc(0), url.searchParams);
    if (!m || err || !state.integrations[m[1]]) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); state.log.push("WS rejected " + err); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      state.executor = ws;
      ws.send(JSON.stringify({ type: "ready", data: { protocol_version: "v1" } }));
      ws.on("message", (raw) => { const msg = JSON.parse(raw.toString()); if (msg.type === "result") state.results.get(msg.data.invocation_id)?.(msg.data); });
    });
  });

  const typeOk = (schema, v) => {
    if (schema.type === "object") return v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).every((k) => schema.properties?.[k] && typeOk(schema.properties[k], v[k]));
    if (schema.type === "array") return Array.isArray(v) && v.every((x) => typeOk(schema.items, x)) && (!schema.maxItems || v.length <= schema.maxItems);
    if (schema.type === "integer") return Number.isInteger(v);
    if (schema.type === "string") return typeof v === "string" && (!schema.maxLength || v.length <= schema.maxLength);
    if (schema.type === "boolean") return typeof v === "boolean";
    return true;
  };

  /** ツールを呼び出して結果を待つ。結果は登録した result_schema に照らして検証する。 */
  async function invoke(name, args) {
    const [id, integ] = Object.entries(state.integrations)[0];
    const tool = integ.tools.find((t) => t.name === name);
    const invocation_id = crypto.randomUUID();
    const p = new Promise((resolve, reject) => { state.results.set(invocation_id, resolve); setTimeout(() => reject(new Error("timeout " + name)), 20000); });
    state.executor.send(JSON.stringify({ type: "invoke", data: { invocation_id, integration_id: id, revision: integ.revision, session_id: "s", turn_id: "t", round_id: "r", call_id: "c", name, version: "v1", arguments: args, timeout_ms: tool.timeout_ms, deadline_unix_ms: Date.now() + 20000 } }));
    const r = await p;
    r.schema_ok = typeOk(tool.result_schema, r.data);
    return r;
  }

  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ state, invoke, close: () => { wss.close(); server.closeAllConnections(); server.close(); }, CODE })));
}

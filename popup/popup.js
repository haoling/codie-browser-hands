const $ = (id) => document.getElementById(id);
const send = async (type, extra = {}) => {
  const r = await chrome.runtime.sendMessage({ type, ...extra });
  if (!r?.ok) throw new Error(r?.error || "失敗しました");
  return r;
};
const STATE_LABEL = { online: "オンライン", connecting: "接続中…", offline: "オフライン", error: "エラー" };

async function refresh() {
  const s = await send("getState");
  const st = s.status || { state: "offline" };
  $("status").textContent = STATE_LABEL[st.state] || st.state;
  $("status").className = st.state === "online" ? "online" : st.state === "error" ? "error" : "";
  $("msg").textContent = st.message || "";
  $("unpaired").hidden = s.paired;
  $("paired").hidden = !s.paired;
  $("codeBox").hidden = !s.pairing;
  if (!$("deviceUrl").value) $("deviceUrl").value = s.deviceUrl || "";
  if (s.paired) $("scope").value = s.authScope || "session";
  $("confirmWrites").checked = s.confirmWrites;
  const exp = s.expiresAt ? "・期限 " + new Date(s.expiresAt).toLocaleString() : "";
  $("pairInfo").textContent = s.paired ? `${s.deviceUrl}(${s.scope || "?"}${exp})` : "";
}

function act(id, fn) {
  $(id).addEventListener("click", async () => {
    $("error").textContent = "";
    try { await fn(); } catch (e) { $("error").textContent = e.message; }
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
$("confirmWrites").addEventListener("change", () => send("saveSettings", { confirmWrites: $("confirmWrites").checked }).catch((e) => ($("error").textContent = e.message)));

refresh();
setInterval(refresh, 2000);

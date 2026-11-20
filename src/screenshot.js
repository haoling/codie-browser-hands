// share_screenshot: タブのスクリーンショットを、Codie との次の会話ターンに画像として送る。
//
// ツール結果は 16 KiB の JSON までで画像を渡せないため、公式 API の image_text 入力(multipart)を使う。
// 呼び出し元のターンが終わるのを待ってから、新しいターンとして画像を送る(interrupt:false で会話を割り込まない)。
import { CodieAPI } from "./codie.js";

const MAX_BYTES = 900 * 1024; // 端末の上限は 1 MiB
const MAX_WIDTH = 1280;
const TERMINAL = ["completed", "failed", "cancelled"];
let chain = Promise.resolve(); // 同時に複数のターンを作らないよう直列化する

async function capture(tabId) {
  const tab = tabId != null ? await chrome.tabs.get(tabId).catch(() => null) : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!tab) throw Object.assign(new Error("Tab not found"), { code: "TAB_NOT_FOUND" });
  if (!/^https?:/.test(tab.url || "")) throw Object.assign(new Error("This page cannot be captured"), { code: "PAGE_NOT_ALLOWED" });
  if (!tab.active) await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  await new Promise((r) => setTimeout(r, 300)); // 切り替え直後の描画待ち
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const scale = Math.min(1, MAX_WIDTH / bitmap.width);
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let blob;
  for (const quality of [0.8, 0.6, 0.4, 0.25]) {
    blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    if (blob.size <= MAX_BYTES) break;
  }
  if (blob.size > MAX_BYTES) throw Object.assign(new Error("Screenshot is too large"), { code: "RESULT_TOO_LARGE" });
  return { blob, width: canvas.width, height: canvas.height };
}

async function sendWhenTurnEnds(api, turnId, blob, message) {
  // 呼び出し元のターンが終わるのを待つ(最長 2 分)
  const deadline = Date.now() + 120000;
  for (;;) {
    const t = (await api.request("GET", "/v1/api/data/user/chat/turns/" + encodeURIComponent(turnId))).data;
    if (TERMINAL.includes(t.status)) break;
    if (Date.now() > deadline) throw new Error("The conversation turn did not finish in time");
    await new Promise((r) => setTimeout(r, 1000));
  }
  const slot = (await api.request("GET", "/v1/api/data/user/slot")).data.slot_number;
  const request = { request_id: crypto.randomUUID(), slot, input: { type: "image_text", text: message }, output: { speech: "device" }, interrupt: false };
  await api.postMultipart("/v1/api/data/user/chat/turns", request, "image", blob, "screenshot.jpg");
}

/** スクリーンショットを撮り、送信は背景で予約して、すぐ結果を返す。 */
export async function shareScreenshot(cfg, call) {
  const args = call.arguments || {};
  const { blob, width, height } = await capture(args.tab_id);
  const message = args.message || "(This is a screenshot of the user's current browser tab.)";
  const api = new CodieAPI(cfg.deviceUrl, cfg.creds);
  chain = chain.then(() => sendWhenTurnEnds(api, call.turn_id, blob, message)).catch((e) => console.error("share_screenshot failed", e));
  return { queued: true, width, height, size_kb: Math.round(blob.size / 1024) };
}

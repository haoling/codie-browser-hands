// 実Chrome(拡張を読み込み)× モック端末 のE2Eテスト。 node test/e2e.mjs
import http from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startMock } from "./mock-device.mjs";

const ext = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOCK_PORT = 18081, PAGE_PORT = 18090;
let failed = 0;
// 確認ウィンドウ(popup/confirm.html)が開くのを待って、許可/拒否を押す
const withConfirm = async (allow, run) => {
  const opened = ctx.waitForEvent("page", { timeout: 10000 });
  const result = run();
  const win = await opened;
  await win.waitForLoadState();
  const text = await win.textContent("body");
  await win.click(allow ? "#allow" : "#deny");
  return { result: await result, text };
};
const check = (name, ok, extra = "") => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  " + extra)); if (!ok) failed++; };

const page = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><title>テストページ</title><body><h1>こんにちは Codie</h1>
  <form id=f onsubmit="document.title='submitted:'+document.getElementById('q').value;return false"><input id=q placeholder="検索"><input type=password id=pw><button id=go type=submit>送信</button></form>
  <a href="/next" id=lnk>次へ</a><button id=b onclick="document.getElementById('out').textContent='clicked'">押す</button><div id=out></div>
  <div style="height:3000px"></div>` + "あ".repeat(6000));
}).listen(PAGE_PORT);

const mock = await startMock(MOCK_PORT);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "codie-ext-"));
const ctx = await chromium.launchPersistentContext(userData, {
  headless: false,
  executablePath: process.env.CHROME_PATH || undefined,
  args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-sandbox"],
});
try {
  let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker", { timeout: 15000 }));
  const extId = sw.url().split("/")[2];
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);

  // --- 言語切替 ---
  await popup.waitForSelector("#lang option", { state: "attached" });
  for (const [lang, label] of [["ja", "ペアリング開始"], ["zh", "开始配对"], ["en", "Start pairing"]]) {
    await popup.selectOption("#lang", lang);
    await popup.waitForFunction((l) => document.documentElement.lang === l, lang);
    check(`言語切替 ${lang}`, (await popup.textContent("#pairStart")) === label, await popup.textContent("#pairStart"));
  }
  await popup.selectOption("#lang", "ja");

  // --- ペアリング(ポップアップのUI経由) ---
  await popup.fill("#deviceUrl", `http://127.0.0.1:${MOCK_PORT}`);
  await popup.click("#pairStart");
  await popup.waitForSelector("#codeBox:not([hidden])");
  await popup.fill("#code", mock.CODE);
  await popup.click("#pairConfirm");
  await popup.waitForSelector("#status.online", { timeout: 15000 });
  check("ステータス表示が選択言語になる", (await popup.textContent("#status")) === "オンライン");
  check("ペアリングして WebSocket がオンラインになる", true);
  const integ = Object.values(mock.state.integrations)[0];
  check("カタログが検証を通って登録された(10ツール)", integ?.tools.length === 10, JSON.stringify(mock.state.log.slice(-4)));
  check("端末宛ての HTTP リクエストに Origin が付かない", mock.state.origins.every((o) => !o), [...new Set(mock.state.origins)].join(", "));
  console.log("  WebSocket の Origin(DNR では外せない):", [...new Set(mock.state.wsOrigins)].join(", "));

  // --- ツール呼び出し ---
  const open = await mock.invoke("open_url", { url: `http://127.0.0.1:${PAGE_PORT}/` });
  check("open_url", open.status === "succeeded" && open.data.loaded && open.data.title === "テストページ" && open.schema_ok, JSON.stringify(open));
  const tabId = open.data.tab_id;

  const tabs = await mock.invoke("list_tabs", {});
  check("list_tabs", tabs.status === "succeeded" && tabs.data.tabs.some((t) => t.tab_id === tabId) && tabs.schema_ok, JSON.stringify(tabs));

  const read = await mock.invoke("read_page", { tab_id: tabId, max_chars: 4000 });
  check("read_page(本文・切り詰め・サイズ)", read.status === "succeeded" && read.data.text.includes("こんにちは") && read.data.truncated && read.schema_ok && JSON.stringify(read.data).length < 16384, JSON.stringify(read).slice(0, 300));

  // 続き読み: 全文を offset でたどって、最後まで読み切れる
  let got = "", off = 0, loops = 0, chunk;
  do {
    chunk = await mock.invoke("read_page", { tab_id: tabId, max_chars: 4000, offset: off });
    if (chunk.status !== "succeeded" || !chunk.schema_ok) break;
    got += chunk.data.text; off = chunk.data.next_offset ?? 0;
  } while (chunk.data.truncated && ++loops < 20);
  check("read_page を offset でたどると全文が読める", chunk.status === "succeeded" && !chunk.data.truncated && got.length === chunk.data.total_chars && got.endsWith("あ".repeat(100)) && loops >= 1, `${got.length}/${chunk.data?.total_chars} loops=${loops}`);

  const els = await mock.invoke("get_elements", { tab_id: tabId });
  const byText = (t) => els.data?.elements.find((e) => e.text === t);
  const q = els.data?.elements.find((e) => e.tag === "input" && e.text === "検索");
  const btn = byText("押す"), go = byText("送信");
  check("get_elements", els.status === "succeeded" && q && btn && go && els.schema_ok, JSON.stringify(els).slice(0, 400));

  const declined = await withConfirm(false, () => mock.invoke("click_element", { tab_id: tabId, ref: btn.ref }));
  check("クリックを拒否すると実行されない(USER_DECLINED)", declined.result.status === "failed" && declined.result.code === "USER_DECLINED" && declined.result.schema_ok, JSON.stringify(declined.result));
  check("確認ウィンドウに操作内容が出る", declined.text.includes("Click") || declined.text.includes("クリック") || declined.text.includes("点击"), declined.text);
  const page0 = ctx.pages().find((p) => p.url().startsWith(`http://127.0.0.1:${PAGE_PORT}`));
  check("拒否したのでページは変わっていない", (await page0.textContent("#out")) === "");
  const { result: click } = await withConfirm(true, () => mock.invoke("click_element", { tab_id: tabId, ref: btn.ref }));
  const page1 = ctx.pages().find((p) => p.url().startsWith(`http://127.0.0.1:${PAGE_PORT}`));
  check("click_element", click.status === "succeeded" && (await page1.textContent("#out")) === "clicked" && click.schema_ok, JSON.stringify(click));

  const { result: type } = await withConfirm(true, () => mock.invoke("type_text", { tab_id: tabId, ref: q.ref, text: "夏の予定", submit: true }));
  check("type_text + submit", type.status === "succeeded" && (await page1.title()) === "submitted:夏の予定" && type.schema_ok, JSON.stringify(type));

  const { result: pw } = await withConfirm(true, () => mock.invoke("type_text", { tab_id: tabId, selector: "#pw", text: "x" }));
  check("パスワード欄は拒否される", pw.status === "failed" && pw.data.error.includes("password") && pw.schema_ok, JSON.stringify(pw));

  const scroll = await mock.invoke("scroll_page", { tab_id: tabId, direction: "down" });
  check("scroll_page", scroll.status === "succeeded" && scroll.data.scroll_y > 0 && scroll.schema_ok, JSON.stringify(scroll));

  const bad = await mock.invoke("open_url", { url: "javascript:alert(1)" });
  check("open_url は http/https 以外を拒否", bad.status === "failed" && bad.code === "BAD_URL", JSON.stringify(bad));

  const restricted = await mock.invoke("read_page", { tab_id: (await mock.invoke("open_url", { url: "about:blank" })).data?.tab_id ?? 0 });
  check("操作できないページはエラーで返る", restricted.status === "failed", JSON.stringify(restricted));

  const shot = await mock.invoke("share_screenshot", { tab_id: tabId, message: "ページを見て" });
  check("share_screenshot が撮影して予約する", shot.status === "succeeded" && shot.data.queued && shot.data.size_kb > 0 && shot.schema_ok, JSON.stringify(shot));
  for (let i = 0; i < 40 && !mock.state.shots.length; i++) await new Promise((r) => setTimeout(r, 250));
  const sent = mock.state.shots[0];
  check("ターン終了後に image_text として JPEG が送られる", sent && sent.jpeg && sent.bytes > 1000 && sent.request.input.type === "image_text" && sent.request.input.text === "ページを見て" && sent.request.interrupt === false && sent.request.slot === 1 && /multipart\/form-data; boundary=/.test(sent.contentType), JSON.stringify(sent));

  // 要素指定の撮影は、その範囲だけに切り出される
  const crop = await mock.invoke("share_screenshot", { tab_id: tabId, ref: btn.ref });
  for (let i = 0; i < 40 && mock.state.shots.length < 2; i++) await new Promise((r) => setTimeout(r, 250));
  check("share_screenshot は要素だけを切り出せる", crop.status === "succeeded" && crop.schema_ok && crop.data.width < shot.data.width / 4 && crop.data.height < shot.data.height / 4 && mock.state.shots[1]?.jpeg, JSON.stringify([shot.data, crop.data]));
  const bad2 = await mock.invoke("share_screenshot", { tab_id: tabId, selector: "#nope" });
  check("存在しない要素の撮影は失敗で返る", bad2.status === "failed" && bad2.schema_ok, JSON.stringify(bad2));

  const sw2 = await mock.invoke("switch_tab", { tab_id: tabId });
  check("switch_tab", sw2.status === "succeeded" && sw2.schema_ok, JSON.stringify(sw2));
  const { result: close } = await withConfirm(true, () => mock.invoke("close_tab", { tab_id: tabId }));
  check("close_tab", close.status === "succeeded" && close.data.closed, JSON.stringify(close));

  check("PUT はカタログ登録の1回だけ", mock.state.puts === 1, String(mock.state.puts));

  // --- 設定変更でツール定義が変わっても TOOL_VERSION_CONFLICT にならない ---
  const before = JSON.stringify(Object.values(mock.state.integrations)[0].tools.map((t) => t.version));
  await popup.bringToFront();
  await popup.uncheck("#confirmWrites");
  await popup.waitForFunction(() => document.getElementById("status").className === "online", null, { timeout: 15000 });
  await popup.waitForTimeout(1500);
  const after = JSON.stringify(Object.values(mock.state.integrations)[0].tools.map((t) => t.version));
  check("確認設定を変えてもツール定義は変わらず、オンラインのまま", mock.state.puts === 1 && before === after && (await popup.textContent("#status")) === "オンライン", `${mock.state.puts} ${await popup.textContent("#error")} ${await popup.textContent("#msg")}`);

  // --- 確認オフでも、confirm=true・危険なボタン名・submit は必ず確認される ---
  const o2 = await mock.invoke("open_url", { url: `http://127.0.0.1:${PAGE_PORT}/` });
  const tab2 = o2.data.tab_id;
  const els2 = await mock.invoke("get_elements", { tab_id: tab2 });
  const b2 = els2.data.elements.find((e) => /押す/.test(e.text || e.label || ""));
  const go2 = els2.data.elements.find((e) => /送信/.test(e.text || e.label || ""));
  const q2 = els2.data.elements.find((e) => e.tag === "input" && e.type !== "password");
  const plain = await mock.invoke("click_element", { tab_id: tab2, ref: b2.ref });
  check("確認オフ: 普通のクリックは確認なしで実行される", plain.status === "succeeded", JSON.stringify(plain));
  const forced = await withConfirm(false, () => mock.invoke("click_element", { tab_id: tab2, ref: b2.ref, confirm: true }));
  check("確認オフでも confirm=true なら確認が出る", forced.result.code === "USER_DECLINED", JSON.stringify(forced.result));
  const risky = await withConfirm(false, () => mock.invoke("click_element", { tab_id: tab2, ref: go2.ref }));
  check("確認オフでも『送信』ボタンは確認が出る", risky.result.code === "USER_DECLINED", JSON.stringify(risky.result));
  const sub = await withConfirm(false, () => mock.invoke("type_text", { tab_id: tab2, ref: q2.ref, text: "x", submit: true }));
  check("確認オフでも submit=true は確認が出る", sub.result.code === "USER_DECLINED", JSON.stringify(sub.result));
  const typed = await mock.invoke("type_text", { tab_id: tab2, ref: q2.ref, text: "x" });
  check("確認オフ: submitなしの入力は確認なし", typed.status === "succeeded", JSON.stringify(typed));
} catch (e) {
  console.error(e); failed++;
} finally {
  await ctx.close(); mock.close(); page.close();
}
console.log(failed ? `\n${failed} 件失敗` : "\nすべて成功");
process.exit(failed ? 1 : 0);

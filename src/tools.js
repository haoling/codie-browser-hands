// Codie に登録する外部ツールの定義と実装。
// 制約: 名前 ^[a-z][a-z0-9_]{0,23}$ / 最大16個 / スキーマは $ref・union・pattern 不可 / 結果データ最大 16 KiB。

const MAX_RESULT_BYTES = 15000;
const bytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length;

export class ToolError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const obj = (properties, required = []) => ({ type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false });
const str = (description, extra = {}) => ({ type: "string", description, ...extra });
const int = (description, extra = {}) => ({ type: "integer", description, ...extra });
const bool = (description) => ({ type: "boolean", description });
const tabId = int("Target tab ID. Defaults to the currently active tab");
// 失敗時は data={error:"..."} を返すので、結果スキーマの必須項目は作らない。
const result = (properties) => obj({ ...properties, error: str("Error message on failure", { maxLength: 300 }) });

/** @param {{confirmWrites:boolean}} opts */
export async function buildCatalog({ confirmWrites }) {
  const tools = rawCatalog({ confirmWrites });
  // 端末は「同じ name + version で内容が違う」宣言を TOOL_VERSION_CONFLICT で拒否する。
  // 内容のハッシュを version に入れて、定義が変わると自動で version も変わるようにする。
  for (const t of tools) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ ...t, version: "" })));
    t.version = "1." + [...new Uint8Array(buf)].slice(0, 4).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return tools;
}

function rawCatalog({ confirmWrites }) {
  // 確認は拡張の確認ウィンドウで行う。confirmation_required を true にすると、モデルが
  // 「確認待ち」と判断して実行を呼び出さないことがあるため、常に false で宣言する。
  const write = { risk: "consequential", idempotent: false, confirmation_required: false };
  const writeTimeout = confirmWrites ? 20000 : 8000;
  const read = { risk: "read", idempotent: true, confirmation_required: false };
  const nav = { risk: "reversible", idempotent: false, confirmation_required: false };
  return [
    { name: "list_tabs", version: "v1", ...read, timeout_ms: 5000,
      description: "List the tabs open in Chrome (tab_id, title, URL, active state).",
      parameters: obj({}),
      result_schema: result({ tabs: { type: "array", maxItems: 30, items: obj({ tab_id: int("Tab ID"), title: str("Title", { maxLength: 80 }), url: str("URL", { maxLength: 150 }), active: bool("Whether it is the selected tab in its window") }) } }) },
    { name: "open_url", version: "v1", ...nav, timeout_ms: 20000,
      description: "Open an http/https URL in Chrome. Opens a new tab by default. Waits for the page to finish loading (up to 15 seconds).",
      parameters: obj({ url: str("URL to open", { maxLength: 1000 }), new_tab: bool("true opens a new tab (default); false replaces the current tab") }, ["url"]),
      result_schema: result({ tab_id: int("Tab ID"), url: str("Current URL", { maxLength: 300 }), title: str("Title", { maxLength: 150 }), loaded: bool("Whether loading finished") }) },
    { name: "switch_tab", version: "v1", ...nav, timeout_ms: 5000,
      description: "Bring the specified tab to the front.",
      parameters: obj({ tab_id: int("Tab ID") }, ["tab_id"]),
      result_schema: result({ tab_id: int("Tab ID"), title: str("Title", { maxLength: 150 }) }) },
    { name: "close_tab", version: "v1", ...write, timeout_ms: writeTimeout,
      description: "Close the specified tab. Unsaved input in the tab is lost.",
      parameters: obj({ tab_id: int("Tab ID") }, ["tab_id"]),
      result_schema: result({ closed: bool("Whether the tab was closed") }) },
    { name: "read_page", version: "v1", ...read, timeout_ms: 8000,
      description: "Read the text of a tab. A single call returns at most max_chars characters starting at offset. If truncated is true, call again with offset set to next_offset to continue reading. Use selector to read only part of the page.",
      parameters: obj({ tab_id: tabId, selector: str("CSS selector (whole page if omitted)", { maxLength: 200 }), max_chars: int("Maximum number of characters (default 3000)", { minimum: 200, maximum: 4000 }), offset: int("Character position to start reading from (default 0). Use next_offset from the previous result to continue", { minimum: 0, maximum: 10000000 }) }),
      result_schema: result({ title: str("Title", { maxLength: 150 }), url: str("URL", { maxLength: 300 }), text: str("Page text", { maxLength: 4000 }), truncated: bool("Whether more text remains after this chunk"), total_chars: int("Total number of characters in the text"), offset: int("Start position of this chunk"), next_offset: int("Offset to pass to continue reading; present only when truncated is true") }) },
    { name: "get_elements", version: "v1", ...read, timeout_ms: 8000,
      description: "List the interactive elements on the page (links, buttons, input fields). Pass an element's ref to click_element / type_text. Fetch the list again after the page changes.",
      parameters: obj({ tab_id: tabId, limit: int("Maximum number of elements (default 30)", { minimum: 1, maximum: 40 }) }),
      result_schema: result({ elements: { type: "array", maxItems: 40, items: obj({ ref: int("Element reference number"), tag: str("Tag name", { maxLength: 20 }), type: str("Type of the input element", { maxLength: 20 }), text: str("Visible text", { maxLength: 40 }), href: str("Link target", { maxLength: 80 }), value: str("Current value", { maxLength: 30 }), in_view: bool("Whether it is visible in the viewport") }) } }) },
    { name: "share_screenshot", version: "v1", ...read, timeout_ms: 8000,
      description: "Take a screenshot of a tab and send it to you as an image. Tool results cannot carry images, so the screenshot arrives as a new user message with the image right after your current reply ends. Tell the user you are about to look, finish your turn, and then describe what you see when the image arrives.",
      parameters: obj({ tab_id: tabId, message: str("Short note sent together with the image (default: a generic note)", { maxLength: 200 }) }),
      result_schema: result({ queued: bool("Whether the screenshot was captured and queued for delivery"), width: int("Image width (px)"), height: int("Image height (px)"), size_kb: int("Image size (KB)") }) },
    { name: "click_element", version: "v1", ...write, timeout_ms: writeTimeout,
      description: "Click an element. Specify either a ref from get_elements or a CSS selector.",
      parameters: obj({ tab_id: tabId, ref: int("ref returned by get_elements"), selector: str("CSS selector", { maxLength: 200 }) }),
      result_schema: result({ clicked: bool("Whether the click was performed"), tag: str("Tag name", { maxLength: 20 }), text: str("Element text", { maxLength: 40 }) }) },
    { name: "type_text", version: "v1", ...write, timeout_ms: writeTimeout,
      description: "Type text into an input field. Password fields are refused. With submit=true, submits (Enter) after typing.",
      parameters: obj({ tab_id: tabId, ref: int("ref returned by get_elements"), selector: str("CSS selector", { maxLength: 200 }), text: str("Text to type", { maxLength: 1000 }), clear: bool("Clear existing content before typing (default true)"), submit: bool("Submit after typing (default false)") }, ["text"]),
      result_schema: result({ typed: bool("Whether the text was typed"), tag: str("Tag name", { maxLength: 20 }) }) },
    { name: "scroll_page", version: "v1", ...nav, timeout_ms: 5000,
      description: "Scroll the page.",
      parameters: obj({ tab_id: tabId, direction: str("Scroll direction", { enum: ["up", "down", "top", "bottom"] }) }, ["direction"]),
      result_schema: result({ scroll_y: int("Current scroll position (px)"), scroll_height: int("Total page height (px)"), viewport_height: int("Viewport height (px)") }) },
  ];
}

// ---- ページ内で実行される関数(自己完結していること。外部の関数・変数は参照できない) ----

function pageRead(selector, maxChars, offset) {
  try {
    const root = selector ? document.querySelector(selector) : document.body;
    if (!root) return { error: "No element matches the selector" };
    const text = (root.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
    return { title: document.title.slice(0, 150), url: location.href.slice(0, 300), text: text.slice(offset, offset + maxChars), total_chars: text.length, offset };
  } catch (e) { return { error: String(e.message || e) }; }
}

function pageGetElements(limit) {
  try {
    const sel = 'a[href],button,input,textarea,select,summary,[role=button],[role=link],[role=tab],[role=menuitem],[onclick],[contenteditable=""],[contenteditable="true"]';
    let counter = window.__codieRefCounter || 0;
    const elements = [];
    for (const el of document.querySelectorAll(sel)) {
      if (elements.length >= limit) break;
      if (el.disabled || (el.type === "hidden")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      let ref = el.getAttribute("data-codie-ref");
      if (!ref) { ref = String(++counter); el.setAttribute("data-codie-ref", ref); }
      const item = { ref: Number(ref), tag: el.tagName.toLowerCase(), in_view: r.bottom > 0 && r.top < innerHeight };
      if (el.type && el.tagName === "INPUT") item.type = String(el.type).slice(0, 20);
      const label = (el.innerText || el.getAttribute("aria-label") || el.title || el.placeholder || el.value || "").trim().replace(/\s+/g, " ").slice(0, 40);
      if (label && el.type !== "password") item.text = label;
      const href = el.getAttribute("href");
      if (href) item.href = href.slice(0, 80);
      if (el.value && el.type !== "password" && ["INPUT", "TEXTAREA"].includes(el.tagName)) item.value = String(el.value).slice(0, 30);
      elements.push(item);
    }
    window.__codieRefCounter = counter;
    return { elements };
  } catch (e) { return { error: String(e.message || e) }; }
}

function pageClick(ref, selector) {
  try {
    const el = ref != null ? document.querySelector('[data-codie-ref="' + Number(ref) + '"]') : selector ? document.querySelector(selector) : null;
    if (!el) return { error: "Element not found. Fetch refs again with get_elements" };
    el.scrollIntoView({ block: "center" });
    el.click();
    return { clicked: true, tag: el.tagName.toLowerCase(), text: (el.innerText || el.value || "").trim().replace(/\s+/g, " ").slice(0, 40) };
  } catch (e) { return { error: String(e.message || e) }; }
}

function pageType(ref, selector, text, clear, submit) {
  try {
    const el = ref != null ? document.querySelector('[data-codie-ref="' + Number(ref) + '"]') : selector ? document.querySelector(selector) : null;
    if (!el) return { error: "Element not found. Fetch refs again with get_elements" };
    if (el.tagName === "INPUT" && el.type === "password") return { error: "Cannot type into password fields" };
    el.scrollIntoView({ block: "center" });
    el.focus();
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
      setter.call(el, clear ? text : el.value + text);
    } else if (el.isContentEditable) {
      el.textContent = clear ? text : el.textContent + text;
    } else {
      return { error: "This element does not accept text input" };
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    if (submit) {
      if (el.form && el.form.requestSubmit) el.form.requestSubmit();
      else for (const type of ["keydown", "keypress", "keyup"]) el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
    }
    return { typed: true, tag: el.tagName.toLowerCase() };
  } catch (e) { return { error: String(e.message || e) }; }
}

function pageScroll(direction) {
  const h = innerHeight;
  if (direction === "down") scrollBy(0, Math.round(h * 0.8));
  else if (direction === "up") scrollBy(0, -Math.round(h * 0.8));
  else if (direction === "top") scrollTo(0, 0);
  else scrollTo(0, document.documentElement.scrollHeight);
  return { scroll_y: Math.round(scrollY), scroll_height: document.documentElement.scrollHeight, viewport_height: h };
}

// ---- ハンドラー ----

async function resolveTab(id) {
  const tab = id != null ? await chrome.tabs.get(id).catch(() => null)
    : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!tab) throw new ToolError("TAB_NOT_FOUND", "Tab not found");
  return tab;
}

async function runInPage(tabIdArg, func, args) {
  const tab = await resolveTab(tabIdArg);
  if (!/^https?:/.test(tab.url || "")) throw new ToolError("PAGE_NOT_ALLOWED", "This page (" + (tab.url || "").split(":")[0] + ":) cannot be controlled");
  let res;
  try {
    res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
  } catch (e) {
    throw new ToolError("SCRIPT_FAILED", String(e.message || e).slice(0, 200));
  }
  const out = res[0]?.result;
  if (!out) throw new ToolError("SCRIPT_FAILED", "The page returned no result");
  if (out.error) throw new ToolError("TOOL_FAILED", out.error);
  return out;
}

function waitForLoad(id, timeoutMs) {
  return new Promise((resolve) => {
    let poll, finished = false;
    const done = (v) => { finished = true; clearTimeout(t); clearInterval(poll); chrome.tabs.onUpdated.removeListener(listener); resolve(v); };
    const listener = (tid, info) => { if (tid === id && info.status === "complete") done(true); };
    const t = setTimeout(() => done(false), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    // 完了イベントを取り逃した場合の保険(遷移開始より前の complete を拾わないよう 500ms 待つ)
    setTimeout(() => { if (finished) return; poll = setInterval(async () => { const tab = await chrome.tabs.get(id).catch(() => null); if (!tab) done(false); else if (tab.status === "complete") done(true); }, 300); }, 500);
  });
}

const handlers = {
  async list_tabs() {
    const tabs = await chrome.tabs.query({});
    return { tabs: tabs.slice(0, 30).map((t) => ({ tab_id: t.id, title: (t.title || "").slice(0, 80), url: (t.url || "").slice(0, 150), active: !!t.active })) };
  },
  async open_url({ url, new_tab = true }) {
    let u;
    try { u = new URL(url); } catch { throw new ToolError("BAD_URL", "Invalid URL"); }
    if (!["http:", "https:"].includes(u.protocol)) throw new ToolError("BAD_URL", "Only http/https URLs can be opened");
    let tab;
    if (new_tab) tab = await chrome.tabs.create({ url: u.href, active: true });
    else { const cur = await resolveTab(); tab = await chrome.tabs.update(cur.id, { url: u.href, active: true }); }
    const loaded = await waitForLoad(tab.id, 15000);
    tab = await chrome.tabs.get(tab.id);
    return { tab_id: tab.id, url: (tab.url || "").slice(0, 300), title: (tab.title || "").slice(0, 150), loaded };
  },
  async switch_tab({ tab_id }) {
    const tab = await resolveTab(tab_id);
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return { tab_id: tab.id, title: (tab.title || "").slice(0, 150) };
  },
  async close_tab({ tab_id }) {
    const tab = await resolveTab(tab_id);
    await chrome.tabs.remove(tab.id);
    return { closed: true };
  },
  async read_page({ tab_id, selector, max_chars = 3000, offset = 0 }) {
    const out = await runInPage(tab_id, pageRead, [selector || null, max_chars, offset]);
    // 日本語は1文字3バイトなので、上限を超えるなら本文を縮める
    while (bytes(out) > MAX_RESULT_BYTES && out.text.length > 100) out.text = out.text.slice(0, Math.floor(out.text.length * 0.8));
    // 続きを読めるように、実際に返した分の次の位置を教える
    out.truncated = offset + out.text.length < out.total_chars;
    if (out.truncated) out.next_offset = offset + out.text.length;
    return out;
  },
  async get_elements({ tab_id, limit = 30 }) {
    const out = await runInPage(tab_id, pageGetElements, [limit]);
    while (bytes(out) > MAX_RESULT_BYTES && out.elements.length > 1) out.elements.pop();
    return out;
  },
  async click_element({ tab_id, ref, selector }) {
    if (ref == null && !selector) throw new ToolError("BAD_ARGUMENTS", "Either ref or selector is required");
    return runInPage(tab_id, pageClick, [ref ?? null, selector ?? null]);
  },
  async type_text({ tab_id, ref, selector, text, clear = true, submit = false }) {
    if (ref == null && !selector) throw new ToolError("BAD_ARGUMENTS", "Either ref or selector is required");
    return runInPage(tab_id, pageType, [ref ?? null, selector ?? null, text, clear, submit]);
  },
  async scroll_page({ tab_id, direction }) {
    return runInPage(tab_id, pageScroll, [direction]);
  },
};

export const CONFIRM_TOOLS = ["click_element", "type_text", "close_tab"];

/** 確認ウィンドウに出す、対象タブと操作内容の説明 */
export async function describeCall(name, args) {
  const tab = await resolveTab(args?.tab_id).catch(() => null);
  let detail = "";
  if (name === "click_element") detail = args.ref != null ? "ref " + args.ref : String(args.selector || "");
  if (name === "type_text") detail = (args.ref != null ? "ref " + args.ref : String(args.selector || "")) + " ← " + String(args.text || "").slice(0, 100) + (args.submit ? " ⏎" : "");
  return { title: (tab?.title || "").slice(0, 100), page: (tab?.url || "").slice(0, 150), detail };
}

/** invoke の data から結果メッセージの data 部分を作る */
export async function runTool(name, args) {
  const handler = handlers[name];
  if (!handler) return { status: "failed", code: "UNKNOWN_TOOL", data: { error: "Unsupported tool: " + name } };
  try {
    const data = await handler(args || {});
    if (bytes(data) > MAX_RESULT_BYTES) throw new ToolError("RESULT_TOO_LARGE", "Result is too large");
    return { status: "succeeded", data };
  } catch (e) {
    const code = e instanceof ToolError ? e.code : "INTERNAL_ERROR";
    return { status: "failed", code, data: { error: String(e.message || e).slice(0, 300) } };
  }
}

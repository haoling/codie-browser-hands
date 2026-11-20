import { t, detectLang } from "../src/i18n.js";

const q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const lang = (await chrome.storage.local.get("lang")).lang || detectLang();
document.documentElement.lang = lang;

$("title").textContent = t(lang, "c.title");
$("tool").textContent = t(lang, "c.tool." + q.get("tool"));
$("tabl").textContent = t(lang, "c.tab");
$("tab").textContent = [q.get("title"), q.get("page")].filter(Boolean).join("\n");
$("tab").style.whiteSpace = "pre-line";
$("dl").textContent = t(lang, "c.detail");
$("detail").textContent = q.get("detail") || "-";
$("allow").textContent = t(lang, "c.allow");
$("deny").textContent = t(lang, "c.deny");

const answer = (allow) => chrome.runtime.sendMessage({ type: "confirmResult", id: q.get("id"), allow }).finally(() => window.close());
$("allow").addEventListener("click", () => answer(true));
$("deny").addEventListener("click", () => answer(false));

let left = Math.round(Number(q.get("timeout") || 15000) / 1000);
const tick = () => { $("countdown").textContent = t(lang, "c.timeout", { sec: left }); if (left-- > 0) setTimeout(tick, 1000); };
tick();

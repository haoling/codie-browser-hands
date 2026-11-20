// ポップアップ用の多言語化(en / ja / zh)。Codie に渡すツール定義(モデル向け)は対象外。
export const LANGS = { en: "English", ja: "日本語", zh: "中文" };

export const DICT = {
  en: {
    status: "Status", "st.online": "Online", "st.connecting": "Connecting…", "st.offline": "Offline", "st.error": "Error",
    deviceUrl: "Device address", scope: "Auth type",
    "scope.session": "session (12 h, expires on device restart)", "scope.permanent": "permanent (long-lived; secret stored on this PC)",
    pairStart: "Start pairing", pairCodeHint: "Enter the code shown on the device.", codePlaceholder: "Pairing code",
    confirm: "Confirm", cancel: "Cancel",
    importSummary: "If pairing from the browser is rejected", importHint: "Paste the contents of credentials.json made by local_api.py (and fill in the device address above).", import: "Import",
    connect: "Connect", disconnect: "Disconnect", unpair: "Unpair",
    confirmWrites: "Require confirmation for click / type / close-tab",
    notice: "Codie can control Chrome only while Chrome is running. Page contents are sent to Codie (the AI model).",
    language: "Language", expires: "expires",
    "m.notPaired": "Not paired", "m.reconnecting": "Disconnected. Reconnecting…",
    "m.authError": "Authentication error (re-pairing required): {detail}", "m.detail": "{detail}",
    "m.wsFail": "Cannot connect the WebSocket (check the device address, authentication and sleep state)",
    "m.wsClosed": "The WebSocket was closed (the credentials may have expired)", "m.readyTimeout": "Timed out waiting for ready", "m.noReady": "Did not receive ready",
    "m.noChallenge": "No pairing request. Please start again.", "m.needCreds": "JSON containing local_secret and user_id is required",
    "m.badUrl": "Use a device address like http://IP:8081 without a path or query", "m.failed": "Failed",
  },
  ja: {
    status: "状態", "st.online": "オンライン", "st.connecting": "接続中…", "st.offline": "オフライン", "st.error": "エラー",
    deviceUrl: "端末のアドレス", scope: "認証の種類",
    "scope.session": "session(12時間・端末再起動で失効)", "scope.permanent": "permanent(長期。PCに鍵を保存)",
    pairStart: "ペアリング開始", pairCodeHint: "端末に表示されたコードを入力してください。", codePlaceholder: "ペアリングコード",
    confirm: "確定", cancel: "キャンセル",
    importSummary: "ブラウザーからのペアリングが拒否される場合", importHint: "local_api.py で作った credentials.json の中身を貼り付けます(上の端末アドレスも入力)。", import: "取り込む",
    connect: "接続", disconnect: "切断", unpair: "ペアリング解除",
    confirmWrites: "クリック・入力・タブを閉じる操作は確認を要求する",
    notice: "Chrome が起動している間だけ、Codie から Chrome を操作できます。ページの内容は Codie(AIモデル)に送られます。",
    language: "言語", expires: "期限",
    "m.notPaired": "未ペアリング", "m.reconnecting": "切断されました。再接続します",
    "m.authError": "認証エラー(再ペアリングが必要): {detail}", "m.detail": "{detail}",
    "m.wsFail": "WebSocket に接続できません(端末のアドレス・認証・スリープを確認)",
    "m.wsClosed": "WebSocket が閉じられました(認証失効の可能性)", "m.readyTimeout": "ready の待機がタイムアウトしました", "m.noReady": "ready を受信できませんでした",
    "m.noChallenge": "ペアリング要求がありません。もう一度開始してください", "m.needCreds": "local_secret と user_id を含む JSON が必要です",
    "m.badUrl": "端末アドレスは http://IP:8081 の形式で、パスやクエリを付けずに指定してください", "m.failed": "失敗しました",
  },
  zh: {
    status: "状态", "st.online": "在线", "st.connecting": "连接中…", "st.offline": "离线", "st.error": "错误",
    deviceUrl: "设备地址", scope: "认证类型",
    "scope.session": "session(12 小时,设备重启后失效)", "scope.permanent": "permanent(长期;密钥保存在本机)",
    pairStart: "开始配对", pairCodeHint: "请输入设备上显示的配对码。", codePlaceholder: "配对码",
    confirm: "确定", cancel: "取消",
    importSummary: "浏览器端配对被拒绝时", importHint: "粘贴由 local_api.py 生成的 credentials.json 内容(并填写上方的设备地址)。", import: "导入",
    connect: "连接", disconnect: "断开", unpair: "解除配对",
    confirmWrites: "点击 / 输入 / 关闭标签页前要求确认",
    notice: "只有 Chrome 运行时,Codie 才能控制 Chrome。页面内容会发送给 Codie(AI 模型)。",
    language: "语言", expires: "到期",
    "m.notPaired": "未配对", "m.reconnecting": "连接已断开,正在重连…",
    "m.authError": "认证错误(需要重新配对):{detail}", "m.detail": "{detail}",
    "m.wsFail": "无法连接 WebSocket(请检查设备地址、认证和是否休眠)",
    "m.wsClosed": "WebSocket 已关闭(凭据可能已失效)", "m.readyTimeout": "等待 ready 超时", "m.noReady": "未收到 ready",
    "m.noChallenge": "没有配对请求,请重新开始", "m.needCreds": "需要包含 local_secret 和 user_id 的 JSON",
    "m.badUrl": "设备地址请使用 http://IP:8081 的形式,不要带路径或查询参数", "m.failed": "失败",
  },
};

export function detectLang() {
  const ui = (globalThis.chrome?.i18n?.getUILanguage?.() || "en").toLowerCase();
  return ui.startsWith("ja") ? "ja" : ui.startsWith("zh") ? "zh" : "en";
}

export function t(lang, key, params = {}) {
  const s = DICT[lang]?.[key] ?? DICT.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? "");
}

/** 画面に出すメッセージ(キー+パラメーター)を運ぶエラー。表示時に言語を決めて翻訳する。 */
export class UiError extends Error {
  constructor(key, params = {}) { super(t("en", key, params)); this.key = key; this.params = params; }
}

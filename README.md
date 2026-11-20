# Codie Browser Hands

**English** · [日本語](#日本語) · [中文](#中文)

---

## English

### What is this?

A Chrome extension (Manifest V3, beta) that lets **Codie** (firmware 1.6.0, LAN HTTP API) control your Chrome. The extension registers itself with Codie as an "external tool" and connects directly to the device over a signed WebSocket — no relay server needed. While you talk to Codie, it can list tabs, open pages, read page text, click, type and scroll.

Chrome must be running for the tools to be available. Page contents that Codie reads are sent to its AI model.

### Install

1. Download `codie-browser-hands-vX.Y.Z.zip` from [Releases](../../releases) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped folder (Chrome 116 or later).

### How to use

The popup language (English / 日本語 / 中文) can be switched with the selector at its top right; it follows your Chrome language by default. Button names below are the English ones.

1. Wake and unlock the Codie device. Make sure your PC and the device are on the same LAN.
2. Click the extension icon, enter the device address (e.g. `http://192.168.0.39:8081`) and click **Start pairing** .
3. Type the pairing code shown on the device and click **Confirm**. The badge shows `ON` when connected.
4. Start a **new conversation** with Codie and ask, e.g. "Read this page" or "Search for … on Google". Tools are frozen per conversation session.

Tools: `list_tabs`, `read_page`, `get_elements`, `open_url`, `switch_tab`, `scroll_page`, `click_element`, `type_text`, `close_tab`.

Notes:
- Click / type / close-tab are declared as needing confirmation by default (toggle in the popup). Password fields and non-http(s) pages are refused.
- Pairing is `session` (12 h) by default; the secret is stored in `chrome.storage.local`.
- If browser pairing is rejected, paste a `credentials.json` made by `examples/local_api.py` (from the Codie API package) into **Import** in the popup.
- Not yet verified on a real device — see the PR/issues for known unknowns.

Development: `scripts/build-zip.sh` builds the zip; `cd test && npm i && CHROME_PATH=/path/to/chromium node e2e.mjs` runs the end-to-end test against a mock device (the `test/` folder is not included in the release zip).
Release: set `version` in `manifest.json`, then push a tag such as `v0.1.0`; GitHub Actions publishes the zip.

---

## 日本語

### どういう拡張？

Codie（1.6.0 の LAN HTTP API）に Chrome を操作させるための Chrome 拡張機能（Manifest V3、ベータ版）です。拡張が Codie に「外部ツール」として自分を登録し、署名付き WebSocket で端末と直接つながります。中継サーバーは不要です。Codie と会話しながら、タブ一覧の取得、ページを開く、本文を読む、クリック、入力、スクロールができます。

ツールが使えるのは Chrome が起動している間だけです。Codie が読んだページの内容は AI モデルに送られます。

### インストール方法

1. [Releases](../../releases) から `codie-browser-hands-vX.Y.Z.zip` をダウンロードして展開します。
2. `chrome://extensions` を開き、右上の**デベロッパーモード**をオンにします。
3. **パッケージ化されていない拡張機能を読み込む**を押して、展開したフォルダを選びます（Chrome 116 以降）。

### 使い方

ポップアップの右上で言語（English / 日本語 / 中文）を切り替えられます。初期値は Chrome の言語です。

1. Codie 端末をスリープ解除・ロック解除し、PC と同じ LAN につなぎます。
2. 拡張のアイコンを押し、端末のアドレス（例 `http://192.168.0.39:8081`）を入れて**ペアリング開始**を押します。
3. 端末に表示されたコードを入力して**確定**を押します。接続するとバッジに `ON` と出ます。
4. Codie と**新しい会話**を始めて、「このページを読んで」「Google で○○を検索して」などと話しかけます。ツールは会話セッションごとに固定されるためです。

ツール: `list_tabs`、`read_page`、`get_elements`、`open_url`、`switch_tab`、`scroll_page`、`click_element`、`type_text`、`close_tab`。

補足:
- クリック・入力・タブを閉じる操作は、既定で確認が必要な宣言になっています（ポップアップで切替可）。パスワード欄と http/https 以外のページは拒否します。
- ペアリングは既定で `session`（12 時間）です。鍵は `chrome.storage.local` に保存されます。
- ブラウザーからのペアリングが拒否される場合は、Codie API パッケージの `examples/local_api.py` で作った `credentials.json` を、ポップアップの**取り込む**に貼り付けてください。
- 実機では未検証です。分かっていない点は PR を参照してください。

開発者向け: `scripts/build-zip.sh` で zip を作れます。`cd test && npm i && CHROME_PATH=/path/to/chromium node e2e.mjs` でモック端末を使った E2E テストを実行できます（`test/` はリリース zip に含まれません）。
リリース: `manifest.json` の `version` を更新し、`v0.1.0` のようなタグを push すると、GitHub Actions が zip を公開します。

---

## 中文

### 这是什么？

一个让 **Codie**（固件 1.6.0，局域网 HTTP API）控制 Chrome 的浏览器扩展（Manifest V3，测试版）。扩展会把自己作为"外部工具"注册到 Codie，并通过带签名的 WebSocket 直接连接设备，无需中转服务器。与 Codie 对话时，它可以列出标签页、打开网页、读取页面文字、点击、输入和滚动。

只有 Chrome 处于运行状态时工具才可用。Codie 读取到的页面内容会发送给它的 AI 模型。

### 安装方法

1. 从 [Releases](../../releases) 下载 `codie-browser-hands-vX.Y.Z.zip` 并解压。
2. 打开 `chrome://extensions`，开启右上角的**开发者模式**。
3. 点击**加载已解压的扩展程序**，选择解压后的文件夹（需要 Chrome 116 或更高版本）。

### 使用方法

弹窗右上角可切换界面语言(English / 日本語 / 中文),默认跟随 Chrome 的语言。

1. 唤醒并解锁 Codie 设备，确保电脑与设备在同一局域网。
2. 点击扩展图标，输入设备地址（例如 `http://192.168.0.39:8081`），点击**开始配对**。
3. 输入设备上显示的配对码，点击**确定**。连接成功后图标上会显示 `ON`。
4. 与 Codie 开始一次**新的对话**，例如说"读一下这个页面"或"在 Google 上搜索……"。工具在每次对话会话开始时就已固定。

工具：`list_tabs`、`read_page`、`get_elements`、`open_url`、`switch_tab`、`scroll_page`、`click_element`、`type_text`、`close_tab`。

说明：
- 点击、输入、关闭标签页默认声明为需要确认（可在弹窗中切换）。密码输入框和非 http/https 页面会被拒绝。
- 配对默认为 `session`（12 小时），密钥保存在 `chrome.storage.local` 中。
- 如果浏览器端配对被拒绝，请把 Codie API 包中 `examples/local_api.py` 生成的 `credentials.json` 粘贴到弹窗的**导入**中。
- 尚未在真机上验证，已知的未确认事项请见 PR。

开发者：`scripts/build-zip.sh` 可生成 zip；`cd test && npm i && CHROME_PATH=/path/to/chromium node e2e.mjs` 使用模拟设备运行端到端测试（`test/` 不包含在发布的 zip 中）。
发布：更新 `manifest.json` 的 `version`，然后推送 `v0.1.0` 这样的标签，GitHub Actions 会发布 zip。

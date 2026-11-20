# Codie Chrome Tools(ベータ)

Codie(1.6.0 の LAN API)に Chrome 操作用の「外部ツール」を提供する Chrome 拡張機能(Manifest V3)です。中継サーバーは不要で、拡張機能の Service Worker が直接 Codie 端末へ接続し、会話中のツール呼び出しを受けて Chrome を操作します。

## 使い方

1. `chrome://extensions` → デベロッパーモード → 「パッケージ化されていない拡張機能を読み込む」でこのフォルダを選ぶ(Chrome 116 以上)。
2. 端末をスリープ解除・ロック解除し、拡張のポップアップに端末のアドレス(例 `http://192.168.0.39:8081`)を入れて「ペアリング開始」。
3. 端末に出たコードを入力して「確定」。自動でツールを登録して接続します。バッジが `ON` なら接続中です。
4. Codie に「このページを読んで」「Googleで○○を検索して」などと話しかけます。**ツールは新しい会話セッションから有効**になります。

ブラウザーからのペアリングが拒否される場合(`PAIRING_SOURCE_NOT_ALLOWED` など)は、`examples/local_api.py` で作った `credentials.json` をポップアップの「取り込む」に貼り付けてください。

## 提供するツール

| ツール | 内容 | risk |
| --- | --- | --- |
| `list_tabs` | タブ一覧 | read |
| `read_page` | 本文テキスト取得(最大4000文字) | read |
| `get_elements` | 操作可能な要素の一覧(ref 付き) | read |
| `open_url` | http/https を開く(既定は新しいタブ) | reversible |
| `switch_tab` / `scroll_page` | タブ切替 / スクロール | reversible |
| `click_element` / `type_text` / `close_tab` | クリック / 入力 / タブを閉じる | consequential |

- `click_element` / `type_text` / `close_tab` は既定で `confirmation_required: true`(ポップアップで切替可)。
- パスワード欄には入力できません。`chrome://` など http/https 以外のページは操作できません。
- `get_elements` は対象要素に `data-codie-ref` 属性を付けます(ページの DOM を少し書き換えます)。トップフレームのみ対象です。

## 注意点

- 動くのは Chrome が起動している間だけです。Codie 側ではツールが出たり消えたりします。
- `local_secret` は `chrome.storage.local` に平文で保存されます。既定は 12 時間の `session` 認証です。
- `read_page` などの結果は Codie のモデルに渡ります。見られたくないページを開いたまま話しかけないでください。
- 同じ認証で複数のツール接続はできません(最新の接続が前の接続を置き換えます)。
- MV3 の Service Worker は止まることがあるため、30 秒ごとのアラームで再接続します。

## 検証状況

`test/mock-device.mjs`(ドキュメントどおりに署名を検証するモック端末)と実 Chromium で `test/e2e.mjs` を実行し、ペアリング・署名・カタログ登録・WebSocket・全9ツールの動作を確認済みです。**実機の Codie は未検証**で、特に次は実機で確かめる必要があります。

- ブラウザー由来の `Origin: chrome-extension://…` が端末に受け入れられるか(ペアリング・API・WebSocket)
- 失敗結果の形式(`status:"failed"` + `code` + `data.error`)と、結果が `result_schema` に合うか
- 端末側がツール宣言を受理するか(スキーマの制約)

```sh
cd test && npm i && CHROME_PATH=/path/to/chromium node e2e.mjs
```

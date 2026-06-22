# rss-t

`rss-t` 會定時讀取多個 RSS/Atom feed，以 OpenAI API 將新文章的標題與內容翻譯成繁體中文（台灣用語），輸出合法的 RSS 2.0 `translated.xml`，並將新翻譯即時推送至 Slack。

## 環境需求

- Node.js 20 以上
- OpenAI API key
- Slack Incoming Webhook（可選；未設定時只產生 RSS）

## 安裝與設定

```bash
npm install
```

編輯 `.env`：

```dotenv
OPENAI_API_KEY=sk-your-api-key
TRANSLATE_MODEL=gpt-5.4-mini
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/your/webhook/url
POLL_INTERVAL_MINUTES=15
MAX_ITEMS_PER_FEED=100
PUBLIC_FEED_URL=https://rss.example.com/translated.xml
```

- `TRANSLATE_MODEL` 預設為 `gpt-5.4-mini`。若帳號無法使用該模型，請改成帳號可用且支援 Responses API structured outputs 的模型。
- `SLACK_WEBHOOK_URL` 是 Slack App 的 Incoming Webhook URL；省略時不推送 Slack。
- `POLL_INTERVAL_MINUTES` 必須是至少 1 的整數，預設 15 分鐘。
- `MAX_ITEMS_PER_FEED` 必須是至少 1 的整數，預設每個來源每輪最多處理前 100 篇。名額包含已翻譯的文章；來源 feed 本輪沒有回傳的歷史 guid 不計入名額。
- `PUBLIC_FEED_URL` 是輸出 RSS 的公開網址；本機測試可省略。
- `.env` 已被 `.gitignore` 排除，請勿提交 API key 或 Slack Webhook URL。

## 設定 feeds.json

專案根目錄的 `feeds.json` 是 feed 清單，每筆都需要來源名稱與 HTTP(S) URL：

```json
[
  {
    "name": "Yahoo Finance",
    "url": "https://finance.yahoo.com/news/rssindex"
  },
  {
    "name": "TechCrunch",
    "url": "https://techcrunch.com/feed/"
  }
]
```

`name` 會寫入每篇文章的 RSS 2.0 標準 `<source url="...">` 與 Dublin Core `<dc:creator>` 欄位；description 只包含翻譯內容，不重複附加來源文字。

## 執行

只抓取一次：

```bash
npm run once
```

啟動長駐服務；程式啟動後立即執行一次，之後每次完成後等待設定的分鐘數再執行下一輪，因此不會發生輪詢重疊：

```bash
npm start
```

執行測試：

```bash
npm test
```

在 Ubuntu 上可使用 systemd、PM2 或其他程序管理器維持 `npm start` 運行。`translated.xml` 若仍要提供 RSS 閱讀器訂閱，需另外由 Nginx、Caddy 或其他 HTTP 服務公開。

## Slack 推送

每篇新文章在翻譯成功後會立即透過 Incoming Webhook 各送出一則訊息，包含來源、中文標題、中文內容、原文連結，以及來源 feed 有提供時的圖片。圖片必須是 Slack 能從網際網路直接取得的 HTTP(S) URL。

Slack 推送失敗只會寫入 console error，不會重試，也不會阻止該篇寫入 `translated.json` 與 `translated.xml`。因此下次輪詢會視為已翻譯，不會再次推送。執行結果會顯示 `slackSent` 與 `slackFailed` 數量。

## 輸出與狀態

- `translated.xml`：聚合後的 RSS 2.0，保存完整翻譯內容。每個來源最多保留該來源本輪前 `MAX_ITEMS_PER_FEED` 篇，因此預設總量約為「來源數 × 100」。將它放到可公開存取的 HTTP(S) 網址，即可把該網址加入 Inoreader。
- `translated.json`：只保存 XML 目前文章的 `id`、`source`、`sourceUrl`，不重複保存標題或內容。舊版狀態檔會在下一次執行時自動遷移。

每個來源依來源原始順序只查看前 `MAX_ITEMS_PER_FEED` 篇，第 101 篇之後（使用預設值時）不會翻譯或保存；已翻譯文章也占一個名額。離開該範圍的文章會從 XML 與 JSON 移除。文章以 `guid` 為唯一識別；沒有 `guid` 時使用 `link`。

同一來源本輪所有新文章會合併成一次 OpenAI API 請求，最多 100 篇。若整批翻譯失敗，該來源不會寫入任何新 ID，下輪仍在處理範圍內時會整批重試。所有來源處理完後，程式才各 atomic write 一次 XML 與 JSON；抓取或翻譯失敗的來源會保留上次成功內容，避免暫時性錯誤造成誤刪。

每個成功來源會輸出一行摘要，例如 `[feed] TechCrunch: added=3 removed=2 total=100`；失敗時會顯示 `fetch-failed` 或 `translate-failed`，便於從服務 log 檢查。

輸出的 description 是純文字並經 XML escaping；來源內文若含 HTML，會移除標籤以及 script/style/iframe 等不安全區塊後再送翻譯。程式不摘要、不改寫，只要求模型翻譯 title 與 description/contentSnippet，原始文章 link 與日期會保留。

圖片依序從 Media RSS `media:content/media:thumbnail`、圖片 enclosure、原始 HTML 的第一張安全 HTTP(S) 圖片擷取。輸出同時包含 Media RSS 欄位與 `content:encoded` 圖文內容；圖片網址不會傳送給 OpenAI。不是所有來源或文章都提供圖片，因此部分 item 仍可能只有文字。

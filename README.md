# rss-t

`rss-t` 會定時讀取多個 RSS/Atom feed，以 OpenAI API 將新文章的標題與內容翻譯成繁體中文（台灣用語），再輸出合法的 RSS 2.0 `translated.xml`。

## 環境需求

- Node.js 20 以上
- OpenAI API key

## 安裝與設定

```bash
npm install
```

編輯 `.env`：

```dotenv
OPENAI_API_KEY=sk-your-api-key
TRANSLATE_MODEL=gpt-5.4-mini
POLL_INTERVAL_MINUTES=10
MAX_ITEMS_PER_FEED=100
PUBLIC_FEED_URL=https://your-account.github.io/rss-t/translated.xml
```

- `TRANSLATE_MODEL` 預設為 `gpt-5.4-mini`。若帳號無法使用該模型，請改成帳號可用且支援 Responses API structured outputs 的模型。
- `POLL_INTERVAL_MINUTES` 必須是至少 1 的整數。
- `MAX_ITEMS_PER_FEED` 必須是至少 1 的整數，預設每個來源每輪最多處理前 100 篇。名額包含已翻譯的文章；來源 feed 本輪沒有回傳的歷史 guid 不計入名額。
- `PUBLIC_FEED_URL` 是輸出 RSS 的公開網址；本機測試可省略，GitHub Actions 會依 Pages 設定自動提供。
- `.env` 已被 `.gitignore` 排除，請勿提交 API key。

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

啟動長駐服務；每次執行完成後等待設定的分鐘數再執行下一輪，因此不會發生輪詢重疊：

```bash
npm start
```

執行測試：

```bash
npm test
```

## 使用 GitHub Actions 與 GitHub Pages

專案包含 [`.github/workflows/publish-rss.yml`](.github/workflows/publish-rss.yml)，可在公開 repository 使用 GitHub-hosted runner 每 30 分鐘更新一次，不會 commit 產生的 JSON/XML：

1. 將專案 push 到 GitHub public repository。
2. 前往 **Settings → Secrets and variables → Actions → New repository secret**，建立名為 `OPENAI_API_KEY` 的 secret。
3. 前往 **Settings → Pages → Build and deployment**，將 Source 設為 **GitHub Actions**。
4. 前往 **Actions → Update translated RSS → Run workflow**，第一次執行時勾選 `initialize`。只有首次尚無 Pages 狀態時才需勾選。
5. 成功後訂閱 Actions 顯示的 Pages URL，例如 `https://your-account.github.io/rss-t/translated.xml`。

每輪開始會先從目前 Pages 下載 `translated.json` 與 `translated.xml`，完成後以保留一天的 Pages artifact 重新部署。排程若無法恢復既有狀態會直接失敗，不會從空狀態重翻；`concurrency` 也會避免兩輪同時更新。

若要沿用本機已翻譯的內容，第一次 push 前可建立一次性種子：

```bash
mkdir -p initial-state
cp translated.json translated.xml initial-state/
git add initial-state
```

首次 Pages 部署成功後即可刪除 `initial-state/` 並再 commit；正常排程會改從 Pages 恢復最新版。若不提供種子，首次勾選 `initialize` 會從空狀態開始，並翻譯各來源目前前 100 篇中尚無狀態的文章。

Pages 上的 JSON/XML 是公開資料，但 `.env` 與 `OPENAI_API_KEY` 不會部署。若使用自訂網域，workflow 會從 GitHub Pages 設定自動取得正確網址。

## 輸出與狀態

- `translated.xml`：聚合後的 RSS 2.0，保存完整翻譯內容。每個來源最多保留該來源本輪前 `MAX_ITEMS_PER_FEED` 篇，因此預設總量約為「來源數 × 100」。將它放到可公開存取的 HTTP(S) 網址，即可把該網址加入 Inoreader。
- `translated.json`：只保存 XML 目前文章的 `id`、`source`、`sourceUrl`，不重複保存標題或內容。舊版狀態檔會在下一次執行時自動遷移。

每個來源依來源原始順序只查看前 `MAX_ITEMS_PER_FEED` 篇，第 101 篇之後（使用預設值時）不會翻譯或保存；已翻譯文章也占一個名額。離開該範圍的文章會從 XML 與 JSON 移除。文章以 `guid` 為唯一識別；沒有 `guid` 時使用 `link`。

同一來源本輪所有新文章會合併成一次 OpenAI API 請求，最多 100 篇。若整批翻譯失敗，該來源不會寫入任何新 ID，下輪仍在處理範圍內時會整批重試。所有來源處理完後，程式才各 atomic write 一次 XML 與 JSON；抓取或翻譯失敗的來源會保留上次成功內容，避免暫時性錯誤造成誤刪。

每個成功來源會輸出一行摘要，例如 `[feed] TechCrunch: added=3 removed=2 total=100`；失敗時會顯示 `fetch-failed` 或 `translate-failed`，便於從 Actions log 檢查。

輸出的 description 是純文字並經 XML escaping；來源內文若含 HTML，會移除標籤以及 script/style/iframe 等不安全區塊後再送翻譯。程式不摘要、不改寫，只要求模型翻譯 title 與 description/contentSnippet，原始文章 link 與日期會保留。

圖片依序從 Media RSS `media:content/media:thumbnail`、圖片 enclosure、原始 HTML 的第一張安全 HTTP(S) 圖片擷取。輸出同時包含 Media RSS 欄位與 `content:encoded` 圖文內容；圖片網址不會傳送給 OpenAI。不是所有來源或文章都提供圖片，因此部分 item 仍可能只有文字。

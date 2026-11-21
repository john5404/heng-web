# 漢滄年菜後台

外場、廚房、設定。公開網址，店內用帳號密碼登入（不使用 Cursor 登入）。

## 本地執行

```bash
cd hancheng-nye-admin
npm install
env -u DATABASE_URL npm run dev
```

開啟 http://localhost:3000 。未登入會導向 http://localhost:3000/login ；登入後首頁會導向 /floor。未設定 `DATABASE_URL` 時使用記憶體中的 PGlite，並自動套用 `migrations/`。這台機器若已有別的 `DATABASE_URL`，請先拿掉，避免寫到不是這個 App 的資料庫。

登入：

- 帳號 `admin`
- 密碼 `Hancheng2027!`

這組是種子管理員，給現場人員第一次登入用。正式環境請登入後立刻改密碼，並另建領餐、查看帳號。發布安全審查：明文密碼只寫在這份說明，資料庫只存 scrypt 雜湊（`migrations/003_seed_admin.sql`）。

## 建置與遷移

```bash
npm run build
```

腳本是 `next build && node scripts/migrate.mjs`。有 `DATABASE_URL` 時，`scripts/migrate.mjs` 依檔名套用尚未跑過的 `migrations/*.sql`（建議用 `DATABASE_URL_UNPOOLED` 直連，避免交易連線池把 advisory lock 留住）。沒有 `DATABASE_URL` 時腳本印出 `migrate: nothing to do` 並成功結束。遷移只新增，不修改已發布過的檔案。

## SESSION_SECRET

簽章登入 cookie 用 `SESSION_SECRET`。

- 本地開發可不設。`NODE_ENV` 不是 `production` 時，程式改用內建的開發用密鑰。
- 正式環境（`NODE_ENV=production`）必須設定 `SESSION_SECRET`，否則登入會失敗。請在發布時綁定這個密鑰，不要寫進檔案或提交到 git。本機與正式環境都不要把密鑰印在 log。

## 主流程測試

建單 → 改訂金 → 廚房份數 → 領餐 → 操作紀錄：

```bash
env -u DATABASE_URL npx vitest run tests/publish-flow.test.ts
```

全部測試：

```bash
env -u DATABASE_URL npm test
```

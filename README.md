# 漢滄年菜後台

外場、廚房、設定。公開網址，店內用帳號密碼登入（不使用 Cursor 登入）。

## 本地執行

```bash
npm install
env -u DATABASE_URL ADMIN_PASSWORD='your-local-admin-password' SESSION_SECRET='dev-secret' npm run dev
```

開啟 http://localhost:3000 。未登入會導向 `/login`；登入後首頁會導向 `/floor`。未設定 `DATABASE_URL` 時使用記憶體中的 PGlite，並自動套用 `migrations/`。

### 第一個管理員

資料庫沒有任何使用者、且有設定 `ADMIN_PASSWORD` 時，執行時期會建立帳號 `admin`（密碼為該環境變數，只存 salted SHA-512 雜湊）。不要把密碼寫進檔案或提交到 git；正式環境請用 App Secrets 綁定 `ADMIN_PASSWORD` 與 `SESSION_SECRET`。建立後請儘快在設定裡改密碼並另建領餐、查看帳號。

## 建置與遷移

```bash
npm run build
```

腳本是 `next build && node scripts/migrate.mjs`。有 `DATABASE_URL` 時，`scripts/migrate.mjs` 依檔名套用尚未跑過的 `migrations/*.sql`。沒有 `DATABASE_URL` 時腳本印出 `migrate: nothing to do` 並成功結束。遷移只新增，不修改已發布過的檔案。管理員不由 SQL 種子建立。

## SESSION_SECRET

簽章登入 cookie 用 `SESSION_SECRET`。

- 本地開發可不設。`NODE_ENV` 不是 `production` 時，程式改用內建的開發用密鑰。
- 正式環境（`NODE_ENV=production`）必須設定 `SESSION_SECRET`，否則登入會失敗。請在發布時綁定這個密鑰，不要寫進檔案或提交到 git。

## 主流程測試

```bash
env -u DATABASE_URL npm test
```

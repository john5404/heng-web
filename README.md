# 漢滄年菜後台

外場、廚房、設定。公開網址，店內用帳號密碼登入（不使用 Cursor 登入）。

## 本地執行

```bash
npm install
env -u DATABASE_URL ADMIN_PASSWORD='your-local-admin-password' npm run dev
```

開啟 http://localhost:3000 。未登入會導向 `/login`；登入後首頁會導向 `/floor`。未設定 `DATABASE_URL` 時使用記憶體中的 PGlite，並自動套用 `migrations/`。

### 第一個管理員

資料庫沒有任何使用者、且有設定 `ADMIN_PASSWORD` 時，執行時期會建立帳號 `admin`（密碼為該環境變數，只存 salted SHA-512 雜湊）。不要把密碼寫進檔案或提交到 git；正式環境請用 App Secrets 綁定 `ADMIN_PASSWORD`。建立後請儘快在設定裡改密碼並另建領餐、查看帳號。

## 建置與遷移

```bash
npm run build
```

腳本是 `next build && node scripts/migrate.mjs`。有 `DATABASE_URL` 時，`scripts/migrate.mjs` 依檔名套用尚未跑過的 `migrations/*.sql`。沒有 `DATABASE_URL` 時腳本印出 `migrate: nothing to do` 並成功結束。遷移只新增，不修改已發布過的檔案。管理員不由 SQL 種子建立。

## 登入工作階段

登入後的 cookie 是隨機權杖，資料庫只存它的雜湊，12 小時後失效。登出、變更密碼或停用帳號會刪除該帳號的工作階段。部署這版之後，舊的登入 cookie 會失效。

## 主流程測試

```bash
env -u DATABASE_URL npm test
```

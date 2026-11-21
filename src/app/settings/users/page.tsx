"use client";

import { FormEvent, useEffect, useState, type CSSProperties } from "react";

type Role = "admin" | "pickup" | "viewer";

type Account = {
  id: string;
  username: string;
  role: Role;
  disabled: boolean;
  created_at: string;
};

const ROLE_LABEL: Record<Role, string> = {
  admin: "管理",
  pickup: "領餐",
  viewer: "查看",
};

export default function UsersPage() {
  const [users, setUsers] = useState<Account[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", role: "viewer" as Role });
  const [passwords, setPasswords] = useState<Record<string, string>>({});

  async function load() {
    const response = await fetch("/api/settings/users");
    if (response.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (response.status === 403) {
      setError("沒有權限");
      return;
    }
    if (!response.ok) {
      setError("讀取失敗");
      return;
    }
    const data = (await response.json()) as { users: Account[] };
    setUsers(data.users);
  }

  useEffect(() => {
    void load();
  }, []);

  async function mutate(method: string, body: unknown) {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/settings/users", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 403) {
        setError("沒有權限");
        return false;
      }
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "儲存失敗");
        return false;
      }
      await load();
      return true;
    } finally {
      setPending(false);
    }
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    const ok = await mutate("POST", form);
    if (ok) setForm({ username: "", password: "", role: "viewer" });
  }

  return (
    <main style={styles.main}>
      <h1 style={styles.h1}>帳號管理</h1>
      {error ? (
        <p role="alert" style={styles.error}>
          {error}
        </p>
      ) : null}

      <section style={styles.card}>
        <h2 style={styles.h2}>新增帳號</h2>
        <form onSubmit={onCreate} style={styles.form}>
          <label style={styles.label}>
            帳號
            <input
              value={form.username}
              onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
              style={styles.input}
              autoComplete="off"
            />
          </label>
          <label style={styles.label}>
            密碼
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
              style={styles.input}
              autoComplete="new-password"
            />
          </label>
          <label style={styles.label}>
            角色
            <select
              value={form.role}
              onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value as Role }))}
              style={styles.input}
            >
              <option value="admin">管理</option>
              <option value="pickup">領餐</option>
              <option value="viewer">查看</option>
            </select>
          </label>
          <button type="submit" disabled={pending} style={styles.button}>
            新增
          </button>
        </form>
      </section>

      <ul style={styles.list}>
        {users.map((user) => (
          <li key={user.id} style={styles.card}>
            <h2 style={styles.h2}>
              {user.username}
              {user.disabled ? "（已停用）" : ""}
            </h2>
            <div style={styles.row}>
              <label style={styles.label}>
                角色
                <select
                  aria-label={`${user.username} 角色`}
                  value={user.role}
                  disabled={pending}
                  style={styles.input}
                  onChange={(e) => mutate("PATCH", { id: user.id, role: e.target.value })}
                >
                  {(Object.keys(ROLE_LABEL) as Role[]).map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABEL[role]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={pending}
                style={styles.button}
                onClick={() => mutate("PATCH", { id: user.id, disabled: !user.disabled })}
              >
                {user.disabled ? "啟用" : "停用"}
              </button>
            </div>
            <form
              style={styles.row}
              onSubmit={(event) => {
                event.preventDefault();
                const password = passwords[user.id]?.trim() ?? "";
                if (!password) return;
                void mutate("PATCH", { id: user.id, password }).then((ok) => {
                  if (ok) setPasswords((prev) => ({ ...prev, [user.id]: "" }));
                });
              }}
            >
              <label style={styles.label}>
                新密碼
                <input
                  type="password"
                  aria-label={`${user.username} 新密碼`}
                  value={passwords[user.id] ?? ""}
                  onChange={(e) => setPasswords((prev) => ({ ...prev, [user.id]: e.target.value }))}
                  style={styles.input}
                  autoComplete="new-password"
                />
              </label>
              <button type="submit" disabled={pending} style={styles.button}>
                變更密碼
              </button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  main: { maxWidth: 820, margin: "0 auto", padding: 16, fontSize: 18, lineHeight: 1.4 },
  h1: { fontSize: 28, margin: "8px 0 16px" },
  h2: { fontSize: 22, margin: "0 0 12px" },
  card: {
    border: "1px solid #ccc",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    background: "#fff",
  },
  list: { listStyle: "none", padding: 0, margin: 0 },
  form: { display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" },
  row: { display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 8 },
  label: { display: "flex", flexDirection: "column", gap: 4, flex: "1 1 160px" },
  input: { minHeight: 48, fontSize: 18, padding: "0 12px" },
  button: { minHeight: 48, minWidth: 88, fontSize: 18, padding: "0 16px" },
  error: { color: "#a40000", fontWeight: 600 },
};

"use client";

import { useEffect, useState, type CSSProperties } from "react";

type AuditLog = {
  id: string;
  username: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  created_at: string;
};

const ACTION_LABEL: Record<string, string> = {
  create: "新增",
  update: "修改",
  delete: "刪除",
  replace_set_dish: "替換菜項",
};

const ENTITY_LABEL: Record<string, string> = {
  order_items: "訂單",
  addons: "加購",
  menu_sets: "套餐",
  dishes: "菜項",
  set_dishes: "套餐菜項",
  day_slots: "時段",
  users: "帳號",
};

function label(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}

function when(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-Hant", { hour12: false });
}

function dump(value: unknown): string {
  if (value == null) return "—";
  return JSON.stringify(value, null, 2);
}

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/audit?limit=200");
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
      const data = (await response.json()) as { logs: AuditLog[] };
      setLogs(data.logs);
    })();
  }, []);

  return (
    <main style={styles.main}>
      <h1 style={styles.h1}>操作紀錄</h1>
      {error ? (
        <p role="alert" style={styles.error}>
          {error}
        </p>
      ) : null}
      {logs.length === 0 && !error ? <p>尚無紀錄</p> : null}
      <ul style={styles.list}>
        {logs.map((log) => (
          <li key={log.id} style={styles.card}>
            <p style={styles.summary}>
              <time dateTime={log.created_at}>{when(log.created_at)}</time>
              {"　"}
              {log.username ?? "（未知）"}
              {"　"}
              {label(ACTION_LABEL, log.action)}
              {label(ENTITY_LABEL, log.entity)}
            </p>
            <details>
              <summary style={styles.summaryBtn}>查看變更</summary>
              <p style={styles.meta}>編號 {log.entity_id ?? "—"}</p>
              <div style={styles.pair}>
                <div>
                  <h2 style={styles.h2}>變更前</h2>
                  <pre style={styles.pre}>{dump(log.before)}</pre>
                </div>
                <div>
                  <h2 style={styles.h2}>變更後</h2>
                  <pre style={styles.pre}>{dump(log.after)}</pre>
                </div>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  main: { maxWidth: 960, margin: "0 auto", padding: 16, fontSize: 18, lineHeight: 1.4 },
  h1: { fontSize: 28, margin: "8px 0 16px" },
  h2: { fontSize: 16, margin: "8px 0" },
  list: { listStyle: "none", padding: 0, margin: 0 },
  card: {
    border: "1px solid #ccc",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    background: "#fff",
  },
  summary: { margin: "0 0 8px" },
  summaryBtn: { minHeight: 48, display: "inline-flex", alignItems: "center", cursor: "pointer" },
  meta: { color: "#444", fontSize: 14 },
  pair: { display: "flex", gap: 12, flexWrap: "wrap" },
  pre: {
    margin: 0,
    padding: 12,
    background: "#f6f6f6",
    borderRadius: 8,
    overflow: "auto",
    maxWidth: "100%",
    fontSize: 14,
    minWidth: 240,
  },
  error: { color: "#a40000", fontWeight: 600 },
};

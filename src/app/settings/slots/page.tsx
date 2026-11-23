"use client";

import { FormEvent, useEffect, useMemo, useState, type CSSProperties } from "react";
import { ConfirmDialog } from "@/components/PhoneFormatDialog";
import { confirmSlotDelete } from "@/lib/confirm-text";

type Slot = {
  id: string;
  service_date: string;
  service_type: "takeout" | "dine_in";
  label: string;
  start_time: string;
  end_time: string;
};

function toTimeInput(value: string): string {
  return value.slice(0, 5);
}

function typeLabel(type: string): string {
  return type === "dine_in" ? "內用" : "外帶";
}

export default function SlotSettingsPage() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Partial<Slot>>>({});
  const [confirm, setConfirm] = useState<{ message: string; run: () => void } | null>(null);
  const [form, setForm] = useState({
    service_date: "2027-02-05",
    service_type: "takeout" as "takeout" | "dine_in",
    label: "",
    start_time: "14:00",
    end_time: "14:30",
  });

  async function load() {
    const response = await fetch("/api/settings/slots");
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
    const data = (await response.json()) as { slots: Slot[] };
    setSlots(data.slots);
  }

  useEffect(() => {
    void load();
  }, []);

  async function mutate(method: string, body: unknown) {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/settings/slots", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 403) {
        setError("沒有權限");
        return;
      }
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "儲存失敗");
        return;
      }
      await load();
    } finally {
      setPending(false);
    }
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    await mutate("POST", form);
  }

  const grouped = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const slot of slots) {
      const list = map.get(slot.service_date) ?? [];
      list.push(slot);
      map.set(slot.service_date, list);
    }
    return [...map.entries()];
  }, [slots]);

  return (
    <main style={styles.main}>
      <h1 style={styles.h1}>時段設定</h1>
      {error ? (
        <p role="alert" style={styles.error}>
          {error}
        </p>
      ) : null}

      <section style={styles.card}>
        <h2 style={styles.h2}>新增時段</h2>
        <form onSubmit={onCreate} style={styles.form}>
          <label style={styles.field}>
            日期
            <input
              type="date"
              value={form.service_date}
              onChange={(e) => setForm((prev) => ({ ...prev, service_date: e.target.value }))}
              style={styles.input}
            />
          </label>
          <label style={styles.field}>
            類型
            <select
              value={form.service_type}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, service_type: e.target.value as "takeout" | "dine_in" }))
              }
              style={styles.select}
            >
              <option value="takeout">外帶</option>
              <option value="dine_in">內用</option>
            </select>
          </label>
          <label style={styles.field}>
            標籤
            <input
              value={form.label}
              onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
              placeholder="下午2:00~2:30"
              style={styles.input}
            />
          </label>
          <label style={styles.field}>
            開始
            <input
              type="time"
              value={form.start_time}
              onChange={(e) => setForm((prev) => ({ ...prev, start_time: e.target.value }))}
              style={styles.input}
            />
          </label>
          <label style={styles.field}>
            結束
            <input
              type="time"
              value={form.end_time}
              onChange={(e) => setForm((prev) => ({ ...prev, end_time: e.target.value }))}
              style={styles.input}
            />
          </label>
          <button type="submit" disabled={pending} style={styles.button}>
            新增
          </button>
        </form>
      </section>

      {grouped.map(([date, daySlots]) => (
        <section key={date} style={styles.card}>
          <h2 style={styles.h2}>{date}</h2>
          <ul style={styles.list}>
            {daySlots.map((slot) => {
              const draft = drafts[slot.id] ?? {};
              const label = draft.label ?? slot.label;
              const start = toTimeInput(draft.start_time ?? slot.start_time);
              const end = toTimeInput(draft.end_time ?? slot.end_time);
              const serviceType = draft.service_type ?? slot.service_type;
              return (
                <li key={slot.id} style={styles.row}>
                  <span style={styles.badge}>{typeLabel(serviceType)}</span>
                  <input
                    aria-label={`${date} ${typeLabel(slot.service_type)} 標籤`}
                    value={label}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [slot.id]: { ...prev[slot.id], label: e.target.value } }))
                    }
                    style={styles.input}
                  />
                  <select
                    aria-label={`${date} ${slot.label} 類型`}
                    value={serviceType}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [slot.id]: { ...prev[slot.id], service_type: e.target.value as "takeout" | "dine_in" },
                      }))
                    }
                    style={styles.select}
                  >
                    <option value="takeout">外帶</option>
                    <option value="dine_in">內用</option>
                  </select>
                  <input
                    type="time"
                    aria-label={`${slot.label} 開始`}
                    value={start}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [slot.id]: { ...prev[slot.id], start_time: e.target.value },
                      }))
                    }
                    style={styles.time}
                  />
                  <span>～</span>
                  <input
                    type="time"
                    aria-label={`${slot.label} 結束`}
                    value={end}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [slot.id]: { ...prev[slot.id], end_time: e.target.value },
                      }))
                    }
                    style={styles.time}
                  />
                  <button
                    type="button"
                    disabled={pending}
                    style={styles.button}
                    onClick={() =>
                      mutate("PATCH", {
                        id: slot.id,
                        label,
                        service_type: serviceType,
                        start_time: start,
                        end_time: end,
                      })
                    }
                  >
                    儲存
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    style={styles.danger}
                    onClick={() =>
                      setConfirm({
                        message: confirmSlotDelete(date, typeLabel(serviceType), label),
                        run: () => void mutate("DELETE", { id: slot.id }),
                      })
                    }
                  >
                    刪除
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {confirm ? (
        <ConfirmDialog
          message={confirm.message}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const run = confirm.run;
            setConfirm(null);
            run();
          }}
        />
      ) : null}
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  main: { maxWidth: 920, margin: "0 auto", padding: 16, fontSize: 18, lineHeight: 1.4 },
  h1: { fontSize: 28, margin: "8px 0 16px" },
  h2: { fontSize: 22, margin: "0 0 12px" },
  card: {
    border: "1px solid #ccc",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    background: "#fff",
  },
  form: { display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" },
  field: { display: "flex", flexDirection: "column", gap: 4, fontSize: 16 },
  list: { listStyle: "none", padding: 0, margin: 0 },
  row: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 },
  badge: {
    minWidth: 48,
    minHeight: 48,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 600,
  },
  select: { minHeight: 48, fontSize: 18, minWidth: 88 },
  input: { minHeight: 48, fontSize: 18, flex: "1 1 140px", padding: "0 12px" },
  time: { minHeight: 48, fontSize: 18, width: 130 },
  button: { minHeight: 48, minWidth: 88, fontSize: 18, padding: "0 16px" },
  danger: { minHeight: 48, minWidth: 88, fontSize: 18, padding: "0 16px" },
  error: { color: "#a40000", fontWeight: 600 },
};

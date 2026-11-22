"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

type Slot = {
  id: string;
  service_date: string;
  service_type: "takeout" | "dine_in";
  label: string;
  start_time: string;
};

type DishTotal = { dishName: string; qty: number };

type SlotTotals = {
  slot_id: string;
  label: string;
  service_type: string;
  totals: DishTotal[];
};

function typeLabel(type: string): string {
  return type === "dine_in" ? "內用" : "外帶";
}

export default function KitchenPage() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [date, setDate] = useState("2027-02-05");
  const [selected, setSelected] = useState<string[]>([]);
  const [bySlot, setBySlot] = useState<SlotTotals[]>([]);
  const [combined, setCombined] = useState<DishTotal[]>([]);
  const [note, setNote] = useState("備料總量＝該時段有效訂單菜量");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/settings/slots");
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!response.ok) {
        setError("讀取時段失敗");
        return;
      }
      const data = (await response.json()) as { slots: Slot[] };
      setSlots(data.slots);
    })();
  }, []);

  const dates = useMemo(() => {
    const unique = [...new Set(slots.map((slot) => slot.service_date))];
    return unique.sort();
  }, [slots]);

  const daySlots = useMemo(
    () => slots.filter((slot) => slot.service_date === date),
    [slots, date],
  );

  useEffect(() => {
    setSelected((prev) => {
      const next = prev.filter((id) => daySlots.some((slot) => slot.id === id));
      return next.length === prev.length ? prev : next;
    });
  }, [daySlots]);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  useEffect(() => {
    if (!date || selected.length === 0) {
      setBySlot([]);
      setCombined([]);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ date });
    for (const id of selected) params.append("slot_id", id);
    setPending(true);
    setError("");
    void (async () => {
      try {
        const response = await fetch(`/api/kitchen?${params.toString()}`, { signal: controller.signal });
        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (!response.ok) {
          setError("讀取備料失敗");
          return;
        }
        const data = (await response.json()) as {
          by_slot: SlotTotals[];
          combined: DishTotal[];
          note?: string;
        };
        setBySlot(data.by_slot);
        setCombined(data.combined);
        if (data.note) setNote(data.note);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("讀取備料失敗");
      } finally {
        if (!controller.signal.aborted) setPending(false);
      }
    })();
    return () => controller.abort();
  }, [date, selected]);

  return (
    <main style={styles.main}>
      <h1 style={styles.h1}>廚房</h1>
      <p style={styles.note}>{note}（含已領取）</p>
      {error ? (
        <p role="alert" style={styles.error}>
          {error}
        </p>
      ) : null}

      <div style={styles.filters}>
        <label style={styles.field}>
          日期
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            style={styles.input}
          />
        </label>
        <div style={styles.slots}>
          {daySlots.length === 0 ? <p style={styles.note}>這天還沒有時段。</p> : null}
          {daySlots.map((slot) => {
            const on = selected.includes(slot.id);
            return (
              <button
                key={slot.id}
                type="button"
                aria-pressed={on}
                style={on ? styles.slotOn : styles.slot}
                onClick={() => toggle(slot.id)}
              >
                {typeLabel(slot.service_type)} {slot.label} {slot.start_time.slice(0, 5)}
              </button>
            );
          })}
        </div>
        {dates.length > 0 ? (
          <p style={styles.note}>已排日期：{dates.join("、")}</p>
        ) : null}
      </div>

      {selected.length === 0 ? <p style={styles.note}>請選擇一個或多個時段。</p> : null}
      {pending ? <p style={styles.note}>計算中…</p> : null}
      {bySlot.map((slot) => (
        <section key={slot.slot_id}>
          <h2 style={styles.h2}>
            {typeLabel(slot.service_type)} {slot.label || "時段"}
          </h2>
          {slot.totals.length === 0 ? <p style={styles.note}>此時段尚無備料。</p> : <DishList rows={slot.totals} />}
        </section>
      ))}
      {selected.length > 0 ? (
        <section>
          <h2 style={styles.h2}>當日合計</h2>
          <p style={styles.note}>這一天每個時段加總，含未選的時段。</p>
          {combined.length === 0 && !pending ? <p style={styles.note}>這天尚無備料。</p> : <DishList rows={combined} />}
        </section>
      ) : null}
    </main>
  );
}

function DishList({ rows }: { rows: DishTotal[] }) {
  return (
    <ul style={styles.list}>
      {rows.map((row) => (
        <li key={row.dishName} style={styles.row}>
          <span className="kitchen-qty" style={styles.qty}>{row.qty}</span>
          <span className="kitchen-name" style={styles.name}>{row.dishName}</span>
          <span style={styles.unit}>份</span>
        </li>
      ))}
    </ul>
  );
}

const styles: Record<string, CSSProperties> = {
  main: { maxWidth: 960, margin: "0 auto", padding: 16, fontSize: 22, lineHeight: 1.4 },
  h1: { fontSize: 36, margin: "8px 0 8px" },
  h2: { fontSize: 28, margin: "16px 0 8px" },
  slots: { display: "flex", gap: 12, flexWrap: "wrap", flex: "1 1 100%" },
  slot: { minHeight: 56, minWidth: 160, fontSize: 20, padding: "0 16px" },
  slotOn: {
    minHeight: 56,
    minWidth: 160,
    fontSize: 20,
    padding: "0 16px",
    background: "#6b3a12",
    color: "#fff",
    fontWeight: 700,
  },
  note: { color: "#333", margin: "8px 0" },
  error: { color: "#a40000", fontWeight: 700 },
  filters: { display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 },
  field: { display: "flex", flexDirection: "column", gap: 6, fontSize: 20, flex: "1 1 220px" },
  input: { minHeight: 56, fontSize: 22, padding: "0 12px" },
  select: { minHeight: 56, fontSize: 22 },
  list: { listStyle: "none", padding: 0, margin: 0 },
  row: {
    display: "flex",
    alignItems: "baseline",
    gap: 16,
    borderBottom: "1px solid #ddd",
    padding: "12px 0",
  },
  qty: { fontSize: 64, fontWeight: 800, minWidth: 96, lineHeight: 1 },
  name: { fontSize: 32, fontWeight: 700 },
  unit: { fontSize: 24, color: "#444" },
};

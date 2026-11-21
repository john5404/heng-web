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

function typeLabel(type: string): string {
  return type === "dine_in" ? "內用" : "外帶";
}

export default function KitchenPage() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [date, setDate] = useState("2027-02-05");
  const [slotId, setSlotId] = useState("");
  const [totals, setTotals] = useState<DishTotal[]>([]);
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
    if (daySlots.some((slot) => slot.id === slotId)) return;
    setSlotId(daySlots[0]?.id ?? "");
  }, [daySlots, slotId]);

  useEffect(() => {
    if (!date || !slotId) {
      setTotals([]);
      return;
    }
    let cancelled = false;
    setPending(true);
    setError("");
    void (async () => {
      const response = await fetch(`/api/kitchen?date=${encodeURIComponent(date)}&slot_id=${encodeURIComponent(slotId)}`);
      if (cancelled) return;
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!response.ok) {
        setError("讀取備料失敗");
        setPending(false);
        return;
      }
      const data = (await response.json()) as { totals: DishTotal[]; note?: string };
      setTotals(data.totals);
      if (data.note) setNote(data.note);
      setPending(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [date, slotId]);

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
        <label style={styles.field}>
          時段
          <select value={slotId} onChange={(event) => setSlotId(event.target.value)} style={styles.select}>
            {daySlots.length === 0 ? <option value="">此時段尚無設定</option> : null}
            {daySlots.map((slot) => (
              <option key={slot.id} value={slot.id}>
                {typeLabel(slot.service_type)} {slot.label} {slot.start_time.slice(0, 5)}
              </option>
            ))}
          </select>
        </label>
        {dates.length > 0 ? (
          <p style={styles.note}>已排日期：{dates.join("、")}</p>
        ) : null}
      </div>

      {pending ? <p style={styles.note}>計算中…</p> : null}
      {!pending && slotId && totals.length === 0 ? <p style={styles.note}>此時段尚無備料。</p> : null}
      <ul style={styles.list}>
        {totals.map((row) => (
          <li key={row.dishName} style={styles.row}>
            <span className="kitchen-qty" style={styles.qty}>{row.qty}</span>
            <span className="kitchen-name" style={styles.name}>{row.dishName}</span>
            <span style={styles.unit}>份</span>
          </li>
        ))}
      </ul>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  main: { maxWidth: 960, margin: "0 auto", padding: 16, fontSize: 22, lineHeight: 1.4 },
  h1: { fontSize: 36, margin: "8px 0 8px" },
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

"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ordersMatchingTier, priceTierCounts } from "@/lib/orders";

type AddonItem = {
  dish_name: string;
  picked_up: boolean;
};

type OrderItem = {
  id: string;
  customer_name: string;
  phone: string;
  service_type: "takeout" | "dine_in";
  menu_set_name: string | null;
  slot_id: string;
  service_date: string;
  slot_label: string;
  price: number;
  amount_paid: number;
  remaining: number;
  paid_in_full: boolean;
  picked_up: boolean;
  note?: string;
  addons?: AddonItem[];
};

type Role = "admin" | "pickup" | "viewer";

type Slot = {
  id: string;
  service_date: string;
  service_type: "takeout" | "dine_in";
  label: string;
};

function typeLabel(type: string): string {
  return type === "dine_in" ? "內用" : "外帶";
}

export default function FloorPage() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [tier, setTier] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [role, setRole] = useState<Role | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void (async () => {
      const [slotRes, meRes] = await Promise.all([fetch("/api/settings/slots"), fetch("/api/auth/me")]);
      if (slotRes.status === 401 || meRes.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (slotRes.ok) {
        const data = (await slotRes.json()) as { slots: Slot[] };
        setSlots(data.slots);
      }
      if (meRes.ok) {
        const data = (await meRes.json()) as { role?: Role };
        if (data.role === "admin" || data.role === "pickup" || data.role === "viewer") setRole(data.role);
      }
    })();
  }, []);

  useEffect(() => {
    if (selected.length === 0) {
      setOrders([]);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams();
    for (const id of selected) params.append("slot", id);
    void (async () => {
      setPending(true);
      setError("");
      try {
        const response = await fetch(`/api/orders?${params.toString()}`, { signal: controller.signal });
        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (!response.ok) {
          setError("讀取客人失敗");
          return;
        }
        const data = (await response.json()) as { orders: OrderItem[]; role?: Role };
        setOrders(data.orders);
        if (data.role === "admin" || data.role === "pickup" || data.role === "viewer") setRole(data.role);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("讀取客人失敗");
      } finally {
        if (!controller.signal.aborted) setPending(false);
      }
    })();
    return () => controller.abort();
  }, [selected]);

  const tiers = useMemo(() => priceTierCounts(orders), [orders]);
  const visibleOrders = useMemo(() => ordersMatchingTier(orders, tier), [orders, tier]);
  const dates = useMemo(
    () => [...new Set(slots.map((slot) => slot.service_date))].sort(),
    [slots],
  );
  const canPick = role === "admin" || role === "pickup";

  function toggle(id: string) {
    setTier(null);
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  async function togglePickup(order: OrderItem) {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ picked_up: !order.picked_up }),
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (response.status === 403) {
        setError("沒有權限");
        return;
      }
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "儲存失敗");
        return;
      }
      setOrders((prev) =>
        prev.map((item) => (item.id === order.id ? { ...item, picked_up: !item.picked_up } : item)),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main style={styles.main}>
      <h1 style={styles.h1}>外場</h1>
      <p style={styles.note}>點選一個或多個時段，查看這些時段要領取的客人。</p>
      {error ? (
        <p role="alert" style={styles.error}>
          {error}
        </p>
      ) : null}

      {dates.map((date) => (
        <section key={date} style={styles.card}>
          <h2 style={styles.h2}>{date}</h2>
          <div style={styles.slots}>
            {slots
              .filter((slot) => slot.service_date === date)
              .map((slot) => {
                const on = selected.includes(slot.id);
                return (
                  <button
                    key={slot.id}
                    type="button"
                    aria-pressed={on}
                    style={on ? styles.slotOn : styles.slot}
                    onClick={() => toggle(slot.id)}
                  >
                    {typeLabel(slot.service_type)} {slot.label}
                  </button>
                );
              })}
          </div>
        </section>
      ))}

      {selected.length === 0 ? <p style={styles.note}>請選擇時段。</p> : null}
      {selected.length > 0 && orders.length === 0 && !pending ? (
        <p style={styles.note}>這些時段還沒有客人。</p>
      ) : null}
      {orders.length > 0 && visibleOrders.length === 0 ? (
        <p style={styles.note}>這個年菜價格沒有客人。</p>
      ) : null}
      {tiers.length > 0 ? (
        <section style={styles.card}>
          <h2 style={styles.h2}>年菜價格</h2>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>年菜價格</th>
                <th style={styles.th}>售價</th>
                <th style={styles.th}>數量</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((row) => (
                <tr key={`${row.name}-${row.price}`}>
                  <td style={styles.td}>{row.name}</td>
                  <td style={styles.td}>{row.price}</td>
                  <td style={styles.td}>{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={styles.slots}>
            <button type="button" aria-pressed={tier === null} style={tier === null ? styles.slotOn : styles.slot} onClick={() => setTier(null)}>
              全部
            </button>
            {tiers.map((row) => (
              <button
                key={row.name}
                type="button"
                aria-pressed={tier === row.name}
                style={tier === row.name ? styles.slotOn : styles.slot}
                onClick={() => setTier(row.name)}
              >
                {row.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {visibleOrders.map((order) => (
        <article key={order.id} style={styles.card}>
          <h2 style={styles.name}>{order.customer_name}</h2>
          <p style={styles.meta}>
            <span style={styles.badge}>{typeLabel(order.service_type)}</span>
            <span>電話 {order.phone}</span>
            <span>
              {order.service_date} {order.slot_label}
            </span>
          </p>
          <p style={styles.meta}>年菜價格 {order.menu_set_name ?? "未選套餐"}</p>
          {order.note ? <p style={styles.meta}>備註 {order.note}</p> : null}
          <p style={styles.money}>
            已收 {order.amount_paid}
            <span style={styles.remain}>剩餘 {order.paid_in_full ? "已付清" : order.remaining}</span>
            <span>{order.picked_up ? "已領取" : "未領取"}</span>
          </p>
          {canPick ? (
            <button
              type="button"
              disabled={pending}
              style={order.picked_up ? styles.picked : styles.button}
              onClick={() => void togglePickup(order)}
            >
              {order.picked_up ? "已領取" : "領取"}
            </button>
          ) : null}
          {(order.addons ?? []).length > 0 ? (
            <p style={styles.note}>加購 {(order.addons ?? []).map((addon) => addon.dish_name).join("、")}</p>
          ) : null}
        </article>
      ))}
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  main: { maxWidth: 960, margin: "0 auto", padding: 16, fontSize: 20, lineHeight: 1.45 },
  h1: { fontSize: 32, margin: "8px 0 16px" },
  h2: { fontSize: 24, margin: "0 0 8px" },
  name: { fontSize: 28, margin: "0 0 8px" },
  card: {
    border: "1px solid #ccc",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    background: "#fff",
  },
  slots: { display: "flex", gap: 12, flexWrap: "wrap" },
  slot: { minHeight: 56, minWidth: 140, fontSize: 20, padding: "0 16px" },
  slotOn: {
    minHeight: 56,
    minWidth: 140,
    fontSize: 20,
    padding: "0 16px",
    background: "#6b3a12",
    color: "#fff",
    fontWeight: 700,
  },
  button: { minHeight: 56, minWidth: 112, fontSize: 22, padding: "0 18px" },
  picked: { minHeight: 56, minWidth: 112, fontSize: 22, padding: "0 18px", background: "#146c43", color: "#fff" },
  meta: { display: "flex", gap: 12, alignItems: "center", margin: "6px 0", flexWrap: "wrap" },
  badge: {
    minHeight: 40,
    minWidth: 64,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    background: "#f3f3f3",
    fontWeight: 700,
  },
  money: { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", margin: "12px 0" },
  remain: { fontSize: 26, fontWeight: 700 },
  note: { color: "#333", marginTop: 0 },
  error: { color: "#a40000", fontWeight: 700 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 22 },
  th: { textAlign: "left", padding: "12px 8px", borderBottom: "2px solid #222" },
  td: { padding: "14px 8px", borderBottom: "1px solid #ddd", fontSize: 24 },
};

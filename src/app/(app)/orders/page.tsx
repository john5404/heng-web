"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ConfirmDialog, PhoneFormatDialog } from "@/components/PhoneFormatDialog";
import { addonLineText, orderAlacarteDishes, registerSetChoices } from "@/lib/alacarte";
import { confirmLineRemove, confirmOrderDelete } from "@/lib/confirm-text";
import { isPaidInFull, orderTotal, remainingAmount } from "@/lib/money";
import {
  BAD_PAID,
  BAD_QUANTITY,
  BAD_SET_PRICE,
  EMPTY_PAID,
  EMPTY_QUANTITY,
  EMPTY_SET_PRICE,
  nonNegativeInteger,
} from "@/lib/numbers";
import { phonePopupOn } from "@/lib/phone";

type Role = "admin" | "pickup" | "viewer";

type Slot = {
  id: string;
  service_date: string;
  service_type: "takeout" | "dine_in";
  label: string;
  start_time: string;
};

type MenuSet = { id: string; name: string; price: number };
type Dish = { id: string; name: string; alacarte_price: number };

type Addon = { id: string; dish_id: string; dish_name: string; quantity: number; price: number };

type Order = {
  id: string;
  customer_name: string;
  phone: string;
  service_type: "takeout" | "dine_in";
  slot_id: string;
  service_date: string;
  slot_label: string;
  menu_set_id: string | null;
  menu_set_name: string | null;
  price: number;
  amount_paid: number;
  total: number;
  remaining: number;
  paid_in_full: boolean;
  note: string | null;
  addons: Addon[];
};

type DraftLine = {
  key: string;
  addonId?: string;
  dishId: string;
  name: string;
  unitPrice: number;
  quantity: string;
};

type PendingConfirm = { message: string; run: () => void };

function typeLabel(type: string): string {
  return type === "dine_in" ? "內用" : "外帶";
}

function whole(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  return Number(value);
}

export default function OrdersPage() {
  const [role, setRole] = useState<Role | "">("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [sets, setSets] = useState<MenuSet[]>([]);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [slotId, setSlotId] = useState("");
  const [menuSetId, setMenuSetId] = useState("");
  const [price, setPrice] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [addDishId, setAddDishId] = useState("");
  const [phoneDialog, setPhoneDialog] = useState<string | null>(null);
  const [numberDialog, setNumberDialog] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);

  const canManage = role === "admin";
  const choices = useMemo(() => registerSetChoices(sets), [sets]);
  const alacarte = useMemo(() => orderAlacarteDishes(dishes), [dishes]);

  useEffect(() => {
    void (async () => {
      const [slotRes, menuRes] = await Promise.all([
        fetch("/api/settings/slots"),
        fetch("/api/settings/menu"),
      ]);
      if (slotRes.status === 401 || menuRes.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!slotRes.ok || !menuRes.ok) {
        setError("讀取時段或菜項失敗");
        return;
      }
      const slotData = (await slotRes.json()) as { slots: Slot[] };
      const menuData = (await menuRes.json()) as { sets: MenuSet[]; dishes: Dish[] };
      setSlots(slotData.slots);
      setSets(menuData.sets);
      setDishes(menuData.dishes);
      setAddDishId(orderAlacarteDishes(menuData.dishes)[0]?.id ?? "");
    })();
  }, []);

  const groups = useMemo(() => {
    const byDate = new Map<string, Slot[]>();
    for (const slot of slots) {
      const list = byDate.get(slot.service_date) ?? [];
      list.push(slot);
      byDate.set(slot.service_date, list);
    }
    return [...byDate.entries()];
  }, [slots]);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  useEffect(() => {
    if (selected.length === 0) {
      setOrders([]);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams();
    for (const id of selected) params.append("slot", id);
    setPending(true);
    setError("");
    void (async () => {
      try {
        const response = await fetch(`/api/orders?${params.toString()}`, { signal: controller.signal });
        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (!response.ok) {
          setError("讀取訂單失敗");
          return;
        }
        const data = (await response.json()) as { role: Role; orders: Order[] };
        setRole(data.role);
        setOrders(data.orders);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("讀取訂單失敗");
      } finally {
        if (!controller.signal.aborted) setPending(false);
      }
    })();
    return () => controller.abort();
  }, [selected]);

  function beginEdit(order: Order) {
    setEditing(order.id);
    setName(order.customer_name);
    setPhone(order.phone);
    setSlotId(order.slot_id);
    setMenuSetId(order.menu_set_id ?? "");
    setPrice(String(order.price));
    setAmountPaid(String(order.amount_paid));
    setNote(order.note ?? "");
    setLines(
      (order.addons ?? []).map((addon) => ({
        key: addon.id,
        addonId: addon.id,
        dishId: addon.dish_id,
        name: addon.dish_name,
        unitPrice: addon.price,
        quantity: String(addon.quantity),
      })),
    );
    setError("");
  }

  function onPickSet(id: string) {
    setMenuSetId(id);
    const chosen = choices.find((set) => set.id === id);
    setPrice(chosen ? String(chosen.price) : "0");
  }

  function addLine() {
    const dish = alacarte.find((item) => item.id === addDishId);
    if (!dish) return;
    setLines((prev) => {
      const existing = prev.find((line) => line.dishId === dish.id && !line.addonId);
      if (existing) {
        const current = nonNegativeInteger(existing.quantity) ?? 0;
        return prev.map((line) => (line.key === existing.key ? { ...line, quantity: String(current + 1) } : line));
      }
      return [
        ...prev,
        {
          key: `new-${dish.id}-${prev.length}`,
          dishId: dish.id,
          name: dish.name,
          unitPrice: dish.alacarte_price,
          quantity: "1",
        },
      ];
    });
  }

  const setPortion = whole(price) ?? 0;
  const paid = whole(amountPaid) ?? 0;
  const draftTotal = orderTotal(
    menuSetId ? setPortion : 0,
    lines.map((line) => ({ price: line.unitPrice, quantity: nonNegativeInteger(line.quantity) ?? 0 })),
  );
  const draftRemaining = remainingAmount(draftTotal, paid);

  async function save() {
    if (!editing) return;
    const notice = phonePopupOn("submit", phone);
    if (notice.kind === "popup") {
      setPhoneDialog(notice.message);
      return;
    }
    const slot = slots.find((item) => item.id === slotId);
    if (!slot) {
      setError("請選擇時段");
      return;
    }
    const kept: { line: DraftLine; quantity: number }[] = [];
    for (const line of lines) {
      if (line.quantity.trim() === "") {
        setNumberDialog(EMPTY_QUANTITY);
        return;
      }
      const quantity = nonNegativeInteger(line.quantity);
      if (quantity === undefined || quantity < 1) {
        setNumberDialog(BAD_QUANTITY);
        return;
      }
      kept.push({ line, quantity });
    }
    if (!menuSetId && kept.length === 0) {
      setError("請至少加入一道單點");
      return;
    }
    let setPrice = 0;
    if (menuSetId) {
      if (price.trim() === "") {
        setNumberDialog(EMPTY_SET_PRICE);
        return;
      }
      const parsed = nonNegativeInteger(price);
      if (parsed === undefined) {
        setNumberDialog(BAD_SET_PRICE);
        return;
      }
      setPrice = parsed;
    }
    if (amountPaid.trim() === "") {
      setNumberDialog(EMPTY_PAID);
      return;
    }
    const deposit = nonNegativeInteger(amountPaid);
    if (deposit === undefined) {
      setNumberDialog(BAD_PAID);
      return;
    }
    setPending(true);
    setError("");
    const response = await fetch(`/api/orders/${editing}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_name: name.trim(),
        phone: phone.trim(),
        slot_id: slot.id,
        service_type: slot.service_type,
        menu_set_id: menuSetId || null,
        price: setPrice,
        amount_paid: deposit,
        note: note.trim(),
        alacarte: kept.map(({ line, quantity }) => ({
          ...(line.addonId ? { id: line.addonId } : {}),
          dish_id: line.dishId,
          quantity,
        })),
      }),
    });
    setPending(false);
    if (response.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "無法更新訂單");
      return;
    }
    const updated = (await response.json()) as Order;
    setOrders((prev) => prev.map((order) => (order.id === updated.id ? updated : order)).filter((order) => selected.includes(order.slot_id)));
    setEditing(null);
  }

  async function remove(order: Order) {
    setPending(true);
    setError("");
    const response = await fetch(`/api/orders/${order.id}`, { method: "DELETE" });
    setPending(false);
    if (response.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "無法刪除訂單");
      return;
    }
    setOrders((prev) => prev.filter((item) => item.id !== order.id));
    if (editing === order.id) setEditing(null);
  }

  return (
    <main style={styles.main}>
      <h1 style={styles.h1}>訂單管理</h1>
      <p style={styles.note}>選擇一個或多個時段，列出該時段的訂單。</p>
      {error ? (
        <p role="alert" style={styles.error}>
          {error}
        </p>
      ) : null}
      {groups.map(([date, day]) => (
        <section key={date}>
          <h2 style={styles.h2}>{date}</h2>
          <div style={styles.slots}>
            {day.map((slot) => {
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
      {pending && !editing ? <p style={styles.note}>讀取中…</p> : null}
      {role && !canManage ? <p style={styles.note}>只有管理可以修改或刪除訂單。</p> : null}
      {orders.map((order) => (
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
          {(order.addons ?? []).map((addon) => (
            <p key={addon.id} style={styles.note}>
              {addonLineText(addon)}
            </p>
          ))}
          <p style={styles.money}>
            合計 {order.total}
            已收 {order.amount_paid}
            <span style={styles.remain}>剩餘 {order.paid_in_full ? "已付清" : order.remaining}</span>
          </p>
          {order.note ? <p style={styles.note}>備註 {order.note}</p> : null}
          {canManage ? (
            <div style={styles.actions}>
              <button type="button" style={styles.button} onClick={() => beginEdit(order)}>
                編輯
              </button>
              <button
                type="button"
                style={styles.danger}
                disabled={pending}
                onClick={() =>
                  setConfirm({
                    message: confirmOrderDelete(order.customer_name, `${order.service_date} ${order.slot_label}`),
                    run: () => void remove(order),
                  })
                }
              >
                刪除
              </button>
            </div>
          ) : null}
          {editing === order.id ? (
            <form
              style={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <label style={styles.field}>
                客戶
                <input value={name} onChange={(event) => setName(event.target.value)} style={styles.input} />
              </label>
              <label style={styles.field}>
                電話
                <input value={phone} onChange={(event) => setPhone(event.target.value)} style={styles.input} />
              </label>
              <label style={styles.field}>
                時段
                <select value={slotId} onChange={(event) => setSlotId(event.target.value)} style={styles.input}>
                  {slots.map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {slot.service_date} {typeLabel(slot.service_type)} {slot.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={styles.field}>
                年菜價格
                <select value={menuSetId} onChange={(event) => onPickSet(event.target.value)} style={styles.input}>
                  <option value="">未選套餐</option>
                  {choices.map((set) => (
                    <option key={set.id} value={set.id}>
                      {set.name} {set.price}
                    </option>
                  ))}
                </select>
              </label>
              <label style={styles.field}>
                售價
                <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="numeric" style={styles.input} />
              </label>
              <div style={styles.line}>
                <select value={addDishId} onChange={(event) => setAddDishId(event.target.value)} style={styles.input}>
                  {alacarte.map((dish) => (
                    <option key={dish.id} value={dish.id}>
                      {dish.name} {dish.alacarte_price}
                    </option>
                  ))}
                </select>
                <button type="button" style={styles.button} onClick={addLine}>
                  ＋
                </button>
              </div>
              {lines.map((line) => (
                <div key={line.key} style={styles.line}>
                  <span>
                    {line.name} 單價 {line.unitPrice}
                  </span>
                  <input
                    aria-label={`${line.name} 數量`}
                    value={String(line.quantity)}
                    inputMode="numeric"
                    onChange={(event) => {
                      const raw = event.target.value.trim();
                      if (raw === "0") {
                        setConfirm({
                          message: confirmLineRemove(line.name),
                          run: () => setLines((prev) => prev.filter((item) => item.key !== line.key)),
                        });
                        return;
                      }
                      setLines((prev) => prev.map((item) => (item.key === line.key ? { ...item, quantity: event.target.value } : item)));
                    }}
                    style={styles.qty}
                  />
                </div>
              ))}
              <label style={styles.field}>
                已收
                <input value={amountPaid} onChange={(event) => setAmountPaid(event.target.value)} inputMode="numeric" style={styles.input} />
              </label>
              <label style={styles.field}>
                備註
                <input value={note} onChange={(event) => setNote(event.target.value)} style={styles.input} />
              </label>
              <p style={styles.money}>
                合計 {draftTotal}
                <span style={styles.remain}>剩餘 {isPaidInFull(draftTotal, paid) ? "已付清" : draftRemaining}</span>
              </p>
              <div style={styles.actions}>
                <button type="submit" style={styles.button} disabled={pending}>
                  儲存
                </button>
                <button type="button" style={styles.slot} onClick={() => setEditing(null)}>
                  取消
                </button>
              </div>
            </form>
          ) : null}
        </article>
      ))}
      {phoneDialog ? <PhoneFormatDialog message={phoneDialog} onDismiss={() => setPhoneDialog(null)} /> : null}
      {numberDialog ? <PhoneFormatDialog message={numberDialog} onDismiss={() => setNumberDialog(null)} /> : null}
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
  main: { maxWidth: 760, margin: "0 auto", padding: "24px 16px 48px", display: "flex", flexDirection: "column", gap: 12 },
  h1: { fontSize: 28, margin: 0 },
  h2: { fontSize: 18, margin: "8px 0" },
  note: { margin: 0, color: "#5c5346" },
  error: { margin: 0, color: "#8c2f2f" },
  slots: { display: "flex", flexWrap: "wrap", gap: 8 },
  slot: { minHeight: 40, borderRadius: 8, border: "1px solid #c4b8a4", background: "#fff", padding: "6px 10px" },
  slotOn: { minHeight: 40, borderRadius: 8, border: "1px solid #8c2f2f", background: "#8c2f2f", color: "#fff", padding: "6px 10px" },
  card: { border: "1px solid #e4d7c3", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 6 },
  name: { margin: 0, fontSize: 20 },
  meta: { margin: 0, display: "flex", flexWrap: "wrap", gap: 8 },
  badge: { background: "#f3e6d4", borderRadius: 999, padding: "0 8px" },
  money: { margin: 0, display: "flex", flexWrap: "wrap", gap: 10, fontWeight: 700 },
  remain: { color: "#8c2f2f" },
  actions: { display: "flex", gap: 8 },
  button: { minHeight: 40, border: 0, borderRadius: 8, background: "#8c2f2f", color: "#fff", padding: "6px 12px" },
  danger: { minHeight: 40, borderRadius: 8, border: "1px solid #8c2f2f", background: "#fff", color: "#8c2f2f", padding: "6px 12px" },
  form: { display: "flex", flexDirection: "column", gap: 8, marginTop: 8 },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  input: { minHeight: 40, borderRadius: 8, border: "1px solid #c4b8a4", padding: "6px 8px" },
  line: { display: "flex", alignItems: "center", gap: 8 },
  qty: { width: 72, minHeight: 40, borderRadius: 8, border: "1px solid #c4b8a4", padding: "6px 8px" },
};

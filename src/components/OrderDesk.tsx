"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState, type CSSProperties } from "react";
import { PhoneFormatDialog } from "@/components/PhoneFormatDialog";
import { alacarteMenu, addonLineText } from "@/lib/alacarte";
import { phonePopupOn } from "@/lib/phone";

type AddonItem = {
  id: string;
  parent_order_item_id: string;
  dish_name: string;
  quantity: number;
  price: number;
  amount_paid: number;
  remaining: number;
  paid_in_full: boolean;
  picked_up: boolean;
};

type OrderItem = {
  id: string;
  customer_name: string;
  phone: string;
  service_type: "takeout" | "dine_in";
  menu_set_id: string | null;
  menu_set_name: string | null;
  slot_id: string;
  service_date: string;
  slot_label: string;
  price: number;
  amount_paid: number;
  remaining: number;
  paid_in_full: boolean;
  picked_up: boolean;
  note: string;
  addons?: AddonItem[];
};

type Role = "admin" | "pickup" | "viewer";

type MenuDish = { id: string; name: string; sort_order: number };
type MenuSet = { id: string; name: string; price: number; dishes: MenuDish[] };
type CatalogDish = { id: string; name: string };
type Slot = {
  id: string;
  service_date: string;
  service_type: "takeout" | "dine_in";
  label: string;
};

function typeLabel(type: string): string {
  return type === "dine_in" ? "內用" : "外帶";
}

export default function OrderDesk() {
  const [query, setQuery] = useState("");
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [paidDrafts, setPaidDrafts] = useState<Record<string, string>>({});
  const [sets, setSets] = useState<MenuSet[]>([]);
  const [catalog, setCatalog] = useState<CatalogDish[]>([]);
  const [qtyByDish, setQtyByDish] = useState<Record<string, number>>({});
  const [slots, setSlots] = useState<Slot[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [role, setRole] = useState<Role | null>(null);
  const [form, setForm] = useState({
    customer_name: "",
    phone: "",
    service_type: "takeout" as "takeout" | "dine_in",
    menu_set_id: "",
    slot_id: "",
    price: "",
    note: "",
  });
  const [phoneDialog, setPhoneDialog] = useState<string | null>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      const [menuRes, slotRes, meRes] = await Promise.all([
        fetch("/api/settings/menu"),
        fetch("/api/settings/slots"),
        fetch("/api/auth/me"),
      ]);
      if (menuRes.status === 401 || slotRes.status === 401 || meRes.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (menuRes.ok) {
        const data = (await menuRes.json()) as { sets: MenuSet[]; dishes: CatalogDish[] };
        setSets(data.sets);
        setCatalog(data.dishes);
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

  async function search(name: string) {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/orders?q=${encodeURIComponent(name.trim())}`);
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!response.ok) {
        setError("搜尋失敗");
        return;
      }
      const data = (await response.json()) as { orders: OrderItem[]; role?: Role };
      setOrders(data.orders);
      if (data.role === "admin" || data.role === "pickup" || data.role === "viewer") setRole(data.role);
      const drafts: Record<string, string> = {};
      for (const order of data.orders) {
        drafts[order.id] = String(order.amount_paid);
        for (const addon of order.addons ?? []) drafts[addon.id] = String(addon.amount_paid);
      }
      setPaidDrafts(drafts);
    } finally {
      setPending(false);
    }
  }

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    await search(query);
  }

  async function mutate(url: string, method: string, body?: unknown): Promise<boolean> {
    setPending(true);
    setError("");
    try {
      const response = await fetch(url, {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return false;
      }
      if (response.status === 403) {
        setError("沒有權限");
        return false;
      }
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "儲存失敗");
        return false;
      }
      return true;
    } finally {
      setPending(false);
    }
  }

  const phoneBlocked = phonePopupOn("submit", form.phone).kind === "popup";

  function showPhonePopup(event: "blur" | "submit") {
    const notice = phonePopupOn(event, form.phone);
    if (notice.kind === "popup") setPhoneDialog(notice.message);
    return notice.kind === "popup";
  }

  function dismissPhonePopup() {
    setPhoneDialog(null);
    window.setTimeout(() => phoneInputRef.current?.focus(), 0);
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (showPhonePopup("submit")) return;
    const price = form.price.trim() === "" ? undefined : Number(form.price);
    const ok = await mutate("/api/orders", "POST", {
      customer_name: form.customer_name,
      phone: form.phone,
      service_type: form.service_type,
      menu_set_id: form.menu_set_id || null,
      slot_id: form.slot_id,
      note: form.note,
      ...(price === undefined ? {} : { price }),
      ...(chosenAlacarte.length > 0 ? { alacarte: chosenAlacarte } : {}),
    });
    if (!ok) return;
    const name = form.customer_name.trim();
    setQuery(name);
    setForm((prev) => ({ ...prev, customer_name: "", phone: "", price: "", note: "" }));
    setQtyByDish({});
    await search(name);
  }

  const singleDishes = alacarteMenu(catalog, sets);
  const chosenAlacarte = singleDishes
    .filter((dish) => (qtyByDish[dish.id] ?? 0) >= 1)
    .map((dish) => ({ dish_id: dish.id, quantity: qtyByDish[dish.id] }));

  function setDishQty(dishId: string, raw: number) {
    const quantity = Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
    setQtyByDish((prev) => {
      if (quantity < 1) {
        const next = { ...prev };
        delete next[dishId];
        return next;
      }
      return { ...prev, [dishId]: quantity };
    });
  }

  const canManage = role === "admin";
  const canPick = role === "admin" || role === "pickup";
  const soupSet = sets.find((item) => item.name === "單點上湯魚翅羹");

  function onPickSet(menuSetId: string) {
    const set = sets.find((item) => item.id === menuSetId);
    setForm((prev) => ({
      ...prev,
      menu_set_id: menuSetId,
      price: set ? String(set.price) : "",
    }));
  }

  function onServiceType(serviceType: "takeout" | "dine_in") {
    setForm((prev) => {
      const slot = slots.find((item) => item.id === prev.slot_id);
      return {
        ...prev,
        service_type: serviceType,
        slot_id: slot?.service_type === serviceType ? prev.slot_id : "",
      };
    });
  }

  const visibleSlots = slots.filter((slot) => slot.service_type === form.service_type);

  return (
    <main style={styles.main}>
      <h1 style={styles.h1}>登記訂單</h1>
      {error ? (
        <p role="alert" style={styles.error}>
          {error}
        </p>
      ) : null}

      <form onSubmit={onSearch} style={styles.search}>
        <label style={styles.field}>
          搜尋姓名
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="輸入客人姓名"
            style={styles.input}
          />
        </label>
        <button type="submit" disabled={pending} style={styles.button}>
          搜尋
        </button>
      </form>

      {canManage ? (
      <section style={styles.card}>
        <h2 style={styles.h2}>新增項目</h2>
        <p style={styles.note}>
          已收預設 2000；售價低於 2000 則預設收滿。魚翅羹可單點，或加在既有項目上，訂金與領取各自計算。單點選了之後數量是 1，沒有單價的菜這一列售價是 0。
        </p>
        <form
          onSubmit={onCreate}
          onKeyDown={(event: KeyboardEvent<HTMLFormElement>) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            if (showPhonePopup("submit")) event.preventDefault();
          }}
          style={styles.form}
        >
          <label style={styles.field}>
            姓名
            <input
              value={form.customer_name}
              onChange={(e) => setForm((prev) => ({ ...prev, customer_name: e.target.value }))}
              style={styles.input}
              required
            />
          </label>
          <label style={styles.field}>
            電話
            <input
              ref={phoneInputRef}
              value={form.phone}
              onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
              onBlur={() => showPhonePopup("blur")}
              inputMode="tel"
              style={styles.input}
              aria-invalid={phoneBlocked ? true : undefined}
              required
            />
          </label>
          <label style={styles.field}>
            內用／外帶
            <select
              value={form.service_type}
              onChange={(e) => onServiceType(e.target.value as "takeout" | "dine_in")}
              style={styles.select}
            >
              <option value="takeout">外帶</option>
              <option value="dine_in">內用</option>
            </select>
          </label>
          <label style={styles.field}>
            年菜價格
            <select
              value={form.menu_set_id}
              onChange={(e) => onPickSet(e.target.value)}
              style={styles.select}
              required
            >
              <option value="">選擇年菜價格</option>
              {sets.map((set) => (
                <option key={set.id} value={set.id}>
                  {set.name}（{set.price}）
                </option>
              ))}
            </select>
          </label>
          {soupSet ? (
            <button type="button" style={styles.button} onClick={() => onPickSet(soupSet.id)}>
              單點上湯魚翅羹
            </button>
          ) : null}
          <label style={styles.field}>
            時段
            <select
              value={form.slot_id}
              onChange={(e) => setForm((prev) => ({ ...prev, slot_id: e.target.value }))}
              style={styles.select}
              required
            >
              <option value="">選擇時段</option>
              {visibleSlots.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {slot.service_date} {typeLabel(slot.service_type)} {slot.label}
                </option>
              ))}
            </select>
          </label>
          <div style={styles.alacarte}>
            <h3 style={styles.h2}>單點</h3>
            {singleDishes.map((dish) => {
              const quantity = qtyByDish[dish.id] ?? 0;
              return (
                <div key={dish.id} style={styles.alacarteRow}>
                  <span style={styles.alacarteName}>{dish.name}</span>
                  <span>單價 {dish.unitPrice}</span>
                  <button
                    type="button"
                    style={styles.button}
                    aria-label={`${dish.name} 減少`}
                    onClick={() => setDishQty(dish.id, quantity - 1)}
                  >
                    −
                  </button>
                  <input
                    aria-label={`${dish.name} 數量`}
                    inputMode="numeric"
                    value={quantity === 0 ? "" : String(quantity)}
                    placeholder="0"
                    onChange={(e) => {
                      const text = e.target.value.trim();
                      setDishQty(dish.id, text === "" ? 0 : Number(text));
                    }}
                    style={styles.qty}
                  />
                  <button
                    type="button"
                    style={styles.button}
                    aria-label={`${dish.name} 增加`}
                    onClick={() => setDishQty(dish.id, quantity < 1 ? 1 : quantity + 1)}
                  >
                    ＋
                  </button>
                  {quantity >= 1 ? <span>這一列售價 {dish.unitPrice * quantity}</span> : null}
                </div>
              );
            })}
          </div>
          <label style={styles.field}>
            售價
            <input
              value={form.price}
              onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
              inputMode="numeric"
              style={styles.input}
            />
          </label>
          <label style={styles.field}>
            備註
            <input
              value={form.note}
              onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
              style={styles.input}
              maxLength={500}
            />
          </label>
          <span
            style={styles.submitWrap}
            onClick={() => {
              if (phoneBlocked && !pending) showPhonePopup("submit");
            }}
          >
            <button
              type="submit"
              disabled={pending || phoneBlocked}
              style={{ ...styles.button, pointerEvents: phoneBlocked && !pending ? "none" : undefined }}
            >
              新增
            </button>
          </span>
        </form>
      </section>
      ) : null}
      {role === "pickup" ? <p style={styles.note}>領餐帳號只能標示已領取。</p> : null}

      {orders.length === 0 ? <p style={styles.note}>尚無符合的項目。</p> : null}
      {orders.map((order) => (
        <article key={order.id} style={styles.card}>
          <h2 style={styles.name}>{order.customer_name}</h2>
          <p style={styles.meta}>
            <span style={styles.badge}>
              {typeLabel(slots.find((slot) => slot.id === order.slot_id)?.service_type ?? order.service_type)}
            </span>
            <span>電話 {order.phone}</span>
          </p>
          <p style={styles.meta}>
            年菜價格 {order.menu_set_name ?? "未選套餐"} · {order.service_date} {order.slot_label}
          </p>
          {order.note ? <p style={styles.meta}>備註 {order.note}</p> : null}
          <p style={styles.money}>
            已收{" "}
            {canManage ? (
              <input
                aria-label={`${order.customer_name} 已收`}
                inputMode="numeric"
                value={paidDrafts[order.id] ?? String(order.amount_paid)}
                onChange={(e) => setPaidDrafts((prev) => ({ ...prev, [order.id]: e.target.value }))}
                style={styles.moneyInput}
              />
            ) : (
              <span>{order.amount_paid}</span>
            )}
            <span style={styles.remain}>剩餘 {order.paid_in_full ? "已付清" : order.remaining}</span>
          </p>
          <div style={styles.actions}>
            {canManage ? (
              <button
                type="button"
                disabled={pending}
                style={styles.button}
                onClick={() =>
                  mutate(`/api/orders/${order.id}`, "PATCH", {
                    amount_paid: Number(paidDrafts[order.id] ?? order.amount_paid),
                  }).then((ok) => {
                    if (ok) void search(query);
                  })
                }
              >
                儲存已收
              </button>
            ) : null}
            {canPick ? (
              <button
                type="button"
                disabled={pending}
                style={order.picked_up ? styles.picked : styles.button}
                onClick={() =>
                  mutate(`/api/orders/${order.id}`, "PATCH", { picked_up: !order.picked_up }).then((ok) => {
                    if (ok) void search(query);
                  })
                }
              >
                {order.picked_up ? "已領取" : "領取"}
              </button>
            ) : null}
            {canManage ? (
              <button
                type="button"
                disabled={pending}
                style={styles.danger}
                onClick={() =>
                  mutate(`/api/orders/${order.id}`, "DELETE").then((ok) => {
                    if (ok) void search(query);
                  })
                }
              >
                刪除
              </button>
            ) : null}
          </div>
          {(order.addons ?? []).map((addon) => (
            <div key={addon.id} style={styles.addon}>
              <h3 style={styles.h2}>{addonLineText(addon)}</h3>
              <p style={styles.money}>
                售價 {addon.price} · 已收{" "}
                {canManage ? (
                  <input
                    aria-label={`${order.customer_name} ${addon.dish_name} 已收`}
                    inputMode="numeric"
                    value={paidDrafts[addon.id] ?? String(addon.amount_paid)}
                    onChange={(e) => setPaidDrafts((prev) => ({ ...prev, [addon.id]: e.target.value }))}
                    style={styles.moneyInput}
                  />
                ) : (
                  <span>{addon.amount_paid}</span>
                )}
                <span style={styles.remain}>剩餘 {addon.paid_in_full ? "已付清" : addon.remaining}</span>
              </p>
              <div style={styles.actions}>
                {canManage ? (
                  <button
                    type="button"
                    disabled={pending}
                    style={styles.button}
                    onClick={() =>
                      mutate(`/api/orders/${addon.id}`, "PATCH", {
                        amount_paid: Number(paidDrafts[addon.id] ?? addon.amount_paid),
                      }).then((ok) => {
                        if (ok) void search(query);
                      })
                    }
                  >
                    儲存已收
                  </button>
                ) : null}
                {canPick ? (
                  <button
                    type="button"
                    disabled={pending}
                    style={addon.picked_up ? styles.picked : styles.button}
                    onClick={() =>
                      mutate(`/api/orders/${addon.id}`, "PATCH", { picked_up: !addon.picked_up }).then((ok) => {
                        if (ok) void search(query);
                      })
                    }
                  >
                    {addon.picked_up ? "已領取" : "領取"}
                  </button>
                ) : null}
                {canManage ? (
                  <button
                    type="button"
                    disabled={pending}
                    style={styles.danger}
                    onClick={() =>
                      mutate(`/api/orders/${addon.id}`, "DELETE").then((ok) => {
                        if (ok) void search(query);
                      })
                    }
                  >
                    刪除加購
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {canManage ? (
            <div style={styles.actions}>
              <button
                type="button"
                disabled={pending}
                style={styles.button}
                onClick={() =>
                  mutate("/api/orders", "POST", { parent_order_item_id: order.id }).then((ok) => {
                    if (ok) void search(query);
                  })
                }
              >
                加購上湯魚翅羹
              </button>
            </div>
          ) : null}
        </article>
      ))}
      {phoneDialog ? <PhoneFormatDialog message={phoneDialog} onDismiss={dismissPhonePopup} /> : null}
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
  search: { display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 16, flexWrap: "wrap" },
  form: { display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" },
  field: { display: "flex", flexDirection: "column", gap: 6, fontSize: 18, flex: "1 1 180px" },
  input: { minHeight: 56, fontSize: 22, padding: "0 14px" },
  select: { minHeight: 56, fontSize: 20 },
  button: { minHeight: 56, minWidth: 112, fontSize: 22, padding: "0 18px" },
  submitWrap: { display: "inline-flex" },
  alacarte: { flex: "1 1 100%", display: "flex", flexDirection: "column", gap: 8 },
  alacarteRow: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  alacarteName: { flex: "1 1 180px", fontWeight: 700 },
  qty: { width: 88, minHeight: 56, fontSize: 22, padding: "0 8px" },
  picked: { minHeight: 56, minWidth: 112, fontSize: 22, padding: "0 18px", background: "#146c43", color: "#fff" },
  danger: { minHeight: 56, minWidth: 112, fontSize: 22, padding: "0 18px" },
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
  moneyInput: { minHeight: 56, width: 140, fontSize: 24, padding: "0 12px" },
  remain: { fontSize: 26, fontWeight: 700 },
  actions: { display: "flex", gap: 12, flexWrap: "wrap" },
  addon: {
    marginTop: 12,
    padding: 12,
    borderLeft: "6px solid #8a5a00",
    background: "#fff8ee",
    borderRadius: 12,
  },
  note: { color: "#333", marginTop: 0 },
  error: { color: "#a40000", fontWeight: 700 },
};

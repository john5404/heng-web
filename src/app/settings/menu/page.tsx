"use client";

import { FormEvent, useEffect, useState, type CSSProperties } from "react";

type Dish = { id: string; name: string; sort_order?: number };
type MenuSet = { id: string; name: string; price: number; dishes: Dish[] };

export default function MenuSettingsPage() {
  const [sets, setSets] = useState<MenuSet[]>([]);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [newDishName, setNewDishName] = useState("");
  const [replacements, setReplacements] = useState<Record<string, string>>({});

  async function load() {
    const response = await fetch("/api/settings/menu");
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
    const data = (await response.json()) as { sets: MenuSet[]; dishes: Dish[] };
    setSets(data.sets);
    setDishes(data.dishes);
  }

  useEffect(() => {
    void load();
  }, []);

  async function mutate(method: string, body: unknown) {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/settings/menu", {
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

  async function onCreateDish(event: FormEvent) {
    event.preventDefault();
    if (!newDishName.trim()) return;
    await mutate("POST", { type: "dish", name: newDishName.trim() });
    setNewDishName("");
  }

  return (
    <main style={styles.main}>
      <h1 style={styles.h1}>菜項編輯</h1>
      {error ? (
        <p role="alert" style={styles.error}>
          {error}
        </p>
      ) : null}

      {sets.map((set) => (
        <section key={set.id} style={styles.card}>
          <h2 style={styles.h2}>
            {set.name}　${set.price}
          </h2>
          <ol style={styles.list}>
            {set.dishes.map((dish) => {
              const key = `${set.id}:${dish.id}`;
              return (
                <li key={dish.id} style={styles.row}>
                  <span style={styles.dishName}>{dish.name}</span>
                  <select
                    aria-label={`${set.name} 替換 ${dish.name}`}
                    value={replacements[key] ?? ""}
                    onChange={(e) => setReplacements((prev) => ({ ...prev, [key]: e.target.value }))}
                    style={styles.select}
                  >
                    <option value="">換成其他菜</option>
                    {dishes
                      .filter((d) => d.id !== dish.id)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    disabled={pending || !replacements[key]}
                    style={styles.button}
                    onClick={() =>
                      mutate("PATCH", {
                        type: "set_dish",
                        menu_set_id: set.id,
                        dish_id: dish.id,
                        new_dish_id: replacements[key],
                      })
                    }
                  >
                    替換
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      <section style={styles.card}>
        <h2 style={styles.h2}>新增菜名</h2>
        <form onSubmit={onCreateDish} style={styles.row}>
          <input
            value={newDishName}
            onChange={(e) => setNewDishName(e.target.value)}
            placeholder="菜名"
            style={styles.input}
          />
          <button type="submit" disabled={pending} style={styles.button}>
            新增
          </button>
        </form>
      </section>
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
  row: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 },
  dishName: { flex: "1 1 160px", minHeight: 48, display: "flex", alignItems: "center" },
  select: { minHeight: 48, fontSize: 18, flex: "1 1 180px" },
  input: { minHeight: 48, fontSize: 18, flex: "1 1 180px", padding: "0 12px" },
  button: { minHeight: 48, minWidth: 88, fontSize: 18, padding: "0 16px" },
  error: { color: "#a40000", fontWeight: 600 },
};

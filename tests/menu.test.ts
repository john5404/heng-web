import { describe, expect, it } from "vitest";
import { DELETE, GET, PATCH, POST } from "../src/app/api/settings/menu/route";
import { createSession, hashPassword, SESSION_COOKIE } from "../src/lib/auth";
import { sql } from "../src/lib/db";

/** Flyer dish names (Traditional Chinese, 拚 = U+62DA). */
const FLYER_DISHES = [
  "烏魚子五福拚",
  "上湯魚翅雞湯",
  "招牌鹽酥豬腳",
  "紅蟳米糕",
  "清蒸帝王鱈",
  "黑胡椒醇香台塑牛排",
  "白灼蒜味蝦",
  "現烤鰻魚",
  "松葉蟹海鮮鍋",
  "五福喜臨門",
  "上湯魚翅羹",
  "米糕拚點心",
  "清蒸海上鮮(虎斑)",
  "麻油松阪鮮干貝",
  "天麻人蔘雞湯",
  "椒麻蒜味小卷",
  "富貴四喜盤",
  "古早味筍乾滷豬腳",
  "黑胡椒豬小排",
  "御品佛跳牆",
  "鹽酥鮮魚塊",
] as const;

type SetRow = { id: string; name: string; price: number };
type DishRow = { id: string; name: string };

async function ensureAdminUser(): Promise<string> {
  const existing = await sql<{ id: string }>("select id from users where username = $1", ["admin"]);
  if (existing[0]) return existing[0].id;
  const passwordHash = await hashPassword("temp-pass");
  await sql("insert into users (username, password_hash, role) values ($1, $2, 'admin')", [
    "admin",
    passwordHash,
  ]);
  const rows = await sql<{ id: string }>("select id from users where username = $1", ["admin"]);
  return rows[0].id;
}

async function adminCookie(): Promise<string> {
  const id = await ensureAdminUser();
  return `${SESSION_COOKIE}=${await createSession({ id })}`;
}

async function roleCookie(username: string, role: "viewer" | "pickup"): Promise<string> {
  const existing = await sql<{ id: string }>("select id from users where username = $1", [username]);
  if (existing[0]) {
    return `${SESSION_COOKIE}=${await createSession({ id: existing[0].id })}`;
  }
  const passwordHash = await hashPassword("temp-pass");
  await sql("insert into users (username, password_hash, role) values ($1, $2, $3)", [
    username,
    passwordHash,
    role,
  ]);
  const rows = await sql<{ id: string }>("select id from users where username = $1", [username]);
  return `${SESSION_COOKIE}=${await createSession({ id: rows[0].id })}`;
}

function request(method: string, cookie: string, body?: unknown): Request {
  return new Request("http://localhost/api/settings/menu", {
    method,
    headers: {
      cookie,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("menu seed", () => {
  it("locks all 21 flyer dish strings including 烏魚子五福拚 (U+62DA)", async () => {
    expect("烏魚子五福拚").toContain("\u62DA");
    expect("烏魚子五福拚").not.toContain("\u62FC");
    expect(FLYER_DISHES).toHaveLength(21);
    const names = (await sql<{ name: string }>("select name from dishes")).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining([...FLYER_DISHES]));
    expect(names).toContain("烏魚子五福拚");
    expect(names).not.toContain("烏魚子五福拼");
    const wan = await sql<{ name: string }>(
      `select d.name from set_dishes sd
       join dishes d on d.id = sd.dish_id
       join menu_sets ms on ms.id = sd.menu_set_id
       where ms.name = $1
       order by sd.sort_order`,
      ["萬元套餐"],
    );
    expect(wan.map((r) => r.name)[0]).toBe("烏魚子五福拚");
  });

  it("seeds three sets and keeps 上湯魚翅羹 as a dish priced at 1700", async () => {
    const sets = await sql<SetRow>("select id, name, price from menu_sets order by price desc, name");
    const byName = Object.fromEntries(sets.map((s) => [s.name, s]));
    expect(byName["萬元套餐"]?.price).toBe(10000);
    expect(byName["八千套餐"]?.price).toBe(8000);
    expect(byName["六千六套餐"]?.price).toBe(6600);
    expect(byName["單點上湯魚翅羹"]).toBeUndefined();
    const soup = await sql<{ name: string; alacarte_price: number }>(
      "select name, alacarte_price from dishes where name = $1",
      ["上湯魚翅羹"],
    );
    expect(soup).toHaveLength(1);
    expect(Number(soup[0].alacarte_price)).toBe(1700);
    const shrimp = await sql<{ alacarte_price: number }>(
      "select alacarte_price from dishes where name = $1",
      ["白灼蒜味蝦"],
    );
    expect(Number(shrimp[0].alacarte_price)).toBe(0);
  });

  it("reuses one dishes row for shared names across sets", async () => {
    const shrimp = await sql<DishRow>("select id, name from dishes where name = $1", ["白灼蒜味蝦"]);
    expect(shrimp).toHaveLength(1);
    const shrimpSets = await sql<{ n: string }>(
      `select ms.name as n
       from set_dishes sd
       join menu_sets ms on ms.id = sd.menu_set_id
       where sd.dish_id = $1
       order by ms.name`,
      [shrimp[0].id],
    );
    expect(shrimpSets.map((r) => r.n).sort()).toEqual(["八千套餐", "六千六套餐", "萬元套餐"].sort());

    const pig = await sql<DishRow>("select id from dishes where name = $1", ["招牌鹽酥豬腳"]);
    expect(pig).toHaveLength(1);
    const pigSets = await sql<{ n: string }>(
      `select ms.name as n from set_dishes sd
       join menu_sets ms on ms.id = sd.menu_set_id
       where sd.dish_id = $1 order by ms.name`,
      [pig[0].id],
    );
    expect(pigSets.map((r) => r.n).sort()).toEqual(["八千套餐", "萬元套餐"].sort());

    const soup = await sql<DishRow>("select id from dishes where name = $1", ["上湯魚翅羹"]);
    expect(soup).toHaveLength(1);
    const soupSets = await sql<{ n: string }>(
      `select ms.name as n from set_dishes sd
       join menu_sets ms on ms.id = sd.menu_set_id
       where sd.dish_id = $1 order by ms.name`,
      [soup[0].id],
    );
    expect(soupSets.map((r) => r.n)).toEqual(["八千套餐"]);
  });
});

describe("menu settings API", () => {
  it("lets an admin replace a dish on a set and writes audit", async () => {
    const set = (
      await sql<SetRow>("select id, name, price from menu_sets where name = $1", ["萬元套餐"])
    )[0];
    const oldDish = (
      await sql<DishRow>("select d.id, d.name from dishes d join set_dishes sd on sd.dish_id = d.id where sd.menu_set_id = $1 and d.name = $2", [
        set.id,
        "現烤鰻魚",
      ])
    )[0];

    const cookie = await adminCookie();
    const response = await PATCH(
      request("PATCH", cookie, {
        type: "set_dish",
        menu_set_id: set.id,
        dish_id: oldDish.id,
        new_dish_name: "測試替換菜",
      }),
    );
    expect(response.status).toBe(200);

    const names = await sql<{ name: string }>(
      `select d.name from set_dishes sd
       join dishes d on d.id = sd.dish_id
       where sd.menu_set_id = $1
       order by sd.sort_order, d.name`,
      [set.id],
    );
    expect(names.map((r) => r.name)).toContain("測試替換菜");
    expect(names.map((r) => r.name)).not.toContain("現烤鰻魚");

    const audits = await sql<{ action: string; entity: string }>(
      "select action, entity from audit_logs where entity = $1 order by created_at desc limit 1",
      ["set_dishes"],
    );
    expect(audits[0]?.action).toBe("replace_set_dish");

    const createdDish = (
      await sql<DishRow>("select id from dishes where name = $1", ["測試替換菜"])
    )[0];
    const dishAudits = await sql<{ action: string }>(
      "select action from audit_logs where entity = $1 and entity_id = $2",
      ["dishes", createdDish.id],
    );
    expect(dishAudits.map((row) => row.action)).toContain("create");

    const restore = (
      await sql<DishRow>("select id, name from dishes where name = $1", ["測試替換菜"])
    )[0];
    const putBack = await PATCH(
      request("PATCH", cookie, {
        type: "set_dish",
        menu_set_id: set.id,
        dish_id: restore.id,
        new_dish_name: "現烤鰻魚",
      }),
    );
    expect(putBack.status).toBe(200);
  });

  it("rejects a viewer replacing a dish with 403", async () => {
    const set = (await sql<SetRow>("select id from menu_sets where name = $1", ["八千套餐"]))[0];
    const dish = (
      await sql<DishRow>(
        `select d.id, d.name from dishes d
         join set_dishes sd on sd.dish_id = d.id
         where sd.menu_set_id = $1
         limit 1`,
        [set.id],
      )
    )[0];
    const cookie = await roleCookie("menu_viewer", "viewer");
    const response = await PATCH(
      request("PATCH", cookie, {
        type: "set_dish",
        menu_set_id: set.id,
        dish_id: dish.id,
        new_dish_name: "不該寫入",
      }),
    );
    expect(response.status).toBe(403);
    const leaked = await sql<DishRow>("select id from dishes where name = $1", ["不該寫入"]);
    expect(leaked).toHaveLength(0);
  });

  it("rejects pickup writes with 403", async () => {
    const cookie = await roleCookie("menu_pickup", "pickup");
    const response = await POST(
      request("POST", cookie, { type: "dish", name: "領餐不該建菜" }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects unauthenticated reads with 401", async () => {
    const response = await GET(new Request("http://localhost/api/settings/menu"));
    expect(response.status).toBe(401);
  });

  it("rolls back set_dishes when deleting a menu set blocked by orders", async () => {
    const set = (await sql<SetRow>("select id from menu_sets where name = $1", ["六千六套餐"]))[0];
    const before = await sql<{ n: string }>(
      "select count(*)::text as n from set_dishes where menu_set_id = $1",
      [set.id],
    );
    expect(Number(before[0].n)).toBeGreaterThan(0);
    const slot = (
      await sql<{ id: string }>(
        `insert into day_slots (service_date, service_type, label, start_time, end_time)
         values ('2027-02-05', 'takeout', '原子刪套', '11:00', '13:00')
         returning id`,
      )
    )[0];
    await sql(
      `insert into order_items (customer_name, phone, service_type, menu_set_id, slot_id, price)
       values ('原子客人', '0900000001', 'takeout', $1, $2, 6600)`,
      [set.id, slot.id],
    );
    const cookie = await adminCookie();
    const response = await DELETE(request("DELETE", cookie, { type: "menu_set", id: set.id }));
    expect(response.status).toBe(409);
    const after = await sql<{ n: string }>(
      "select count(*)::text as n from set_dishes where menu_set_id = $1",
      [set.id],
    );
    expect(after[0].n).toBe(before[0].n);
    const still = (await sql<SetRow>("select id from menu_sets where id = $1", [set.id]))[0];
    expect(still?.id).toBe(set.id);
  });

  it("rolls back set_dishes when deleting a dish blocked by addons", async () => {
    const dish = (await sql<DishRow>("select id, name from dishes where name = $1", ["椒麻蒜味小卷"]))[0];
    const before = await sql<{ n: string }>(
      "select count(*)::text as n from set_dishes where dish_id = $1",
      [dish.id],
    );
    expect(Number(before[0].n)).toBeGreaterThan(0);
    const slot = (
      await sql<{ id: string }>(
        `insert into day_slots (service_date, service_type, label, start_time, end_time)
         values ('2027-02-06', 'dine_in', '原子刪菜', '18:00', '21:00')
         returning id`,
      )
    )[0];
    const order = (
      await sql<{ id: string }>(
        `insert into order_items (customer_name, phone, service_type, slot_id, price)
         values ('加購客人', '0900000002', 'dine_in', $1, 0)
         returning id`,
        [slot.id],
      )
    )[0];
    await sql(
      "insert into addons (parent_order_item_id, dish_id, price) values ($1, $2, 0)",
      [order.id, dish.id],
    );
    const cookie = await adminCookie();
    const response = await DELETE(request("DELETE", cookie, { type: "dish", id: dish.id }));
    expect(response.status).toBe(409);
    const after = await sql<{ n: string }>(
      "select count(*)::text as n from set_dishes where dish_id = $1",
      [dish.id],
    );
    expect(after[0].n).toBe(before[0].n);
  });

  it("rolls back a replace when the new dish is already on the set", async () => {
    const set = (await sql<SetRow>("select id from menu_sets where name = $1", ["八千套餐"]))[0];
    const rows = await sql<DishRow>(
      `select d.id, d.name from dishes d
       join set_dishes sd on sd.dish_id = d.id
       where sd.menu_set_id = $1
       order by sd.sort_order`,
      [set.id],
    );
    const first = rows[0];
    const second = rows[1];
    const cookie = await adminCookie();
    const response = await PATCH(
      request("PATCH", cookie, {
        type: "set_dish",
        menu_set_id: set.id,
        dish_id: first.id,
        new_dish_id: second.id,
      }),
    );
    expect(response.status).toBe(409);
    const still = await sql<DishRow>(
      `select d.id, d.name from dishes d
       join set_dishes sd on sd.dish_id = d.id
       where sd.menu_set_id = $1
       order by sd.sort_order`,
      [set.id],
    );
    expect(still.map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });

  it("saves a custom dish with a 單點 price and lets staff change that price", async () => {
    const cookie = await adminCookie();
    const created = await POST(request("POST", cookie, { type: "dish", name: "手工拼盤", price: 80 }));
    expect(created.status).toBe(201);
    const dish = (await created.json()) as { id: string; name: string; alacarte_price: number };
    expect(dish).toMatchObject({ name: "手工拼盤", alacarte_price: 80 });

    const listed = await GET(request("GET", cookie));
    const body = (await listed.json()) as {
      sets: { name: string }[];
      dishes: { id: string; name: string; alacarte_price: number }[];
    };
    expect(body.sets.map((set) => set.name)).not.toContain("單點上湯魚翅羹");
    expect(body.dishes.find((item) => item.name === "上湯魚翅羹")?.alacarte_price).toBe(1700);
    expect(body.dishes.find((item) => item.name === "手工拼盤")?.alacarte_price).toBe(80);

    const updated = await PATCH(
      request("PATCH", cookie, { type: "dish_price", id: dish.id, alacarte_price: 120 }),
    );
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { alacarte_price: number }).alacarte_price).toBe(120);
    const negative = await PATCH(
      request("PATCH", cookie, { type: "dish_price", id: dish.id, alacarte_price: -1 }),
    );
    expect(negative.status).toBe(400);
    const soup = await sql<{ name: string }>("select name from dishes where name = $1", ["上湯魚翅羹"]);
    expect(soup).toHaveLength(1);
  });
});

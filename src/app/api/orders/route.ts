import { orderTotal } from "@/lib/money";
import { writeAudit } from "@/lib/audit";
import {
  BAD_ALACARTE_PRICE,
  BAD_PAID,
  BAD_QUANTITY,
  BAD_SET_PRICE,
  EMPTY_ALACARTE_PRICE,
  EMPTY_PAID,
  EMPTY_QUANTITY,
  EMPTY_SET_PRICE,
  isBlank,
  nonNegativeInteger,
} from "@/lib/numbers";
import { requireRole, requireUser, type User } from "@/lib/auth";
import { sql, withTransaction, type SqlFn } from "@/lib/db";
import {
  ADDON_SELECT,
  attachOrderDetails,
  defaultAmountPaid,
  nameSearchPattern,
  ORDER_SELECT,
  serializeAddon,
  serializeOrder,
  SOUP_DISH_NAME,
  type AddonRow,
  type OrderRow,
} from "@/lib/orders";
import { isTaiwanPhone, TAIWAN_PHONE_ERROR } from "@/lib/phone";

type Body = {
  customer_name?: unknown;
  phone?: unknown;
  service_type?: unknown;
  menu_set_id?: unknown;
  slot_id?: unknown;
  price?: unknown;
  amount_paid?: unknown;
  parent_order_item_id?: unknown;
  dish_id?: unknown;
  note?: unknown;
  alacarte?: unknown;
};

type AlacarteLine = { dish_id: string; quantity: number };

const NEED_ALACARTE = "請至少加入一道單點";

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

async function requireAdmin(request: Request): Promise<User | Response> {
  const user = await requireUser(request);
  if (isResponse(user)) return user;
  return requireRole(user, ["admin"]);
}

async function readBody(request: Request): Promise<Body | Response> {
  try {
    return (await request.json()) as Body;
  } catch {
    return Response.json({ error: "資料格式錯誤" }, { status: 400 });
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function asInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return undefined;
}

function asNote(value: unknown): string | Response | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return Response.json({ error: "備註不正確" }, { status: 400 });
  const note = value.trim();
  if (note.length > 500) return Response.json({ error: "備註最多 500 字" }, { status: 400 });
  return note;
}

function asServiceType(value: unknown): "takeout" | "dine_in" | undefined {
  const raw = asString(value);
  if (raw === "takeout" || raw === "dine_in") return raw;
  return undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseAlacarte(value: unknown): AlacarteLine[] | Response {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return Response.json({ error: "單點格式不正確" }, { status: 400 });
  const merged = new Map<string, number>();
  for (const item of value) {
    if (!item || typeof item !== "object") return Response.json({ error: "單點格式不正確" }, { status: 400 });
    const record = item as { dish_id?: unknown; quantity?: unknown };
    const dishId = asString(record.dish_id);
    if (!dishId || !UUID_RE.test(dishId)) return Response.json({ error: "菜色不正確" }, { status: 400 });
    let quantity = 1;
    if (record.quantity !== undefined) {
      if (isBlank(record.quantity)) return Response.json({ error: EMPTY_QUANTITY }, { status: 400 });
      const parsed = nonNegativeInteger(record.quantity);
      if (parsed === undefined || parsed < 1) {
        return Response.json({ error: BAD_QUANTITY }, { status: 400 });
      }
      quantity = parsed;
    }
    merged.set(dishId, (merged.get(dishId) ?? 0) + quantity);
  }
  return [...merged.entries()].map(([dish_id, quantity]) => ({ dish_id, quantity }));
}

async function prepareAlacarte(
  query: SqlFn,
  lines: AlacarteLine[],
): Promise<{ dish_id: string; quantity: number; price: number; amount_paid: number }[] | Response> {
  const prepared: { dish_id: string; quantity: number; price: number; amount_paid: number }[] = [];
  for (const line of lines) {
    const found = await query<{ id: string; alacarte_price: number | string }>(
      "select id, alacarte_price from dishes where id = $1",
      [line.dish_id],
    );
    if (!found[0]) return Response.json({ error: "找不到菜色" }, { status: 400 });
    prepared.push({
      dish_id: line.dish_id,
      quantity: line.quantity,
      price: Number(found[0].alacarte_price),
      amount_paid: 0,
    });
  }
  return prepared;
}

function explicitAmount(value: unknown): number | undefined | Response {
  if (value === undefined || value === null) return undefined;
  if (isBlank(value)) return Response.json({ error: EMPTY_PAID }, { status: 400 });
  const amount = nonNegativeInteger(value);
  if (amount === undefined) {
    return Response.json({ error: BAD_PAID }, { status: 400 });
  }
  return amount;
}

async function resolvePrice(
  bodyPrice: unknown,
  menuSetId: string | null,
  query: SqlFn,
): Promise<number | Response> {
  let fromSet: number | undefined;
  if (menuSetId) {
    const rows = await query<{ price: number }>("select price from menu_sets where id = $1", [menuSetId]);
    if (!rows[0]) return Response.json({ error: "找不到年菜價格" }, { status: 400 });
    fromSet = Number(rows[0].price);
  }
  if (bodyPrice === undefined || bodyPrice === null) {
    return fromSet ?? 0;
  }
  if (isBlank(bodyPrice)) {
    if (menuSetId) return Response.json({ error: EMPTY_SET_PRICE }, { status: 400 });
    return 0;
  }
  const price = nonNegativeInteger(bodyPrice);
  if (price === undefined) {
    return Response.json({ error: BAD_SET_PRICE }, { status: 400 });
  }
  return price;
}

export async function GET(request: Request): Promise<Response> {
  const user = await requireUser(request);
  if (isResponse(user)) return user;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const slotParams = url.searchParams.getAll("slot");
  if (slotParams.some((slot) => !UUID_RE.test(slot))) {
    return Response.json({ error: "時段不正確" }, { status: 400 });
  }
  const filters = ["oi.deleted_at is null"];
  const params: unknown[] = [];
  if (q) {
    params.push(nameSearchPattern(q));
    filters.push(`oi.customer_name ilike $${params.length} escape '\\'`);
  }
  if (slotParams.length > 0) {
    const placeholders = slotParams.map((slot) => {
      params.push(slot);
      return `$${params.length}`;
    });
    filters.push(`oi.slot_id in (${placeholders.join(", ")})`);
  }
  const rows = await sql<OrderRow>(
    `${ORDER_SELECT}
     where ${filters.join(" and ")}
     order by oi.created_at, oi.id`,
    params,
  );
  const orders = await attachOrderDetails(sql, rows.map(serializeOrder));
  return Response.json({ orders, role: user.role });
}

async function createAddon(admin: User, body: Body): Promise<Response> {
  const parentId = asString(body.parent_order_item_id);
  if (!parentId || !UUID_RE.test(parentId)) {
    return Response.json({ error: "母項目不正確" }, { status: 400 });
  }
  let dishId: string | null = null;
  if (body.dish_id !== undefined && body.dish_id !== null && body.dish_id !== "") {
    const parsed = asString(body.dish_id);
    if (!parsed || !UUID_RE.test(parsed)) return Response.json({ error: "菜色不正確" }, { status: 400 });
    dishId = parsed;
  }
  let requestedPrice: number | undefined;
  if (body.price !== undefined && body.price !== null) {
    if (isBlank(body.price)) return Response.json({ error: EMPTY_ALACARTE_PRICE }, { status: 400 });
    const parsed = nonNegativeInteger(body.price);
    if (parsed === undefined) {
      return Response.json({ error: BAD_ALACARTE_PRICE }, { status: 400 });
    }
    requestedPrice = parsed;
  }

  try {
    const created = await withTransaction(async (query) => {
      const parent = await query<{ id: string }>(
        "select id from order_items where id = $1 and deleted_at is null",
        [parentId],
      );
      if (!parent[0]) return Response.json({ error: "找不到母項目" }, { status: 400 });

      if (!dishId) {
        const dishes = await query<{ id: string }>("select id from dishes where name = $1", [SOUP_DISH_NAME]);
        if (!dishes[0]) return Response.json({ error: "找不到上湯魚翅羹" }, { status: 400 });
        dishId = dishes[0].id;
      } else {
        const dishes = await query<{ id: string }>("select id from dishes where id = $1", [dishId]);
        if (!dishes[0]) return Response.json({ error: "找不到菜色" }, { status: 400 });
      }

      let price = requestedPrice;
      if (price === undefined) {
        const priced = await query<{ alacarte_price: number | string }>(
          "select alacarte_price from dishes where id = $1",
          [dishId],
        );
        price = Number(priced[0]?.alacarte_price ?? 0);
      }
      const rows = await query<{ id: string }>(
        `insert into addons (parent_order_item_id, dish_id, price, amount_paid, quantity)
         values ($1, $2, $3, 0, 1)
         returning id`,
        [parentId, dishId, price],
      );
      const full = await query<AddonRow>(`${ADDON_SELECT} where a.id = $1`, [rows[0].id]);
      const after = serializeAddon(full[0]);
      await writeAudit(
        {
          userId: admin.id,
          action: "create",
          entity: "addons",
          entityId: after.id,
          after,
        },
        query,
      );
      return after;
    });
    if (created instanceof Response) return created;
    return Response.json(created, { status: 201 });
  } catch {
    return Response.json({ error: "無法建立加購" }, { status: 400 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if (isResponse(admin)) return admin;
  const body = await readBody(request);
  if (body instanceof Response) return body;
  if (body.parent_order_item_id !== undefined && body.parent_order_item_id !== null && body.parent_order_item_id !== "") {
    return createAddon(admin, body);
  }

  const customerName = asString(body.customer_name);
  const phone = asString(body.phone);
  const serviceType = asServiceType(body.service_type);
  const slotId = asString(body.slot_id);
  const parsedMenuSetId =
    body.menu_set_id == null || body.menu_set_id === "" ? null : asString(body.menu_set_id);
  if (body.menu_set_id != null && body.menu_set_id !== "" && !parsedMenuSetId) {
    return Response.json({ error: "年菜價格不正確" }, { status: 400 });
  }
  const menuSetId: string | null = parsedMenuSetId ?? null;
  if (!customerName || !phone || !serviceType || !slotId) {
    return Response.json({ error: "姓名、電話、內用或外帶、時段必填" }, { status: 400 });
  }
  if (!isTaiwanPhone(phone)) {
    return Response.json({ error: TAIWAN_PHONE_ERROR }, { status: 400 });
  }
  const parsedNote = asNote(body.note);
  if (parsedNote instanceof Response) return parsedNote;
  const note = parsedNote ?? "";
  const alacarte = parseAlacarte(body.alacarte);
  if (alacarte instanceof Response) return alacarte;
  if (!menuSetId && alacarte.length === 0) {
    return Response.json({ error: NEED_ALACARTE }, { status: 400 });
  }
  const requestedPaid = explicitAmount(body.amount_paid);
  if (isResponse(requestedPaid)) return requestedPaid;

  try {
    const created = await withTransaction(async (query) => {
      const slot = await query<{ id: string; service_type: string }>(
        "select id, service_type from day_slots where id = $1",
        [slotId],
      );
      if (!slot[0]) return Response.json({ error: "找不到時段" }, { status: 400 });
      if (slot[0].service_type !== serviceType) {
        return Response.json({ error: "時段與內用或外帶不符" }, { status: 400 });
      }
      const price = await resolvePrice(body.price, menuSetId, query);
      if (isResponse(price)) return price;
      const portions = await prepareAlacarte(query, alacarte);
      if (portions instanceof Response) return portions;
      const amountPaid = requestedPaid ?? defaultAmountPaid(orderTotal(price, portions));
      const rows = await query<OrderRow>(
        `insert into order_items
           (customer_name, phone, service_type, menu_set_id, slot_id, price, amount_paid, note)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning id`,
        [customerName, phone, serviceType, menuSetId, slotId, price, amountPaid, note],
      );
      for (const portion of portions) {
        await query(
          `insert into addons (parent_order_item_id, dish_id, price, amount_paid, quantity)
           values ($1, $2, $3, $4, $5)`,
          [rows[0].id, portion.dish_id, portion.price, portion.amount_paid, portion.quantity],
        );
      }
      const full = await query<OrderRow>(`${ORDER_SELECT} where oi.id = $1`, [rows[0].id]);
      const after = (await attachOrderDetails(query, [serializeOrder(full[0])]))[0];
      await writeAudit(
        {
          userId: admin.id,
          action: "create",
          entity: "order_items",
          entityId: after.id,
          after,
        },
        query,
      );
      return after;
    });
    if (created instanceof Response) return created;
    return Response.json(created, { status: 201 });
  } catch {
    return Response.json({ error: "無法建立訂單" }, { status: 400 });
  }
}

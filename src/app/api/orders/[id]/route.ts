import { writeAudit } from "@/lib/audit";
import { requireUser, type User } from "@/lib/auth";
import { withTransaction, type SqlFn } from "@/lib/db";
import {
  ADDON_SELECT,
  attachOrderDetails,
  ORDER_SELECT,
  serializeAddon,
  serializeOrder,
  type AddonJson,
  type AddonRow,
  type OrderJson,
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
  picked_up?: unknown;
  note?: unknown;
  quantity?: unknown;
  alacarte?: unknown;
};

type RouteContext = { params: Promise<{ id: string }> };

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
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

function forbidden(): Response {
  return Response.json({ error: "沒有權限" }, { status: 403 });
}

function isPickupOnly(body: Body): body is { picked_up: boolean } {
  const keys = Object.keys(body);
  return keys.length === 1 && keys[0] === "picked_up" && typeof body.picked_up === "boolean";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function orderId(context: RouteContext): Promise<string | Response> {
  const { id } = await context.params;
  if (!id || !UUID_RE.test(id)) return Response.json({ error: "缺少訂單" }, { status: 400 });
  return id;
}

async function loadOrder(query: SqlFn, id: string): Promise<OrderJson | null> {
  const rows = await query<OrderRow>(
    `${ORDER_SELECT} where oi.id = $1 and oi.deleted_at is null`,
    [id],
  );
  if (!rows[0]) return null;
  const [order] = await attachOrderDetails(query, [serializeOrder(rows[0])]);
  return order;
}

async function loadAddon(query: SqlFn, id: string): Promise<AddonJson | null> {
  const rows = await query<AddonRow>(
    `${ADDON_SELECT} where a.id = $1 and a.deleted_at is null`,
    [id],
  );
  return rows[0] ? serializeAddon(rows[0]) : null;
}

async function markPickedUp(user: User, id: string, pickedUp: boolean): Promise<Response> {
  try {
    const updated = await withTransaction(async (query) => {
      const order = await loadOrder(query, id);
      if (order) {
        await query(
          "update order_items set picked_up = $1 where id = $2 and deleted_at is null",
          [pickedUp, id],
        );
        const after = await loadOrder(query, id);
        if (!after) return Response.json({ error: "找不到訂單" }, { status: 404 });
        await writeAudit(
          {
            userId: user.id,
            action: "update",
            entity: "order_items",
            entityId: id,
            before: order,
            after,
          },
          query,
        );
        return after;
      }
      const addon = await loadAddon(query, id);
      if (!addon) return Response.json({ error: "找不到訂單" }, { status: 404 });
      await query("update addons set picked_up = $1 where id = $2 and deleted_at is null", [pickedUp, id]);
      const after = await loadAddon(query, id);
      if (!after) return Response.json({ error: "找不到訂單" }, { status: 404 });
      await writeAudit(
        {
          userId: user.id,
          action: "update",
          entity: "addons",
          entityId: id,
          before: addon,
          after,
        },
        query,
      );
      return after;
    });
    if (updated instanceof Response) return updated;
    return Response.json(updated);
  } catch {
    return Response.json({ error: "無法更新訂單" }, { status: 400 });
  }
}

const NEED_ALACARTE = "請至少加入一道單點";

type EditLine = { id?: string; dish_id: string; quantity: number };

function parseEditLines(value: unknown): EditLine[] | Response {
  if (!Array.isArray(value)) return Response.json({ error: "單點格式不正確" }, { status: 400 });
  const merged = new Map<string, EditLine>();
  for (const item of value) {
    if (!item || typeof item !== "object") return Response.json({ error: "單點格式不正確" }, { status: 400 });
    const record = item as { id?: unknown; dish_id?: unknown; quantity?: unknown };
    const id = asString(record.id);
    const dishId = asString(record.dish_id);
    if (!dishId || !UUID_RE.test(dishId)) return Response.json({ error: "菜色不正確" }, { status: 400 });
    if (id && !UUID_RE.test(id)) return Response.json({ error: "菜色不正確" }, { status: 400 });
    const parsed = asInt(record.quantity);
    const quantity = record.quantity === undefined || record.quantity === null || record.quantity === "" ? 1 : parsed;
    if (quantity === undefined || quantity < 1) {
      return Response.json({ error: "數量須為正整數" }, { status: 400 });
    }
    const key = id ?? `new:${dishId}`;
    const prev = merged.get(key);
    if (prev) prev.quantity += quantity;
    else merged.set(key, { ...(id ? { id } : {}), dish_id: dishId, quantity });
  }
  return [...merged.values()];
}

type ReadyLine = EditLine & { unitPrice?: number };

async function resolveAlacarteEdits(query: SqlFn, orderId: string, lines: EditLine[]): Promise<ReadyLine[] | Response> {
  const current = await query<{ id: string; dish_id: string }>(
    "select id, dish_id from addons where parent_order_item_id = $1 and deleted_at is null",
    [orderId],
  );
  const byId = new Map(current.map((row) => [row.id, row]));
  const ready: ReadyLine[] = [];
  for (const line of lines) {
    if (line.id) {
      const row = byId.get(line.id);
      if (!row || row.dish_id !== line.dish_id) return Response.json({ error: "找不到菜色" }, { status: 400 });
      ready.push(line);
      continue;
    }
    const found = await query<{ alacarte_price: number | string }>(
      "select alacarte_price from dishes where id = $1",
      [line.dish_id],
    );
    if (!found[0]) return Response.json({ error: "找不到菜色" }, { status: 400 });
    ready.push({ ...line, unitPrice: Number(found[0].alacarte_price) });
  }
  return ready;
}

async function writeAlacarteEdits(query: SqlFn, orderId: string, lines: ReadyLine[]): Promise<void> {
  const current = await query<{ id: string }>(
    "select id from addons where parent_order_item_id = $1 and deleted_at is null",
    [orderId],
  );
  const kept = new Set<string>();
  for (const line of lines) {
    if (line.id) {
      await query("update addons set quantity = $1 where id = $2 and deleted_at is null", [line.quantity, line.id]);
      kept.add(line.id);
      continue;
    }
    await query(
      `insert into addons (parent_order_item_id, dish_id, price, amount_paid, quantity)
       values ($1, $2, $3, 0, $4)`,
      [orderId, line.dish_id, line.unitPrice ?? 0, line.quantity],
    );
  }
  for (const row of current) {
    if (kept.has(row.id)) continue;
    await query("update addons set deleted_at = now() where id = $1 and deleted_at is null", [row.id]);
  }
}

const ADDON_FIELDS = new Set(["price", "amount_paid", "picked_up", "quantity"]);

async function updateAddon(query: SqlFn, admin: User, id: string, body: Body): Promise<AddonJson | Response> {
  const keys = Object.keys(body);
  if (keys.some((key) => !ADDON_FIELDS.has(key))) {
    return Response.json({ error: "加購只能改售價、數量、已收或領取" }, { status: 400 });
  }
  const before = await loadAddon(query, id);
  if (!before) return Response.json({ error: "找不到訂單" }, { status: 404 });

  let price = before.price;
  if (body.price !== undefined) {
    const parsed = asInt(body.price);
    if (parsed === undefined || parsed < 0) {
      return Response.json({ error: "售價須為非負整數" }, { status: 400 });
    }
    price = parsed;
  }
  let amountPaid = before.amount_paid;
  if (body.amount_paid !== undefined) {
    const parsed = asInt(body.amount_paid);
    if (parsed === undefined || parsed < 0) {
      return Response.json({ error: "已收須為非負整數" }, { status: 400 });
    }
    amountPaid = parsed;
  }
  let pickedUp = before.picked_up;
  if (body.picked_up !== undefined) {
    if (typeof body.picked_up !== "boolean") {
      return Response.json({ error: "領取狀態不正確" }, { status: 400 });
    }
    pickedUp = body.picked_up;
  }
  let quantity = before.quantity;
  if (body.quantity !== undefined) {
    const parsed = asInt(body.quantity);
    if (parsed === undefined || parsed < 1) {
      return Response.json({ error: "數量須為正整數" }, { status: 400 });
    }
    quantity = parsed;
  }
  await query(
    `update addons set price = $1, amount_paid = $2, picked_up = $3, quantity = $4
     where id = $5 and deleted_at is null`,
    [price, amountPaid, pickedUp, quantity, id],
  );
  const after = await loadAddon(query, id);
  if (!after) return Response.json({ error: "找不到訂單" }, { status: 404 });
  await writeAudit(
    {
      userId: admin.id,
      action: "update",
      entity: "addons",
      entityId: id,
      before,
      after,
    },
    query,
  );
  return after;
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  if (isResponse(user)) return user;
  const id = await orderId(context);
  if (isResponse(id)) return id;
  const body = await readBody(request);
  if (body instanceof Response) return body;

  if (user.role === "pickup") {
    if (!isPickupOnly(body)) return forbidden();
    return markPickedUp(user, id, body.picked_up);
  }
  if (user.role !== "admin") return forbidden();

  try {
    const updated = await withTransaction(async (query) => {
      const before = await loadOrder(query, id);
      if (!before) return updateAddon(query, user, id, body);

      const customerName =
        body.customer_name === undefined ? before.customer_name : asString(body.customer_name);
      const phone = body.phone === undefined ? before.phone : asString(body.phone);
      const serviceType =
        body.service_type === undefined ? before.service_type : asServiceType(body.service_type);
      const slotId = body.slot_id === undefined ? before.slot_id : asString(body.slot_id);
      if (!customerName || !phone || !serviceType || !slotId) {
        return Response.json({ error: "姓名、電話、內用或外帶、時段必填" }, { status: 400 });
      }
      if (body.phone !== undefined && !isTaiwanPhone(phone)) {
        return Response.json({ error: TAIWAN_PHONE_ERROR }, { status: 400 });
      }

      let menuSetId = before.menu_set_id;
      if (body.menu_set_id !== undefined) {
        if (body.menu_set_id === null || body.menu_set_id === "") menuSetId = null;
        else {
          const parsed = asString(body.menu_set_id);
          if (!parsed) return Response.json({ error: "年菜價格不正確" }, { status: 400 });
          menuSetId = parsed;
        }
      }

      const slot = await query<{ id: string; service_type: string }>(
        "select id, service_type from day_slots where id = $1",
        [slotId],
      );
      if (!slot[0]) return Response.json({ error: "找不到時段" }, { status: 400 });
      if (slot[0].service_type !== serviceType) {
        return Response.json({ error: "時段與內用或外帶不符" }, { status: 400 });
      }
      let editLines: ReadyLine[] | undefined;
      if (body.alacarte !== undefined) {
        const parsedLines = parseEditLines(body.alacarte);
        if (parsedLines instanceof Response) return parsedLines;
        const resolved = await resolveAlacarteEdits(query, id, parsedLines);
        if (resolved instanceof Response) return resolved;
        editLines = resolved;
      }
      const lineCount = editLines ? editLines.length : before.addons.length;
      if (!menuSetId && lineCount === 0) {
        return Response.json({ error: NEED_ALACARTE }, { status: 400 });
      }

      let price = before.price;
      if (menuSetId && menuSetId !== before.menu_set_id) {
        const set = await query<{ price: number }>("select price from menu_sets where id = $1", [menuSetId]);
        if (!set[0]) return Response.json({ error: "找不到年菜價格" }, { status: 400 });
        if (body.price === undefined) price = Number(set[0].price);
      } else if (!menuSetId && menuSetId !== before.menu_set_id && body.price === undefined) {
        price = 0;
      }
      if (body.price !== undefined) {
        const parsed = asInt(body.price);
        if (parsed === undefined || parsed < 0) {
          return Response.json({ error: "售價須為非負整數" }, { status: 400 });
        }
        price = parsed;
      }

      let amountPaid = before.amount_paid;
      if (body.amount_paid !== undefined) {
        const parsed = asInt(body.amount_paid);
        if (parsed === undefined || parsed < 0) {
          return Response.json({ error: "已收須為非負整數" }, { status: 400 });
        }
        amountPaid = parsed;
      }

      let pickedUp = before.picked_up;
      if (body.picked_up !== undefined) {
        if (typeof body.picked_up !== "boolean") {
          return Response.json({ error: "領取狀態不正確" }, { status: 400 });
        }
        pickedUp = body.picked_up;
      }

      let note = before.note;
      if (body.note !== undefined) {
        const parsed = asNote(body.note);
        if (parsed instanceof Response) return parsed;
        note = parsed ?? "";
      }

      await query(
        `update order_items
         set customer_name = $1, phone = $2, service_type = $3, menu_set_id = $4,
             slot_id = $5, price = $6, amount_paid = $7, picked_up = $8, note = $9
         where id = $10 and deleted_at is null`,
        [customerName, phone, serviceType, menuSetId, slotId, price, amountPaid, pickedUp, note, id],
      );
      if (editLines) await writeAlacarteEdits(query, id, editLines);
      const after = await loadOrder(query, id);
      if (!after) return Response.json({ error: "找不到訂單" }, { status: 404 });
      await writeAudit(
        {
          userId: user.id,
          action: "update",
          entity: "order_items",
          entityId: id,
          before,
          after,
        },
        query,
      );
      return after;
    });
    if (updated instanceof Response) return updated;
    return Response.json(updated);
  } catch {
    return Response.json({ error: "無法更新訂單" }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  if (isResponse(user)) return user;
  if (user.role !== "admin") return forbidden();
  const id = await orderId(context);
  if (isResponse(id)) return id;

  try {
    const result = await withTransaction(async (query) => {
      const before = await loadOrder(query, id);
      if (!before) {
        const addon = await loadAddon(query, id);
        if (!addon) return Response.json({ error: "找不到訂單" }, { status: 404 });
        const rows = await query<{ deleted_at: string }>(
          `update addons set deleted_at = now()
           where id = $1 and deleted_at is null
           returning deleted_at`,
          [id],
        );
        if (!rows[0]) return Response.json({ error: "找不到訂單" }, { status: 404 });
        await writeAudit(
          {
            userId: user.id,
            action: "delete",
            entity: "addons",
            entityId: id,
            before: addon,
            after: { ...addon, deleted_at: rows[0].deleted_at },
          },
          query,
        );
        return { ok: true as const };
      }
      const rows = await query<{ deleted_at: string }>(
        `update order_items set deleted_at = now()
         where id = $1 and deleted_at is null
         returning deleted_at`,
        [id],
      );
      if (!rows[0]) return Response.json({ error: "找不到訂單" }, { status: 404 });
      await query(
        `update addons set deleted_at = now()
         where parent_order_item_id = $1 and deleted_at is null`,
        [id],
      );
      await writeAudit(
        {
          userId: user.id,
          action: "delete",
          entity: "order_items",
          entityId: id,
          before,
          after: { ...before, deleted_at: rows[0].deleted_at, addons: [] },
        },
        query,
      );
      return { ok: true as const };
    });
    if (result instanceof Response) return result;
    return Response.json(result);
  } catch {
    return Response.json({ error: "無法刪除訂單" }, { status: 400 });
  }
}

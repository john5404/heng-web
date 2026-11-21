import { writeAudit } from "@/lib/audit";
import { requireRole, requireUser, type User } from "@/lib/auth";
import { sql, withTransaction, type SqlFn } from "@/lib/db";

type MenuSetRow = { id: string; name: string; price: number };
type DishRow = { id: string; name: string };
type SetDishRow = {
  menu_set_id: string;
  dish_id: string;
  sort_order: number;
  dish_name: string;
};

type Body = {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  price?: unknown;
  menu_set_id?: unknown;
  dish_id?: unknown;
  new_dish_id?: unknown;
  new_dish_name?: unknown;
  sort_order?: unknown;
};

function isResponse(value: User | Response): value is Response {
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

export async function GET(request: Request): Promise<Response> {
  const user = await requireUser(request);
  if (isResponse(user)) return user;

  const sets = await sql<MenuSetRow>("select id, name, price from menu_sets order by price desc, name");
  const dishes = await sql<DishRow>("select id, name from dishes order by name");
  const links = await sql<SetDishRow>(
    `select sd.menu_set_id, sd.dish_id, sd.sort_order, d.name as dish_name
     from set_dishes sd
     join dishes d on d.id = sd.dish_id
     order by sd.sort_order, d.name`,
  );
  return Response.json({
    sets: sets.map((set) => ({
      ...set,
      dishes: links
        .filter((row) => row.menu_set_id === set.id)
        .map((row) => ({ id: row.dish_id, name: row.dish_name, sort_order: row.sort_order })),
    })),
    dishes,
  });
}

export async function POST(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if (isResponse(admin)) return admin;
  const body = await readBody(request);
  if (body instanceof Response) return body;
  const type = asString(body.type);

  if (type === "menu_set") {
    const name = asString(body.name);
    const price = asInt(body.price);
    if (!name || price === undefined || price < 0) {
      return Response.json({ error: "套餐名稱與價格必填" }, { status: 400 });
    }
    const rows = await sql<MenuSetRow>(
      "insert into menu_sets (name, price) values ($1, $2) returning id, name, price",
      [name, price],
    );
    await writeAudit({
      userId: admin.id,
      action: "create",
      entity: "menu_sets",
      entityId: rows[0].id,
      after: rows[0],
    });
    return Response.json(rows[0], { status: 201 });
  }

  if (type === "dish") {
    const name = asString(body.name);
    if (!name) return Response.json({ error: "菜名必填" }, { status: 400 });
    const existing = await sql<DishRow>("select id, name from dishes where name = $1", [name]);
    if (existing[0]) {
      return Response.json({ error: "菜名已存在", dish: existing[0] }, { status: 409 });
    }
    const rows = await sql<DishRow>("insert into dishes (name) values ($1) returning id, name", [name]);
    await writeAudit({
      userId: admin.id,
      action: "create",
      entity: "dishes",
      entityId: rows[0].id,
      after: rows[0],
    });
    return Response.json(rows[0], { status: 201 });
  }

  if (type === "set_dish") {
    const menuSetId = asString(body.menu_set_id);
    const dishId = asString(body.dish_id);
    const sortOrder = asInt(body.sort_order) ?? 0;
    if (!menuSetId || !dishId) {
      return Response.json({ error: "套餐與菜項必填" }, { status: 400 });
    }
    try {
      await sql(
        "insert into set_dishes (menu_set_id, dish_id, sort_order) values ($1, $2, $3)",
        [menuSetId, dishId, sortOrder],
      );
    } catch {
      return Response.json({ error: "無法加入菜項" }, { status: 409 });
    }
    await writeAudit({
      userId: admin.id,
      action: "create",
      entity: "set_dishes",
      entityId: `${menuSetId}:${dishId}`,
      after: { menu_set_id: menuSetId, dish_id: dishId, sort_order: sortOrder },
    });
    return Response.json({ ok: true }, { status: 201 });
  }

  return Response.json({ error: "未知操作" }, { status: 400 });
}

export async function PATCH(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if (isResponse(admin)) return admin;
  const body = await readBody(request);
  if (body instanceof Response) return body;
  const type = asString(body.type);

  if (type === "menu_set") {
    const id = asString(body.id);
    if (!id) return Response.json({ error: "缺少套餐" }, { status: 400 });
    const before = (await sql<MenuSetRow>("select id, name, price from menu_sets where id = $1", [id]))[0];
    if (!before) return Response.json({ error: "找不到套餐" }, { status: 404 });
    const name = asString(body.name) ?? before.name;
    const price = asInt(body.price) ?? before.price;
    if (price < 0) return Response.json({ error: "價格不可為負" }, { status: 400 });
    const after = (
      await sql<MenuSetRow>("update menu_sets set name = $1, price = $2 where id = $3 returning id, name, price", [
        name,
        price,
        id,
      ])
    )[0];
    await writeAudit({
      userId: admin.id,
      action: "update",
      entity: "menu_sets",
      entityId: id,
      before,
      after,
    });
    return Response.json(after);
  }

  if (type === "dish") {
    const id = asString(body.id);
    const name = asString(body.name);
    if (!id || !name) return Response.json({ error: "菜名必填" }, { status: 400 });
    const before = (await sql<DishRow>("select id, name from dishes where id = $1", [id]))[0];
    if (!before) return Response.json({ error: "找不到菜項" }, { status: 404 });
    try {
      const after = (
        await sql<DishRow>("update dishes set name = $1 where id = $2 returning id, name", [name, id])
      )[0];
      await writeAudit({
        userId: admin.id,
        action: "update",
        entity: "dishes",
        entityId: id,
        before,
        after,
      });
      return Response.json(after);
    } catch {
      return Response.json({ error: "菜名已存在" }, { status: 409 });
    }
  }

  if (type === "set_dish") {
    const menuSetId = asString(body.menu_set_id);
    const dishId = asString(body.dish_id);
    if (!menuSetId || !dishId) {
      return Response.json({ error: "套餐與菜項必填" }, { status: 400 });
    }
    const current = (
      await sql<{ dish_id: string; sort_order: number; dish_name: string }>(
        `select sd.dish_id, sd.sort_order, d.name as dish_name
         from set_dishes sd join dishes d on d.id = sd.dish_id
         where sd.menu_set_id = $1 and sd.dish_id = $2`,
        [menuSetId, dishId],
      )
    )[0];
    if (!current) return Response.json({ error: "套餐沒有這道菜" }, { status: 404 });

    try {
      const after = await withTransaction(async (q) => {
        const next = await resolveDish(
          asString(body.new_dish_id),
          asString(body.new_dish_name),
          q,
          admin.id,
        );
        if (next.id !== dishId) {
          const clash = await q<{ dish_id: string }>(
            "select dish_id from set_dishes where menu_set_id = $1 and dish_id = $2",
            [menuSetId, next.id],
          );
          if (clash[0]) throw new HttpError(409, "這道菜已在套餐中");
          await q("delete from set_dishes where menu_set_id = $1 and dish_id = $2", [menuSetId, dishId]);
          await q("insert into set_dishes (menu_set_id, dish_id, sort_order) values ($1, $2, $3)", [
            menuSetId,
            next.id,
            current.sort_order,
          ]);
        }
        const payload = {
          menu_set_id: menuSetId,
          dish_id: next.id,
          name: next.name,
          sort_order: current.sort_order,
        };
        await writeAudit(
          {
            userId: admin.id,
            action: "replace_set_dish",
            entity: "set_dishes",
            entityId: menuSetId,
            before: {
              menu_set_id: menuSetId,
              dish_id: dishId,
              name: current.dish_name,
              sort_order: current.sort_order,
            },
            after: payload,
          },
          q,
        );
        return payload;
      });
      return Response.json(after);
    } catch (error) {
      if (error instanceof HttpError) return error.toResponse();
      return Response.json({ error: "無法替換菜項" }, { status: 409 });
    }
  }

  return Response.json({ error: "未知操作" }, { status: 400 });
}

export async function DELETE(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if (isResponse(admin)) return admin;
  const body = await readBody(request);
  if (body instanceof Response) return body;
  const type = asString(body.type);

  if (type === "menu_set") {
    const id = asString(body.id);
    if (!id) return Response.json({ error: "缺少套餐" }, { status: 400 });
    const before = (await sql<MenuSetRow>("select id, name, price from menu_sets where id = $1", [id]))[0];
    if (!before) return Response.json({ error: "找不到套餐" }, { status: 404 });
    try {
      await withTransaction(async (q) => {
        await q("delete from set_dishes where menu_set_id = $1", [id]);
        await q("delete from menu_sets where id = $1", [id]);
        await writeAudit(
          {
            userId: admin.id,
            action: "delete",
            entity: "menu_sets",
            entityId: id,
            before,
          },
          q,
        );
      });
    } catch {
      return Response.json({ error: "套餐已有訂單，無法刪除" }, { status: 409 });
    }
    return Response.json({ ok: true });
  }

  if (type === "dish") {
    const id = asString(body.id);
    if (!id) return Response.json({ error: "缺少菜項" }, { status: 400 });
    const before = (await sql<DishRow>("select id, name from dishes where id = $1", [id]))[0];
    if (!before) return Response.json({ error: "找不到菜項" }, { status: 404 });
    try {
      await withTransaction(async (q) => {
        await q("delete from set_dishes where dish_id = $1", [id]);
        await q("delete from dishes where id = $1", [id]);
        await writeAudit(
          {
            userId: admin.id,
            action: "delete",
            entity: "dishes",
            entityId: id,
            before,
          },
          q,
        );
      });
    } catch {
      return Response.json({ error: "菜項已有訂單加購，無法刪除" }, { status: 409 });
    }
    return Response.json({ ok: true });
  }

  if (type === "set_dish") {
    const menuSetId = asString(body.menu_set_id);
    const dishId = asString(body.dish_id);
    if (!menuSetId || !dishId) {
      return Response.json({ error: "套餐與菜項必填" }, { status: 400 });
    }
    const before = (
      await sql<{ dish_id: string; sort_order: number }>(
        "select dish_id, sort_order from set_dishes where menu_set_id = $1 and dish_id = $2",
        [menuSetId, dishId],
      )
    )[0];
    if (!before) return Response.json({ error: "套餐沒有這道菜" }, { status: 404 });
    await sql("delete from set_dishes where menu_set_id = $1 and dish_id = $2", [menuSetId, dishId]);
    await writeAudit({
      userId: admin.id,
      action: "delete",
      entity: "set_dishes",
      entityId: menuSetId,
      before: { menu_set_id: menuSetId, ...before },
    });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "未知操作" }, { status: 400 });
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly messageText: string,
  ) {
    super(messageText);
  }
  toResponse(): Response {
    return Response.json({ error: this.messageText }, { status: this.status });
  }
}

async function resolveDish(
  newDishId: string | undefined,
  newDishName: string | undefined,
  query: SqlFn,
  adminId: string,
): Promise<DishRow> {
  if (newDishId) {
    const row = (await query<DishRow>("select id, name from dishes where id = $1", [newDishId]))[0];
    if (!row) throw new HttpError(404, "找不到菜項");
    return row;
  }
  if (!newDishName) throw new HttpError(400, "請指定新菜項");
  const existing = (await query<DishRow>("select id, name from dishes where name = $1", [newDishName]))[0];
  if (existing) return existing;
  const created = (
    await query<DishRow>("insert into dishes (name) values ($1) returning id, name", [newDishName])
  )[0];
  await writeAudit(
    {
      userId: adminId,
      action: "create",
      entity: "dishes",
      entityId: created.id,
      after: created,
    },
    query,
  );
  return created;
}

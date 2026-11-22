import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { PREP_NOTE, dishTotalsForDate, dishTotalsForSlot, type DishTotal } from "@/lib/kitchen";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type SlotMeta = {
  id: string;
  label: string;
  service_type: string;
  service_date: string;
};

export async function GET(request: Request): Promise<Response> {
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  const params = new URL(request.url).searchParams;
  const date = params.get("date")?.trim() ?? "";
  const slotIds = params
    .getAll("slot_id")
    .map((slot) => slot.trim())
    .filter((slot) => slot !== "");
  if (!DATE_RE.test(date) || slotIds.length === 0) {
    return Response.json({ error: "請選擇日期與時段" }, { status: 400 });
  }

  const placeholders = slotIds.map((_, index) => `$${index + 1}`).join(", ");
  const metas = await sql<SlotMeta>(
    `select id, label, service_type, to_char(service_date, 'YYYY-MM-DD') as service_date
     from day_slots
     where id in (${placeholders})`,
    slotIds,
  );
  const byId = new Map(metas.map((row) => [row.id, row]));
  const bySlot: { slot_id: string; label: string; service_type: string; totals: DishTotal[] }[] = [];
  for (const slotId of slotIds) {
    const meta = byId.get(slotId);
    bySlot.push({
      slot_id: slotId,
      label: meta?.label ?? "",
      service_type: meta?.service_type ?? "",
      totals: await dishTotalsForSlot(date, slotId),
    });
  }
  const day = await dishTotalsForDate(date);
  return Response.json({
    date,
    slot_id: slotIds[0],
    slot_ids: slotIds,
    totals: day,
    by_slot: bySlot,
    combined: day,
    note: PREP_NOTE,
  });
}

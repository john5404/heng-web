import { requireUser } from "@/lib/auth";
import { PREP_NOTE, dishTotalsForSlot } from "@/lib/kitchen";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request): Promise<Response> {
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  const params = new URL(request.url).searchParams;
  const date = params.get("date")?.trim() ?? "";
  const slotId = params.get("slot_id")?.trim() ?? "";
  if (!DATE_RE.test(date) || slotId === "") {
    return Response.json({ error: "請選擇日期與時段" }, { status: 400 });
  }

  const totals = await dishTotalsForSlot(date, slotId);
  return Response.json({ date, slot_id: slotId, totals, note: PREP_NOTE });
}

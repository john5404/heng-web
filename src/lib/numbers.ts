export const EMPTY_SET_PRICE = "年菜售價不能留空";
export const EMPTY_PAID = "已收不能留空";
export const EMPTY_QUANTITY = "數量不能留空";
export const EMPTY_ALACARTE_PRICE = "單點價格不能留空";
export const EMPTY_MENU_PRICE = "套餐價格不能留空";
export const BAD_SET_PRICE = "售價須為非負整數";
export const BAD_PAID = "已收須為非負整數";
export const BAD_QUANTITY = "數量須為正整數";
export const BAD_ALACARTE_PRICE = "單點價格須為非負整數";

export function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

/** A non-negative whole number. Blank and other text are not numbers. */
export function nonNegativeInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return undefined;
}

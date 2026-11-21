export const TAIWAN_PHONE_ERROR = "電話格式不正確，請用 09xxxxxxxx 或 0X-XXXXXXX";

/** Mobile is 09 plus 8 digits. Landline is 0, one area digit, a hyphen, then 7 or 8 digits. */
export function isTaiwanPhone(value: string): boolean {
  const phone = value.trim();
  return /^09\d{8}$/.test(phone) || /^0\d-\d{7,8}$/.test(phone);
}

export type PhonePopup = { kind: "popup"; message: string } | { kind: "none" };

/**
 * Invalid phones on 登記訂單 are a popup, not an inline warning.
 * The popup opens when the user tries to submit or leaves the field.
 * Typing (change) stays quiet. Empty is not a format error (the field is required).
 */
export function phonePopupOn(event: "blur" | "submit" | "change", value: string): PhonePopup {
  if (event === "change") return { kind: "none" };
  const phone = value.trim();
  if (phone === "" || isTaiwanPhone(phone)) return { kind: "none" };
  return { kind: "popup", message: TAIWAN_PHONE_ERROR };
}

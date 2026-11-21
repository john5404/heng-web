export const TAIWAN_PHONE_ERROR = "電話格式不正確，請用 09xxxxxxxx 或 0X-XXXXXXX";

/** Mobile is 09 plus 8 digits. Landline is 0, one area digit, a hyphen, then 7 or 8 digits. */
export function isTaiwanPhone(value: string): boolean {
  const phone = value.trim();
  return /^09\d{8}$/.test(phone) || /^0\d-\d{7,8}$/.test(phone);
}

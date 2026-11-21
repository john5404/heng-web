import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PhoneFormatDialog } from "../src/components/PhoneFormatDialog";
import { isTaiwanPhone, phonePopupOn, TAIWAN_PHONE_ERROR } from "../src/lib/phone";

describe("Taiwan phone", () => {
  it("accepts a mobile number and a landline with a hyphen", () => {
    expect(isTaiwanPhone("0912345678")).toBe(true);
    expect(isTaiwanPhone("02-2345678")).toBe(true);
    expect(isTaiwanPhone("02-23456789")).toBe(true);
  });

  it("rejects numbers that are not those formats", () => {
    expect(isTaiwanPhone("912345678")).toBe(false);
    expect(isTaiwanPhone("091234567")).toBe(false);
    expect(isTaiwanPhone("0912-345678")).toBe(false);
    expect(isTaiwanPhone("022345678")).toBe(false);
    expect(isTaiwanPhone("02-234567")).toBe(false);
    expect(isTaiwanPhone("")).toBe(false);
  });

  it("opens a popup for an invalid phone on submit or blur, and stays quiet while typing or when the number is valid", () => {
    const popup = { kind: "popup", message: TAIWAN_PHONE_ERROR };
    expect(phonePopupOn("submit", "12345")).toEqual(popup);
    expect(phonePopupOn("blur", "12345")).toEqual(popup);
    expect(phonePopupOn("submit", "022345678")).toEqual(popup);
    expect(phonePopupOn("change", "12345")).toEqual({ kind: "none" });
    expect(phonePopupOn("blur", "0912345678")).toEqual({ kind: "none" });
    expect(phonePopupOn("submit", "02-2345678")).toEqual({ kind: "none" });
    expect(phonePopupOn("blur", "")).toEqual({ kind: "none" });
    expect(phonePopupOn("submit", "")).toEqual({ kind: "none" });
  });

  it("renders the phone warning as a dismissible modal dialog, not an inline alert", () => {
    const html = renderToStaticMarkup(
      createElement(PhoneFormatDialog, { message: TAIWAN_PHONE_ERROR, onDismiss: () => {} }),
    );
    expect(html).toContain("<dialog");
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain(TAIWAN_PHONE_ERROR);
    expect(html).toContain("確定");
    expect(html).toContain('type="button"');
    expect(html).not.toContain('role="alert"');
  });
});

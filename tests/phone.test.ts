import { describe, expect, it } from "vitest";
import { isTaiwanPhone } from "../src/lib/phone";

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
});

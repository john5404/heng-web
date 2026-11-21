import { describe, expect, it } from "vitest";
import { isPaidInFull, remainingAmount } from "../src/lib/money";

describe("remainingAmount", () => {
  it("is price minus amount paid", () => {
    expect(remainingAmount(10000, 2000)).toBe(8000);
  });
});

describe("isPaidInFull", () => {
  it("is true when paid equals price", () => {
    expect(isPaidInFull(10000, 10000)).toBe(true);
  });

  it("is false when paid is less than price", () => {
    expect(isPaidInFull(6600, 2000)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { isPaidInFull, orderTotal, remainingAmount } from "../src/lib/money";

describe("orderTotal", () => {
  it("adds the set price to each 單點 price times quantity", () => {
    expect(orderTotal(0, [])).toBe(0);
    expect(orderTotal(8000, [{ price: 1700, quantity: 2 }, { price: 0, quantity: 1 }])).toBe(11400);
    expect(orderTotal(0, [{ price: 1700, quantity: 1 }])).toBe(1700);
  });
});

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

  it("is true when paid is more than the total", () => {
    expect(isPaidInFull(1700, 2000)).toBe(true);
  });
});

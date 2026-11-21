import { describe, expect, it } from "vitest";
import { ordersMatchingTier, priceTierCounts } from "../src/lib/orders";

describe("floor price tiers", () => {
  it("counts orders in the selected slots by 年菜價格", () => {
    const counts = priceTierCounts([
      { menu_set_name: "八千套餐", price: 8000 },
      { menu_set_name: "萬元套餐", price: 10000 },
      { menu_set_name: "八千套餐", price: 8000 },
      { menu_set_name: "六千六套餐", price: 6600 },
      { menu_set_name: null, price: 5000 },
    ]);
    expect(counts).toEqual([
      { name: "萬元套餐", price: 10000, count: 1 },
      { name: "八千套餐", price: 8000, count: 2 },
      { name: "六千六套餐", price: 6600, count: 1 },
      { name: "未選套餐", price: 5000, count: 1 },
    ]);
  });

  it("keeps every guest or only one 年菜價格", () => {
    const orders = [
      { id: "a", menu_set_name: "萬元套餐" },
      { id: "b", menu_set_name: "八千套餐" },
      { id: "c", menu_set_name: "萬元套餐" },
    ];
    expect(ordersMatchingTier(orders, null).map((order) => order.id)).toEqual(["a", "b", "c"]);
    expect(ordersMatchingTier(orders, "萬元套餐").map((order) => order.id)).toEqual(["a", "c"]);
  });
});

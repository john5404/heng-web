import { describe, expect, it } from "vitest";
import { priceTierCounts } from "../src/lib/orders";

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
});

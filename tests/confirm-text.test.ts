import { describe, expect, it } from "vitest";
import { confirmAddonDelete, confirmLineRemove, confirmOrderDelete, confirmSlotDelete } from "../src/lib/confirm-text";

describe("delete confirmation text", () => {
  it("names the order, the 單點 line, and the time slot", () => {
    expect(confirmOrderDelete("陳雅婷", "2027-02-05 下午兩點")).toBe("確定刪除訂單 陳雅婷（2027-02-05 下午兩點）？");
    expect(confirmAddonDelete("上湯魚翅羹", "陳雅婷")).toBe("確定刪除加購 上湯魚翅羹（陳雅婷）？");
    expect(confirmLineRemove("上湯魚翅羹")).toBe("確定移除單點 上湯魚翅羹？");
    expect(confirmSlotDelete("2027-02-05", "外帶", "下午兩點")).toBe("確定刪除時段 2027-02-05 外帶 下午兩點？");
  });
});

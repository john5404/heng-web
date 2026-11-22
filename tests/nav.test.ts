import { describe, expect, it } from "vitest";
import { navLinks } from "../src/lib/nav";

describe("nav links", () => {
  it("shows every settings screen to admin and the main screens to pickup and viewer", () => {
    const admin = navLinks("admin");
    expect(admin.map((link) => link.label)).toEqual([
      "登記訂單",
      "訂單管理",
      "外場",
      "廚房",
      "菜項",
      "時段",
      "帳號",
      "操作紀錄",
    ]);
    expect(admin.filter((link) => link.group === "settings")).toHaveLength(4);

    for (const role of ["pickup", "viewer"] as const) {
      const links = navLinks(role);
      expect(links.map((link) => link.label)).toEqual(["登記訂單", "訂單管理", "外場", "廚房"]);
      expect(links.some((link) => link.group === "settings")).toBe(false);
    }
  });
});

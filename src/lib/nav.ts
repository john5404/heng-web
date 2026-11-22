export type Role = "admin" | "pickup" | "viewer";

export type NavLink = {
  href: string;
  label: string;
  group: "main" | "settings";
};

const MAIN: NavLink[] = [
  { href: "/register", label: "登記訂單", group: "main" },
  { href: "/orders", label: "訂單管理", group: "main" },
  { href: "/floor", label: "外場", group: "main" },
  { href: "/kitchen", label: "廚房", group: "main" },
];

const SETTINGS: NavLink[] = [
  { href: "/settings/menu", label: "菜項", group: "settings" },
  { href: "/settings/slots", label: "時段", group: "settings" },
  { href: "/settings/users", label: "帳號", group: "settings" },
  { href: "/settings/audit", label: "操作紀錄", group: "settings" },
];

/** Admin sees every settings screen. Pickup and viewer see the main screens, including 訂單管理, but not settings. */
export function navLinks(role: Role): NavLink[] {
  if (role === "admin") return [...MAIN, ...SETTINGS];
  return MAIN;
}

"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { navLinks, type Role } from "@/lib/nav";

const ROLE_LABEL: Record<Role, string> = {
  admin: "管理",
  pickup: "領餐",
  viewer: "查看",
};

function isRole(value: unknown): value is Role {
  return value === "admin" || value === "pickup" || value === "viewer";
}

export function AppNav() {
  const pathname = usePathname();
  const [role, setRole] = useState<Role | null>(null);
  const [username, setUsername] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/auth/me");
      if (!response.ok) {
        if (!cancelled) {
          setRole(null);
          setUsername("");
        }
        return;
      }
      const data = (await response.json()) as { role?: unknown; username?: unknown };
      if (cancelled) return;
      setRole(isRole(data.role) ? data.role : null);
      setUsername(typeof data.username === "string" ? data.username : "");
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (!role) return null;

  const links = navLinks(role);
  const main = links.filter((link) => link.group === "main");
  const settings = links.filter((link) => link.group === "settings");

  function current(href: string): "page" | undefined {
    if (href === "/") return pathname === "/" ? "page" : undefined;
    return pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined;
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <nav className="app-nav" aria-label="主要">
      <a className="app-nav-brand" href="/">
        漢滄年菜
      </a>
      {main.map((link) => (
        <a key={link.href} href={link.href} aria-current={current(link.href)}>
          {link.label}
        </a>
      ))}
      {settings.length > 0 ? (
        <span className="app-nav-group">
          <span className="app-nav-label">設定</span>
          {settings.map((link) => (
            <a key={link.href} href={link.href} aria-current={current(link.href)}>
              {link.label}
            </a>
          ))}
        </span>
      ) : null}
      <span className="app-nav-spacer" />
      <span className="app-nav-who">
        {username}・{ROLE_LABEL[role]}
      </span>
      <button type="button" onClick={() => void logout()}>
        登出
      </button>
    </nav>
  );
}

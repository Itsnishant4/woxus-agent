"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "./ThemeProvider";
import { useState } from "react";
import {
  IconDashboard,
  IconKey,
  IconUsers,
  IconStar,
  IconBug,
  IconCreditCard,
  IconSettings,
  IconSun,
  IconMoon,
  IconLogOut,
  IconChevronLeft,
  IconChevronRight,
} from "./icons";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: IconDashboard },
  { href: "/licenses", label: "Licenses", icon: IconKey },
  { href: "/users", label: "Users", icon: IconUsers },
  { href: "/feedback", label: "Feedback", icon: IconStar },
  { href: "/bugs", label: "Bugs", icon: IconBug },
  { href: "/purchases", label: "Purchases", icon: IconCreditCard },
  { href: "/settings", label: "Settings", icon: IconSettings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [collapsed, setCollapsed] = useState(false);

  if (pathname === "/login") return null;

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  return (
    <aside
      className={`flex flex-col border-r border-border bg-sidebar shrink-0 transition-[width] duration-200 ${
        collapsed ? "w-16" : "w-60"
      }`}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 h-14 px-4 border-b border-border">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-sm">
          <span className="text-[11px] font-bold text-white">W</span>
        </div>
        {!collapsed && (
          <div className="leading-tight">
            <p className="text-sm font-semibold">Woxus Admin</p>
            <p className="text-[10px] text-muted-foreground">Control panel</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        <p
          className={`px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 ${
            collapsed ? "text-center px-0" : ""
          }`}
        >
          {collapsed ? "…" : "Overview"}
        </p>
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <div key={href} className="group relative">
              <Link
                href={href}
                className={`flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                  active
                    ? "bg-accent text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                } ${collapsed ? "justify-center px-0" : ""}`}
              >
                <Icon className="shrink-0" />
                {!collapsed && label}
                {active && !collapsed && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-violet-500" />
                )}
              </Link>
              {collapsed && (
                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 rounded-md bg-popover text-popover-foreground text-xs shadow-md border border-border whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity z-50">
                  {label}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer actions */}
      <div className="border-t border-border p-2 flex flex-col gap-1">
        <button
          onClick={toggle}
          title={theme === "dark" ? "Switch to light" : "Switch to dark"}
          className={`flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/60 w-full text-left ${
            collapsed ? "justify-center px-0" : ""
          }`}
        >
          {theme === "dark" ? <IconSun /> : <IconMoon />}
          {!collapsed && <span className="text-xs">{theme === "dark" ? "Light" : "Dark"}</span>}
        </button>

        <button
          onClick={handleLogout}
          className={`flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/60 w-full text-left ${
            collapsed ? "justify-center px-0" : ""
          }`}
        >
          <IconLogOut />
          {!collapsed && <span className="text-xs">Logout</span>}
        </button>

        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/60 w-full text-left ${
            collapsed ? "justify-center px-0" : ""
          }`}
        >
          {collapsed ? <IconChevronRight /> : <IconChevronLeft />}
          {!collapsed && <span className="text-xs">Collapse</span>}
        </button>
      </div>
    </aside>
  );
}

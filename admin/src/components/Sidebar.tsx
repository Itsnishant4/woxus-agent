"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button, Separator } from "@heroui/react";
import { useTheme } from "./ThemeProvider";
import { useState } from "react";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/licenses", label: "Licenses" },
  { href: "/users", label: "Users" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const [collapsed, setCollapsed] = useState(false);

  if (pathname === "/login") return null;

  return (
    <aside
      className={`flex flex-col border-r border-border bg-sidebar shrink-0 transition-all duration-200 ${
        collapsed ? "w-14" : "w-56"
      }`}
    >
      <div className="flex items-center gap-3 h-14 px-3 border-b border-border">
        <div className="w-7 h-7 rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0">
          <span className="text-[10px] font-bold text-white">W</span>
        </div>
        {!collapsed && (
          <span className="text-sm font-semibold">Woxus Admin</span>
        )}
      </div>

      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {navItems.map(({ href, label }) => (
          <div key={href} className="group relative">
            <Link
              href={href}
              className={`flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                pathname === href
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              }`}
            >
              <span className="w-4 shrink-0 text-center text-xs">
                {href === "/dashboard" && "◉"}
                {href === "/licenses" && "⚿"}
                {href === "/users" && "⊛"}
              </span>
              {!collapsed && label}
            </Link>
            {collapsed && (
              <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1.5 rounded-md bg-popover text-popover-foreground text-xs shadow-md border border-border whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 z-50">
                {label}
              </div>
            )}
          </div>
        ))}
      </nav>

      <Separator />

      <div className="p-2 flex flex-col gap-1">
        <Button
          variant="ghost"
          size="sm"
          isIconOnly={collapsed}
          className={`${!collapsed ? "justify-start gap-3 px-2.5" : ""} text-muted-foreground hover:text-foreground`}
          onClick={toggle}
        >
          <span className="shrink-0">{theme === "dark" ? "☀️" : "🌙"}</span>
          {!collapsed && (
            <span className="text-xs">{theme === "dark" ? "Light" : "Dark"}</span>
          )}
        </Button>

        {!collapsed && (
          <Link href="/login">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-3 px-2.5 text-muted-foreground hover:text-foreground"
            >
              <span className="shrink-0">↩</span>
              <span className="text-xs">Logout</span>
            </Button>
          </Link>
        )}

        <div className="group relative">
          <Button
            variant="ghost"
            size="sm"
            isIconOnly={collapsed}
            className={`${!collapsed ? "justify-start gap-3 px-2.5" : ""} text-muted-foreground hover:text-foreground`}
            onClick={() => setCollapsed(!collapsed)}
          >
            <span className="shrink-0">{collapsed ? "→" : "←"}</span>
            {!collapsed && <span className="text-xs">Collapse</span>}
          </Button>
          {collapsed && (
            <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1.5 rounded-md bg-popover text-popover-foreground text-xs shadow-md border border-border whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 z-50">
              Expand
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "./ThemeProvider";
import { useState } from "react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: "◉" },
  { href: "/licenses", label: "Licenses", icon: "⚿" },
  { href: "/users", label: "Users", icon: "⊛" },
  { href: "/feedback", label: "Feedback", icon: "★" },
  { href: "/purchases", label: "Purchases", icon: "$" },
  { href: "/settings", label: "Settings", icon: "⚙" },
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
      className={`flex flex-col border-r border-border bg-sidebar shrink-0 transition-all duration-200 ${
        collapsed ? "w-14" : "w-56"
      }`}
    >
      <div className="flex items-center gap-3 h-14 px-3 border-b border-border">
        <div className="w-7 h-7 rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0">
          <span className="text-[10px] font-bold text-white">W</span>
        </div>
        {!collapsed && <span className="text-sm font-semibold">Woxus Admin</span>}
      </div>

      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {navItems.map(({ href, label, icon }) => (
          <div key={href} className="group relative">
            <Link
              href={href}
              className={`flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                pathname === href
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              }`}
            >
              <span className="w-4 shrink-0 text-center text-xs">{icon}</span>
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

      <div className="border-t border-border" />

      <div className="p-2 flex flex-col gap-1">
        <button
          onClick={toggle}
          className={`flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/50 w-full text-left ${collapsed ? "justify-center" : ""}`}
        >
          <span className="shrink-0">{theme === "dark" ? "☀️" : "🌙"}</span>
          {!collapsed && <span className="text-xs">{theme === "dark" ? "Light" : "Dark"}</span>}
        </button>

        {!collapsed && (
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/50 w-full text-left"
          >
            <span className="shrink-0">↩</span>
            <span className="text-xs">Logout</span>
          </button>
        )}

        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/50 w-full text-left ${collapsed ? "justify-center" : ""}`}
        >
          <span className="shrink-0">{collapsed ? "→" : "←"}</span>
          {!collapsed && <span className="text-xs">Collapse</span>}
        </button>
      </div>
    </aside>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@heroui/react";

interface User {
  _id: string;
  hardwareId: string;
  deviceInfo?: string;
  blocked: boolean;
  trialActive: boolean;
  trialDurationSeconds: number;
  totalSessions: number;
  lastActiveAt?: string;
  licenseKey?: string;
  createdAt: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");

  const fetchUsers = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: "20" });
    if (q) params.set("q", q);
    const res = await fetch(`/api/users?${params}`);
    const data = await res.json();
    setUsers(data.users);
    setTotal(data.total);
  }, [page, q]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const toggleBlock = async (hardwareId: string, blocked: boolean) => {
    await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hardwareId, blocked: !blocked }),
    });
    fetchUsers();
  };

  const pages = Math.ceil(total / 20);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Users</h1>
        <p className="text-sm text-muted-foreground mt-1">{total} registered users</p>
      </div>

      <input placeholder="Search by hardware ID, device, or license..." value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="w-full max-w-sm px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />

      <Card className="border-border/60 shadow-sm">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">HARDWARE ID</th>
                <th className="px-4 py-3 font-medium">DEVICE</th>
                <th className="px-4 py-3 font-medium">STATUS</th>
                <th className="px-4 py-3 font-medium">TRIAL</th>
                <th className="px-4 py-3 font-medium">SESSIONS</th>
                <th className="px-4 py-3 font-medium">LICENSE</th>
                <th className="px-4 py-3 font-medium">LAST ACTIVE</th>
                <th className="px-4 py-3 font-medium">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">No users found</td></tr>
              )}
              {users.map((u) => (
                <tr key={u._id} className="border-b border-border/50 hover:bg-accent/30">
                  <td className="px-4 py-3"><code className="text-xs">{u.hardwareId.slice(0, 20)}...</code></td>
                  <td className="px-4 py-3 text-xs text-muted-foreground max-w-[120px] truncate">{u.deviceInfo || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${u.blocked ? "bg-red-500/10 text-red-500" : "bg-green-500/10 text-green-500"}`}>
                      {u.blocked ? "Blocked" : "Active"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs ${u.trialActive ? "text-amber-500" : "text-muted-foreground"}`}>
                      {u.trialActive ? `${u.trialDurationSeconds}s` : "Expired"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{u.totalSessions}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{u.licenseKey ? "✓" : "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleBlock(u.hardwareId, u.blocked)}
                      className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                        u.blocked
                          ? "bg-green-500/10 text-green-500 hover:bg-green-500/20"
                          : "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                      }`}
                    >
                      {u.blocked ? "Unblock" : "Block"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {pages > 1 && (
        <div className="flex gap-2 items-center text-sm text-muted-foreground">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 rounded-md bg-accent/50 hover:bg-accent disabled:opacity-40 transition-colors">Prev</button>
          <span>Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 rounded-md bg-accent/50 hover:bg-accent disabled:opacity-40 transition-colors">Next</button>
        </div>
      )}
    </div>
  );
}

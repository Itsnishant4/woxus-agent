"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@heroui/react";

interface Analytics {
  users: { total: number; active24h: number; newThisMonth: number; newLast7Days: number; newLast30Days: number };
  licenses: { total: number; active: number; revoked: number };
  feedback: { total: number; avgRating: number };
  purchases: { total: number; completed: number; revenue: number };
}

export default function DashboardPage() {
  const [data, setData] = useState<Analytics | null>(null);

  useEffect(() => {
    fetch("/api/analytics")
      .then((r) => r.json())
      .then(setData)
      .catch(console.error);
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Woxus admin overview</p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Active Licenses" value={String(data?.licenses.active ?? "—")} />
        <StatCard label="Registered Users" value={String(data?.users.total ?? "—")} />
        <StatCard label="Active Today" value={String(data?.users.active24h ?? "—")} />
        <StatCard label="Revenue" value={`$${data?.purchases.revenue.toFixed(2) ?? "0.00"}`} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="border-border/60 shadow-sm">
          <CardHeader><CardTitle className="text-xs text-muted-foreground font-normal">Users This Month</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{data?.users.newThisMonth ?? "—"}</p></CardContent>
        </Card>
        <Card className="border-border/60 shadow-sm">
          <CardHeader><CardTitle className="text-xs text-muted-foreground font-normal">Avg Feedback Rating</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{data?.feedback.avgRating ? `${data.feedback.avgRating}/5` : "—"}</p></CardContent>
        </Card>
        <Card className="border-border/60 shadow-sm">
          <CardHeader><CardTitle className="text-xs text-muted-foreground font-normal">Completed Purchases</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{data?.purchases.completed ?? "—"}</p></CardContent>
        </Card>
      </div>

      <Card className="border-border/60 shadow-sm">
        <CardHeader><CardTitle className="text-sm">Quick Stats</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>Total licenses: {data?.licenses.total ?? "—"} ({data?.licenses.revoked ?? 0} revoked)</p>
          <p>New users (7d): {data?.users.newLast7Days ?? "—"} | (30d): {data?.users.newLast30Days ?? "—"}</p>
          <p>Total feedback: {data?.feedback.total ?? "—"} | Purchases: {data?.purchases.total ?? "—"}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="pb-1">
        <CardTitle className="text-xs text-muted-foreground font-normal">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

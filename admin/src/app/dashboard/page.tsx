"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@heroui/react";
import { StatCard, PageLoader, Pill } from "@/components/ui";
import { BarChart, SplitBar, VIO, TEAL } from "@/components/charts";
import { IconKey, IconUsers, IconActivity, IconCreditCard, IconStar } from "@/components/icons";

interface Analytics {
  users: { total: number; active24h: number; newThisMonth: number; newLast7Days: number; newLast30Days: number };
  licenses: { total: number; active: number; revoked: number };
  feedback: { total: number; avgRating: number };
  purchases: { total: number; completed: number; revenue: number };
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="pb-2">
        <div>
          <CardTitle className="text-sm">{title}</CardTitle>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<Analytics | null>(null);

  useEffect(() => {
    fetch("/api/analytics")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }, []);

  if (!data) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
        <PageLoader label="Loading analytics…" />
      </div>
    );
  }

  const userBars = [
    { label: "Total", value: data.users.total },
    { label: "Active", value: data.users.active24h },
    { label: "New 30d", value: data.users.newLast30Days },
    { label: "New 7d", value: data.users.newLast7Days },
    { label: "Month", value: data.users.newThisMonth },
  ];

  const purchaseBars = [
    { label: "Total", value: data.purchases.total },
    { label: "Completed", value: data.purchases.completed },
  ];

  const conversion = data.purchases.total
    ? Math.round((data.purchases.completed / data.purchases.total) * 100)
    : 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Woxus admin overview</p>
        </div>
        <Pill tone="success">Live</Pill>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<IconKey />}
          label="Active Licenses"
          value={data.licenses.active}
          sub={`${data.licenses.total} total · ${data.licenses.revoked} revoked`}
          accent="text-violet-400"
        />
        <StatCard
          icon={<IconUsers />}
          label="Registered Users"
          value={data.users.total}
          sub={`${data.users.newLast30Days} in last 30 days`}
          accent="text-sky-400"
        />
        <StatCard
          icon={<IconActivity />}
          label="Active Today"
          value={data.users.active24h}
          sub="24h window"
          accent="text-emerald-400"
        />
        <StatCard
          icon={<IconCreditCard />}
          label="Revenue"
          value={`$${data.purchases.revenue.toFixed(2)}`}
          sub={`${conversion}% conversion`}
          accent="text-amber-400"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Users" subtitle="Total, active and new-user growth">
          <BarChart data={userBars} color={VIO} />
        </Section>

        <Section title="Licenses" subtitle="Active vs revoked">
          <SplitBar
            parts={[
              { label: "Active", value: data.licenses.active, color: TEAL },
              { label: "Revoked", value: data.licenses.revoked, color: "#f43f5e" },
            ]}
          />
        </Section>

        <Section title="Purchases" subtitle="Total vs completed orders">
          <BarChart data={purchaseBars} color={TEAL} />
          <p className="mt-3 text-xs text-muted-foreground">
            Revenue: <b className="text-foreground">${data.purchases.revenue.toFixed(2)}</b>
          </p>
        </Section>

        <Section title="Feedback" subtitle="Average user rating">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <IconStar className="text-amber-400" width={26} height={26} />
              <div>
                <p className="text-3xl font-semibold">
                  {data.feedback.avgRating ? data.feedback.avgRating.toFixed(1) : "—"}
                  <span className="text-base text-muted-foreground">/5</span>
                </p>
                <p className="text-xs text-muted-foreground">{data.feedback.total} responses</p>
              </div>
            </div>
          </div>
          <div className="mt-4 h-2 w-full rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-amber-500 to-violet-500"
              style={{ width: `${Math.min(100, (data.feedback.avgRating / 5) * 100)}%` }}
            />
          </div>
        </Section>
      </div>
    </div>
  );
}

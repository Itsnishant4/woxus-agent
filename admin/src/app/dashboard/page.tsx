import { Card, CardHeader, CardTitle, CardContent } from "@heroui/react";

export default function DashboardPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Woxus admin overview
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Active Licenses" value="0" />
        <StatCard label="Registered Users" value="0" />
        <StatCard label="Active Sessions" value="0" />
        <StatCard label="Revenue" value="$0.00" />
      </div>

      <Card className="border-border/60 shadow-sm">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Usage charts and detailed analytics coming in Phase 7.
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="pb-1">
        <CardTitle className="text-xs text-muted-foreground font-normal">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

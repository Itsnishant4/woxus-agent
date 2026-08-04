"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@heroui/react";
import { TableSkeleton, EmptyState } from "@/components/ui";
import { IconCreditCard } from "@/components/icons";

interface Purchase {
  _id: string;
  email: string;
  hardwareId?: string;
  licenseKey?: string;
  amount: number;
  currency: string;
  provider: string;
  providerTxId?: string;
  status: string;
  createdAt: string;
}

export default function PurchasesPage() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/purchase")
      .then((r) => r.json())
      .then((d) => setPurchases(d.purchases))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const statusColor: Record<string, string> = {
    completed: "bg-green-500/10 text-green-500",
    pending: "bg-amber-500/10 text-amber-500",
    refunded: "bg-blue-500/10 text-blue-500",
    failed: "bg-red-500/10 text-red-500",
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Purchases</h1>
        <p className="text-sm text-muted-foreground mt-1">{purchases.length} transactions</p>
      </div>

      <Card className="border-border/60 shadow-sm">
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <TableSkeleton rows={6} cols={6} />
          ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">EMAIL</th>
                <th className="px-4 py-3 font-medium">AMOUNT</th>
                <th className="px-4 py-3 font-medium">PROVIDER</th>
                <th className="px-4 py-3 font-medium">STATUS</th>
                <th className="px-4 py-3 font-medium">LICENSE KEY</th>
                <th className="px-4 py-3 font-medium">DATE</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p._id} className="border-b border-border/50 hover:bg-accent/30">
                  <td className="px-4 py-3 text-xs">{p.email}</td>
                  <td className="px-4 py-3 text-xs">{p.currency} {p.amount.toFixed(2)}</td>
                  <td className="px-4 py-3 text-xs capitalize">{p.provider}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[p.status] || ""}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3"><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{p.licenseKey || "—"}</code></td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
          {!loading && purchases.length === 0 && (
            <EmptyState icon={<IconCreditCard />} title="No purchases yet" sub="Completed transactions will appear here." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

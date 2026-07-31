"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, Button } from "@heroui/react";

interface License {
  _id: string;
  key: string;
  hardwareIds: string[];
  expiry: string | null;
  revoked: boolean;
  maxActivations: number;
  activationCount: number;
  createdAt: string;
}

export default function LicensesPage() {
  const [licenses, setLicenses] = useState<License[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [showGenerate, setShowGenerate] = useState(false);
  const [genExpiry, setGenExpiry] = useState("365");
  const [genMaxAct, setGenMaxAct] = useState("1");
 
  const fetchLicenses = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: "20" });
    if (q) params.set("q", q);
    const res = await fetch(`/api/licenses?${params}`);
    const data = await res.json();
    setLicenses(data.licenses);
    setTotal(data.total);
  }, [page, q]);

  useEffect(() => { fetchLicenses(); }, [fetchLicenses]);

  const generate = async () => {
    await fetch("/api/licenses/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiryDays: parseInt(genExpiry), maxActivations: 1 }),
    });
    setShowGenerate(false);
    fetchLicenses();
  };

  const toggleRevoke = async (key: string, revoked: boolean) => {
    await fetch("/api/licenses/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, revoked: !revoked }),
    });
    fetchLicenses();
  };

  const pages = Math.ceil(total / 20);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Licenses</h1>
          <p className="text-sm text-muted-foreground mt-1">{total} total keys</p>
        </div>
        <Button variant="primary" size="sm" onPress={() => setShowGenerate(true)}>+ Generate Key</Button>
      </div>

      <div className="flex gap-2">
        <input placeholder="Search by key or hardware ID..." value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="w-full max-w-sm px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
      </div>

      <Card className="border-border/60 shadow-sm">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">KEY</th>
                <th className="px-4 py-3 font-medium">STATUS</th>
                <th className="px-4 py-3 font-medium">EXPIRY</th>
                <th className="px-4 py-3 font-medium">ACTIVATIONS</th>
                <th className="px-4 py-3 font-medium">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {licenses.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No licenses found</td></tr>
              )}
              {licenses.map((l) => (
                <tr key={l._id} className="border-b border-border/50 hover:bg-accent/30">
                  <td className="px-4 py-3"><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{l.key}</code></td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${l.revoked ? "bg-red-500/10 text-red-500" : "bg-green-500/10 text-green-500"}`}>
                      {l.revoked ? "Revoked" : "Active"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {l.expiry ? new Date(l.expiry).toLocaleDateString() : "No expiry"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{l.activationCount}/{l.maxActivations}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleRevoke(l.key, l.revoked)}
                      className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                        l.revoked
                          ? "bg-green-500/10 text-green-500 hover:bg-green-500/20"
                          : "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                      }`}
                    >
                      {l.revoked ? "Reactivate" : "Revoke"}
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

      {showGenerate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowGenerate(false)}>
          <div className="bg-background border border-border rounded-xl shadow-lg p-6 w-full max-w-sm space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Generate License Key</h2>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Expiry (days)</label>
              <input type="number" value={genExpiry} onChange={(e) => setGenExpiry(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Max activations</label>
              <input type="number" value="1" disabled readOnly className="w-full px-3 py-2 rounded-lg bg-muted border border-border text-sm opacity-70 cursor-not-allowed" />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onPress={() => setShowGenerate(false)}>Cancel</Button>
              <Button variant="primary" onPress={generate}>Generate</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

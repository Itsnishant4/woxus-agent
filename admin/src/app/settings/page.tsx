"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Button } from "@heroui/react";

interface Settings {
  trial_duration_seconds: string;
  price_monthly: string;
  price_yearly: string;
  currency: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({
    trial_duration_seconds: "600",
    price_monthly: "9.99",
    price_yearly: "99.99",
    currency: "INR",
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => setSettings(d.settings))
      .catch(console.error);
  }, []);

  const update = (key: keyof Settings, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    setMsg("");
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trial_duration_seconds: settings.trial_duration_seconds,
        price_monthly: settings.price_monthly,
        price_yearly: settings.price_yearly,
        currency: settings.currency,
      }),
    });

    if (res.ok) setMsg("Saved successfully");
    else {
      const data = await res.json().catch(() => ({}));
      setMsg(data.errors ? Object.values(data.errors).join(", ") : "Failed to save");
    }
    setSaving(false);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure application settings</p>
      </div>

      <Card className="border-border/60 shadow-sm max-w-lg">
        <CardHeader><CardTitle className="text-sm">Trial Duration</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Field label="Trial (seconds)" value={settings.trial_duration_seconds} onChange={(v) => update("trial_duration_seconds", v)} hint="Min: 60, Max: 86400" />
        </CardContent>
      </Card>

      <Card className="border-border/60 shadow-sm max-w-lg">
        <CardHeader><CardTitle className="text-sm">Pricing</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Field label="Monthly price" value={settings.price_monthly} onChange={(v) => update("price_monthly", v)} hint="e.g. 9.99" />
          <Field label="Yearly price" value={settings.price_yearly} onChange={(v) => update("price_yearly", v)} hint="e.g. 99.99" />
          <Field label="Currency" value={settings.currency} onChange={(v) => update("currency", v)} hint="e.g. INR, USD" />
        </CardContent>
      </Card>

      <div className="max-w-lg flex items-center gap-3">
        <Button variant="primary" size="sm" onPress={save} isDisabled={saving}>
          {saving ? "Saving..." : "Save All"}
        </Button>
        {msg && <p className={`text-sm ${msg === "Saved successfully" ? "text-green-500" : "text-red-500"}`}>{msg}</p>}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
      />
      {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

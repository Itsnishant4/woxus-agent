"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open: () => void };
  }
}

interface PricingPlan {
  id: string;
  label: string;
  price: number;
  currency: string;
  period: string;
  popular?: boolean;
}

export default function BuyPageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-950 to-zinc-900"><p className="text-zinc-400 text-sm">Loading...</p></div>}>
      <BuyPage />
    </Suspense>
  );
}

function BuyPage() {
  const searchParams = useSearchParams();
  const urlHardwareId = searchParams.get("hardwareId") || "";
  const urlPlan = searchParams.get("plan") || "";

  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [selected, setSelected] = useState<string>("yearly");
  const [email, setEmail] = useState("");
  const [hardwareId, setHardwareId] = useState("");
  const [hardwareFromApp, setHardwareFromApp] = useState(false);
  const [step, setStep] = useState<"loading" | "plans" | "form" | "processing" | "done">("loading");
  const [licenseKey, setLicenseKey] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setHardwareId(urlHardwareId);
    setHardwareFromApp(!!urlHardwareId);
    if (urlHardwareId) {
      localStorage.setItem("woxus_hardware_id", urlHardwareId);
    }
    setStep("plans");
  }, [urlHardwareId]);

  useEffect(() => {
    fetch("/api/pricing")
      .then((r) => r.json())
      .then((d) => setPlans(d.plans))
      .catch(console.error);
  }, []);

  const selectedPlan = plans.find((p) => p.id === selected);

  const handlePurchase = async () => {
    if (!email) return;
    setError("");
    setStep("processing");

    const finalHwid = hardwareId || "web-" + Date.now();

    try {
      const amountInPaise = Math.round((selectedPlan?.price || 0) * 100);
      const orderRes = await fetch("/api/purchase/razorpay-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, hardwareId: finalHwid, amountInPaise }),
      });
      const order = await orderRes.json();

      if (!window.Razorpay) {
        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }

      const rzp = new (window as any).Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: "Woxus AI",
        description: `${selectedPlan?.label} Plan`,
        order_id: order.orderId,
        handler: async (response: any) => {
          const verifyRes = await fetch("/api/purchase/razorpay-verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              email,
              hardwareId: finalHwid,
            }),
          });
          const verifyData = await verifyRes.json();
          if (verifyData.success) {
            setLicenseKey(verifyData.licenseKey);
            setStep("done");
            localStorage.setItem("woxus_hardware_id", finalHwid);
          } else {
            setError("Payment verification failed");
            setStep("form");
          }
        },
        modal: {
          ondismiss: () => setStep("form"),
        },
      });
      rzp.open();
    } catch (e) {
      setError("Something went wrong. Please try again.");
      setStep("form");
    }
  };

  if (step === "done") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-950 to-zinc-900 p-6">
        <div className="max-w-md w-full bg-zinc-900/60 border border-zinc-800 rounded-2xl p-8 text-center space-y-4">
          <div className="w-14 h-14 mx-auto rounded-full bg-green-500/20 flex items-center justify-center">
            <span className="text-2xl text-green-400">&#10003;</span>
          </div>
          <h1 className="text-xl font-semibold text-white">Purchase Successful!</h1>
          <p className="text-sm text-zinc-400">Your license key:</p>
          <div className="flex items-center gap-2 bg-zinc-800 px-4 py-3 rounded-lg">
            <code className="flex-1 text-lg font-mono text-violet-400 select-all text-center">{licenseKey}</code>
            <button
              onClick={() => { navigator.clipboard.writeText(licenseKey); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              className="shrink-0 px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-all"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            {hardwareFromApp
              ? "This key is already bound to your device. Return to the Woxus app."
              : "Copy this key and enter it in the Woxus desktop app to activate your license."}
          </p>
        </div>
      </div>
    );
  }

  if (step === "loading") {
    return <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-950 to-zinc-900"><p className="text-zinc-400 text-sm">Loading...</p></div>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-950 to-zinc-900 p-6">
      <div className="max-w-3xl w-full space-y-8">
        <div className="text-center space-y-2">
          <div className="w-10 h-10 mx-auto rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
            <span className="text-sm font-bold text-white">W</span>
          </div>
          <h1 className="text-2xl font-semibold text-white">Woxus AI</h1>
          <p className="text-sm text-zinc-400">Choose a plan to activate your license</p>
        </div>

        {step === "plans" && (
          <div className="grid md:grid-cols-2 gap-4">
            {plans.map((plan) => (
              <button
                key={plan.id}
                onClick={() => { setSelected(plan.id); setStep("form"); }}
                className={`relative text-left p-6 rounded-xl border transition-all ${
                  plan.popular
                    ? "border-violet-500 bg-violet-500/10 hover:bg-violet-500/20"
                    : "border-zinc-700 bg-zinc-900/60 hover:bg-zinc-800/60"
                }`}
              >
                {plan.popular && (
                  <span className="absolute -top-2.5 right-4 px-2.5 py-0.5 bg-violet-500 text-white text-xs rounded-full font-medium">
                    Popular
                  </span>
                )}
                <p className="text-sm text-zinc-400">{plan.label}</p>
                <p className="text-3xl font-bold text-white mt-1">
                  {plan.currency === "USD" ? "$" : "\u20B9"}{plan.price}
                  <span className="text-sm font-normal text-zinc-500">/{plan.period}</span>
                </p>
                <p className="text-xs text-zinc-500 mt-2">
                  {plan.id === "yearly" ? "Billed annually. Save ~17% vs monthly." : "Billed monthly. Cancel anytime."}
                </p>
              </button>
            ))}
          </div>
        )}

        {step === "form" && selectedPlan && (
          <div className="max-w-md mx-auto bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">{selectedPlan.label} Plan</h2>
              <p className="text-xl font-bold text-white">{selectedPlan.currency === "USD" ? "$" : "\u20B9"}{selectedPlan.price}</p>
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full px-3 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1">Hardware ID</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={hardwareId}
                  onChange={(e) => setHardwareId(e.target.value)}
                  placeholder="auto-generated on purchase"
                  readOnly={hardwareFromApp}
                  className={`w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 ${
                    hardwareFromApp
                      ? "bg-zinc-700/50 border-zinc-600 text-zinc-300 cursor-not-allowed"
                      : "bg-zinc-800 border-zinc-700 text-white"
                  }`}
                />
                {hardwareFromApp && (
                  <span className="shrink-0 px-2 py-1 rounded text-xs font-medium bg-violet-500/20 text-violet-400 border border-violet-500/30">
                    From App
                  </span>
                )}
              </div>
              {hardwareFromApp && (
                <p className="text-xs text-violet-400/70 mt-1">Locked to your device. License will be bound automatically.</p>
              )}
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <button
              onClick={handlePurchase}
              disabled={!email}
              className="w-full py-2.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-medium hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 transition-all"
            >
              Pay {selectedPlan.currency === "USD" ? "$" : "\u20B9"}{selectedPlan.price}
            </button>

            <button onClick={() => setStep("plans")} className="w-full text-xs text-zinc-500 hover:text-zinc-400">
                &larr; Choose different plan
              </button>
          </div>
        )}

        {step === "processing" && (
          <div className="text-center text-zinc-400 text-sm">Processing...</div>
        )}
      </div>
    </div>
  );
}

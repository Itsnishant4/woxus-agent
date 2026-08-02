import { useEffect, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';

// Admin backend base URL (pricing + Razorpay). Set via VITE_ADMIN_API_URL at build.
// e.g. https://woxus-a.vercel.app
const ADMIN_API = (import.meta.env.VITE_ADMIN_API_URL as string | undefined) || '';

interface PricingPlan {
  id: string;
  label: string;
  price: number;
  currency: string;
  period: string;
  popular?: boolean;
}

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open: () => void };
  }
}

export default function Buy() {
  const { plan } = useParams();
  const [searchParams] = useSearchParams();
  // Accept both spellings: the desktop app links with ?hardware_id=..., other
  // callers may use ?hardwareId=...
  const hardwareIdFromUrl =
    searchParams.get('hardwareId') || searchParams.get('hardware_id') || '';

  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [selected, setSelected] = useState<string>(plan || 'yearly');
  const [email, setEmail] = useState('');
  const [hardwareId, setHardwareId] = useState('');
  const [hardwareFromApp, setHardwareFromApp] = useState(false);
  const [step, setStep] = useState<'loading' | 'plans' | 'form' | 'processing' | 'done'>('loading');
  const [licenseKey, setLicenseKey] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (hardwareIdFromUrl) {
      setHardwareId(hardwareIdFromUrl);
      setHardwareFromApp(true);
    }
    if (plan) setSelected(plan);
    setStep('plans');
  }, [hardwareIdFromUrl, plan]);

  useEffect(() => {
    fetch(`${ADMIN_API}/api/pricing`)
      .then((r) => r.json())
      .then((d) => {
        setPlans(d.plans || []);
      })
      .catch(() => setError('Could not load pricing.'));
  }, []);

  const selectedPlan = plans.find((p) => p.id === selected);

  const handlePurchase = async () => {
    if (!email) return;
    setError('');
    setStep('processing');

    const finalHwid = hardwareId || 'web-' + Date.now();

    try {
      const amountInPaise = Math.round((selectedPlan?.price || 0) * 100);
      const orderRes = await fetch(`${ADMIN_API}/api/purchase/razorpay-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, hardwareId: finalHwid, amountInPaise }),
      });
      const order = await orderRes.json();

      if (!window.Razorpay) {
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        await new Promise<void>((resolve, reject) => {
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Razorpay failed to load'));
          document.head.appendChild(script);
        });
      }

      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: 'Woxus AI',
        description: `${selectedPlan?.label} Plan`,
        order_id: order.orderId,
        handler: async (response: any) => {
          const verifyRes = await fetch(`${ADMIN_API}/api/purchase/razorpay-verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
            setStep('done');
            localStorage.setItem('woxus_hardware_id', finalHwid);
          } else {
            setError('Payment verification failed');
            setStep('form');
          }
        },
        modal: {
          ondismiss: () => setStep('form'),
        },
      });
      rzp.open();
    } catch (e) {
      setError('Something went wrong. Please try again.');
      setStep('form');
    }
  };

  if (step === 'done') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-white p-6">
        <div className="max-w-md w-full bg-zinc-900/60 border border-zinc-800 rounded-2xl p-8 text-center space-y-4">
          <div className="w-14 h-14 mx-auto rounded-full bg-green-500/20 flex items-center justify-center">
            <span className="text-2xl text-green-400">✓</span>
          </div>
          <h1 className="text-xl font-semibold">Purchase Successful!</h1>
          <p className="text-sm text-zinc-400">Your license key:</p>
          <div className="flex items-center gap-2 bg-zinc-800 px-4 py-3 rounded-lg">
            <code className="flex-1 text-lg font-mono text-violet-400 select-all text-center">{licenseKey}</code>
            <button
              onClick={() => { navigator.clipboard.writeText(licenseKey); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              className="shrink-0 px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-all"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            {hardwareFromApp
              ? 'This key is already bound to your device. Return to the Woxus app.'
              : 'Copy this key and enter it in the Woxus desktop app to activate your license.'}
          </p>
          <Link to="/" className="inline-block text-sm text-zinc-500 hover:text-zinc-400">← Back to home</Link>
        </div>
      </div>
    );
  }

  if (step === 'loading') {
    return <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-400 text-sm">Loading...</div>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-white p-6">
      <div className="max-w-3xl w-full space-y-8">
        <div className="text-center space-y-2">
          <div className="w-10 h-10 mx-auto rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
            <span className="text-sm font-bold">W</span>
          </div>
          <h1 className="text-2xl font-semibold">Woxus AI</h1>
          <p className="text-sm text-zinc-400">Choose a plan to activate your license</p>
        </div>

        {step === 'plans' && (
          <div className="grid md:grid-cols-2 gap-4">
            {plans.map((p) => (
              <button
                key={p.id}
                onClick={() => { setSelected(p.id); setStep('form'); }}
                className={`relative text-left p-6 rounded-xl border transition-all ${
                  p.popular ? 'border-violet-500 bg-violet-500/10 hover:bg-violet-500/20' : 'border-zinc-700 bg-zinc-900/60 hover:bg-zinc-800/60'
                }`}
              >
                {p.popular && (
                  <span className="absolute -top-2.5 right-4 px-2.5 py-0.5 bg-violet-500 text-white text-xs rounded-full font-medium">Popular</span>
                )}
                <p className="text-sm text-zinc-400">{p.label}</p>
                <p className="text-3xl font-bold mt-1">
                  {p.currency === 'USD' ? '$' : '₹'}{p.price}
                  <span className="text-sm font-normal text-zinc-500">/{p.period}</span>
                </p>
                <p className="text-xs text-zinc-500 mt-2">
                  {p.id === 'yearly' ? 'Billed annually. Save ~17% vs monthly.' : 'Billed monthly. Cancel anytime.'}
                </p>
              </button>
            ))}
          </div>
        )}

        {step === 'form' && selectedPlan && (
          <div className="max-w-md mx-auto bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{selectedPlan.label} Plan</h2>
              <p className="text-xl font-bold">{selectedPlan.currency === 'USD' ? '$' : '₹'}{selectedPlan.price}</p>
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
                    hardwareFromApp ? 'bg-zinc-700/50 border-zinc-600 text-zinc-300 cursor-not-allowed' : 'bg-zinc-800 border-zinc-700 text-white'
                  }`}
                />
                {hardwareFromApp && (
                  <span className="shrink-0 px-2 py-1 rounded text-xs font-medium bg-violet-500/20 text-violet-400 border border-violet-500/30">From App</span>
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
              Pay {selectedPlan.currency === 'USD' ? '$' : '₹'}{selectedPlan.price}
            </button>

            <button onClick={() => setStep('plans')} className="w-full text-xs text-zinc-500 hover:text-zinc-400">
              ← Choose different plan
            </button>
          </div>
        )}

        {step === 'processing' && <div className="text-center text-zinc-400 text-sm">Processing...</div>}
      </div>
    </div>
  );
}

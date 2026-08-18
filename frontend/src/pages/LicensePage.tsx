import { useEffect, useState, useCallback, useRef } from "react";
import { Key, Clock, ExternalLink, Star, Send, AlertCircle, CheckCircle, MessageCircle } from "lucide-react";
import { toast } from "@/components/Toast";

const BUY_URL = import.meta.env.VITE_BUY_URL || "https://woxus.vercel.app/buy";

type PageState = "loading" | "unlicensed" | "trial" | "licensed";

interface Props {
  onActivated?: () => void;
}

export default function LicensePage({ onActivated }: Props) {
  const [state, setState] = useState<PageState>("loading");

  const [licenseInput, setLicenseInput] = useState("");
  const [licenseError, setLicenseError] = useState("");
  const [verifying, setVerifying] = useState(false);

  const [trialSec, setTrialSec] = useState(0);
  const [trialTotal, setTrialTotal] = useState(600);
  const [startingTrial, setStartingTrial] = useState(false);
  const [trialEmail, setTrialEmail] = useState("");
  const [trialExpired, setTrialExpired] = useState(false);

  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(() => !!localStorage.getItem("woxus_feedback_submitted"));
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // The buy page needs this device's hardware ID so the purchased license can
  // be bound to THIS machine. getHardwareId() is async (IPC), so the URL is
  // assembled once the ID resolves rather than at module load.
  const [buyUrl, setBuyUrl] = useState(BUY_URL);
  const [hwid, setHwid] = useState("");

  useEffect(() => {
    // @ts-ignore
    window.electronAPI?.getHardwareId?.().then((id: string) => {
      if (!id) return;
      setHwid(id);
      const sep = BUY_URL.includes("?") ? "&" : "?";
      setBuyUrl(`${BUY_URL}${sep}hardware_id=${encodeURIComponent(id)}`);
    });
  }, []);

  const checkStatus = useCallback(async () => {
    // @ts-ignore
    const result = await window.electronAPI?.getLicenseStatus?.();
    if (!result) { 
      if (localStorage.getItem("woxus_trial_expired") === "true") {
        setTrialExpired(true);
      }
      setState("unlicensed"); 
      return; 
    }

    if (result.trialTotal) {
      setTrialTotal(result.trialTotal);
    }

    if (result.status === "licensed") {
      setState("licensed");
      return;
    }

    if (result.status === "trial") {
      setTrialSec(result.trialRemaining || 0);
      setTrialTotal(result.trialTotal || 600);
      setTrialEmail(result.trialEmail || "");
      setState("trial");
      return;
    }

    if (localStorage.getItem("woxus_trial_expired") === "true") {
      setTrialExpired(true);
    }
    setState("unlicensed");
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  useEffect(() => {
    if (state === "trial") {
      intervalRef.current = setInterval(async () => {
        try {
          // @ts-ignore
          const data = await window.electronAPI?.getTrialStatus?.();
          if (!data) return;
          setTrialSec(data.remaining_seconds);
          if (!data.active) {
            setState("unlicensed");
            setTrialExpired(true);
            toast("Your free trial has ended. Purchase a license to continue.", "info");
            if (intervalRef.current) clearInterval(intervalRef.current);
          }
        } catch {
          /* ignore */
        }
      }, 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [state]);

  const handleVerify = async () => {
    if (!licenseInput.trim()) return;
    setVerifying(true);
    setLicenseError("");

    try {
      // @ts-ignore
      const data = await window.electronAPI?.verifyLicense?.(licenseInput.trim());
      if (data?.valid) {
        localStorage.setItem("woxus_license_key", licenseInput.trim());
        localStorage.removeItem("woxus_trial_expired");
        setState("licensed");
        onActivated?.();
      } else {
        setLicenseError(data?.reason || "Invalid license key");
      }
    } catch {
      setLicenseError("Could not reach license server");
    }
    setVerifying(false);
  };

  const handleStartTrial = async () => {
    setStartingTrial(true);
    try {
      // @ts-ignore
      const data = await window.electronAPI?.startTrial?.(trialEmail);
      if (data?.active) {
        setTrialSec(data.remaining_seconds);
        setTrialTotal(data.total_seconds);
        setTrialEmail(data.email || trialEmail);
        setState("trial");
        localStorage.removeItem("woxus_trial_expired");
        onActivated?.();
      } else {
        localStorage.setItem("woxus_trial_expired", "true");
        setTrialExpired(true);
      }
    } catch {
      /* ignore */
    }
    setStartingTrial(false);
  };

  const handleSubmitFeedback = async () => {
    if (feedbackRating === 0) return;
    setFeedbackSubmitting(true);
    localStorage.setItem("woxus_feedback_submitted", "1");
    setFeedbackSent(true);
    try {
      // @ts-ignore
      await window.electronAPI?.submitFeedback?.(feedbackRating, feedbackText);
    } catch {
      /* ignore - card already hidden */
    }
    setFeedbackSubmitting(false);
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const inputCls =
    "w-full px-3.5 py-2.5 rounded-lg border border-border bg-muted/40 text-sm text-foreground placeholder:text-muted-foreground/60 focus:bg-card focus:border-ring focus:ring-2 focus:ring-ring/10 transition-all outline-none";
  const primaryBtnCls =
    "inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium shadow-sm transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shrink-0";
  const cardCls =
    "bg-card border border-border rounded-xl p-6 shadow-sm hover:border-muted-foreground/25 transition-all space-y-4 animate-fade-in";

  if (state === "loading") {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12">
        <div className="bg-card border border-border rounded-xl p-12 text-center shadow-sm">
          <p className="text-sm font-medium text-muted-foreground animate-pulse">Checking license status...</p>
        </div>
      </div>
    );
  }

  if (state === "licensed") {
    return (
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">License</h1>
          <p className="text-sm text-muted-foreground font-medium mt-1">Your license status and details</p>
        </div>
        <div className="h-px bg-border w-full" />
        <div className={cardCls}>
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
              <CheckCircle className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">License Active</h2>
              <p className="text-xs text-muted-foreground font-medium">Your license is valid and active on this device</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (trialExpired) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">License</h1>
          <p className="text-sm text-muted-foreground font-medium mt-1">Your free trial has ended</p>
        </div>
        <div className="h-px bg-border w-full" />
        <div className="bg-card border-2 border-destructive/30 rounded-xl p-6 shadow-sm space-y-5 text-center animate-fade-in">
          <div className="flex flex-col items-center gap-2">
            <div className="w-12 h-12 rounded-full bg-destructive/10 border border-destructive/20 flex items-center justify-center text-destructive">
              <AlertCircle className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-bold text-foreground">Free Trial Expired</h2>
            <p className="text-sm text-muted-foreground max-w-sm">Your {Math.round(trialTotal / 60)}-minute trial has finished. Purchase a license to continue using Woxus.</p>
          </div>
          <a
            href={buyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={primaryBtnCls}
          >
            <ExternalLink className="h-4 w-4" />
            Buy License Key
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">License</h1>
        <p className="text-sm text-muted-foreground font-medium mt-1">Activate Woxus with a license key or start a free trial</p>
      </div>
      <div className="h-px bg-border w-full" />

      {state === "trial" && (
        <div className={cardCls}>
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Free Trial Active</h2>
              <p className="text-xs text-muted-foreground font-medium">
                {trialEmail ? `Trial registered for ${trialEmail}` : `${Math.round(trialTotal / 60)}-minute trial access in progress`}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-center gap-3 pt-2">
            <div className="text-4xl font-mono font-bold tracking-wider text-foreground tabular-nums">
              {formatTime(trialSec)}
            </div>
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full transition-all duration-1000"
                style={{ width: `${(trialSec / trialTotal) * 100}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground text-center font-medium">
              {trialSec > 300
                ? "Enjoying Woxus? Buy a license to unlock full unlimited access."
                : "Your trial is ending soon! Purchase a license to keep using Woxus."}
            </p>
            <a
              href={buyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={primaryBtnCls + " mt-1"}
            >
              <ExternalLink className="h-4 w-4" />
              Buy License Key
            </a>
          </div>
        </div>
      )}

      {state === "trial" && !feedbackSent && (
        <div className={cardCls}>
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-muted border border-border flex items-center justify-center text-foreground shrink-0">
              <MessageCircle className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Share Feedback</h2>
              <p className="text-xs text-muted-foreground font-medium">Help us improve Woxus during your trial</p>
            </div>
          </div>
          <div className="space-y-4 pt-1">
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setFeedbackRating(star)}
                  className={`p-1.5 rounded-md transition-colors ${
                    star <= feedbackRating ? "text-amber-500" : "text-muted-foreground/30 hover:text-muted-foreground/60"
                  }`}
                >
                  <Star className="h-5 w-5 fill-current" />
                </button>
              ))}
            </div>
            <textarea
              placeholder="Tell us what you think (optional)"
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              className={inputCls + " resize-none h-20"}
            />
            <button
              onClick={handleSubmitFeedback}
              disabled={feedbackRating === 0 || feedbackSubmitting}
              className={primaryBtnCls}
            >
              <Send className="h-4 w-4" />
              {feedbackSubmitting ? "Sending..." : "Send Feedback"}
            </button>
          </div>
        </div>
      )}

      {/* Activate License Card */}
      <div className={cardCls}>
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-muted border border-border flex items-center justify-center text-foreground shrink-0">
            <Key className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Activate License</h2>
            <p className="text-xs text-muted-foreground font-medium">Enter your license key to activate Woxus</p>
          </div>
        </div>
        <div className="space-y-3 pt-1">
          <div className="flex gap-2.5">
            <input
              type="text"
              placeholder="XXXX-XXXX-XXXX-XXXX"
              value={licenseInput}
              onChange={(e) => { setLicenseInput(e.target.value.toUpperCase()); setLicenseError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleVerify(); }}
              className={inputCls + " flex-1 font-mono"}
            />
            <button
              onClick={handleVerify}
              disabled={!licenseInput.trim() || verifying}
              className={primaryBtnCls}
            >
              {verifying ? "Verifying..." : "Activate"}
            </button>
          </div>
          {licenseError && (
            <p className="text-xs text-destructive font-medium flex items-center gap-1.5 pt-1">
              <AlertCircle className="h-3.5 w-3.5" />
              {licenseError}
            </p>
          )}
        </div>
      </div>

      {/* Start Free Trial Card */}
      {state === "unlicensed" && (
        <div className={cardCls}>
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-muted border border-border flex items-center justify-center text-foreground shrink-0">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Start Free Trial</h2>
              <p className="text-xs text-muted-foreground font-medium">Get {Math.round(trialTotal / 60)} minutes of free trial access</p>
            </div>
          </div>
          <div className="space-y-3.5 pt-1">
            <input
              type="email"
              placeholder="Your email (required)"
              value={trialEmail}
              onChange={(e) => setTrialEmail(e.target.value)}
              className={inputCls}
            />
            <button
              onClick={handleStartTrial}
              disabled={startingTrial || !trialEmail.trim() || !trialEmail.includes("@")}
              className={primaryBtnCls + " w-full"}
            >
              {startingTrial ? "Starting..." : "Start Free Trial"}
            </button>
          </div>
        </div>
      )}

      {/* Buy License Card */}
      {state === "unlicensed" && (
        <div className={cardCls}>
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-muted border border-border flex items-center justify-center text-foreground shrink-0">
              <ExternalLink className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Buy a License</h2>
              <p className="text-xs text-muted-foreground font-medium">Skip the trial — get full access now</p>
            </div>
          </div>
          <div className="space-y-3 pt-1">
            <a
              href={buyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={primaryBtnCls + " w-full"}
            >
              <ExternalLink className="h-4 w-4" />
              Buy License Key
            </a>
            <p className="text-[11px] text-muted-foreground/70 font-medium leading-relaxed">
              Your checkout is pre-bound to this device.
              {hwid ? (
                <span className="font-mono text-muted-foreground/90 block mt-0.5 truncate" title={hwid}>
                  Device ID: {hwid}
                </span>
              ) : (
                <span className="block mt-0.5">Device ID will be attached automatically.</span>
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

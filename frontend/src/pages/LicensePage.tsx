import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Separator } from "@heroui/react";
import { Key, Clock, ExternalLink, Star, Send, AlertCircle, CheckCircle } from "lucide-react";
import { getHardwareId } from "@/lib/hardware";
import { toast } from "@/components/Toast";

const API = "http://127.0.0.1:8000/api";
const BUY_URL = import.meta.env.VITE_BUY_URL || "http://localhost:3000/buy";

type PageState = "loading" | "unlicensed" | "trial" | "licensed";

interface Props {
  onActivated?: () => void;
}

export default function LicensePage({ onActivated }: Props) {
  const [state, setState] = useState<PageState>("loading");
  const [hwid] = useState(getHardwareId);

  const [licenseKey, setLicenseKey] = useState("");
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

  const checkStatus = useCallback(async () => {
    const cached = localStorage.getItem("woxus_license_key");
    if (cached) {
      try {
        const res = await fetch(`${API}/license/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ license_key: cached, hardware_id: hwid }),
        });
        const data = await res.json();
        if (data.valid) {
          setLicenseKey(cached);
          setState("licensed");
          return;
        }
      } catch {
        /* offline — treat as unlicensed */
      }
    }

    try {
      const res = await fetch(`${API}/trial/status?hardware_id=${hwid}`);
      const data = await res.json();
      if (data.active) {
        setTrialSec(data.remaining_seconds);
        setTrialTotal(data.total_seconds);
        setTrialEmail(data.email || "");
        setState("trial");
        return;
      } else {
        setTrialExpired(true);
      }
    } catch {
      /* offline */
    }

    setState("unlicensed");
  }, [hwid]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  useEffect(() => {
    if (state === "trial") {
      intervalRef.current = setInterval(async () => {
        try {
          const res = await fetch(`${API}/trial/status?hardware_id=${hwid}`);
          const data = await res.json();
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
  }, [state, hwid]);

  const handleVerify = async () => {
    if (!licenseInput.trim()) return;
    setVerifying(true);
    setLicenseError("");

    try {
      const res = await fetch(`${API}/license/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ license_key: licenseInput.trim(), hardware_id: hwid }),
      });
      const data = await res.json();
      if (data.valid) {
        localStorage.setItem("woxus_license_key", licenseInput.trim());
        setLicenseKey(licenseInput.trim());
        setState("licensed");
        onActivated?.();
      } else {
        setLicenseError(data.reason || "Invalid license key");
      }
    } catch {
      setLicenseError("Could not reach license server");
    }
    setVerifying(false);
  };

  const handleStartTrial = async () => {
    setStartingTrial(true);
    try {
      const res = await fetch(`${API}/trial/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hardware_id: hwid, email: trialEmail }),
      });
      const data = await res.json();
      if (data.active) {
        setTrialSec(data.remaining_seconds);
        setTrialTotal(data.total_seconds);
        setTrialEmail(data.email || trialEmail);
        setState("trial");
        onActivated?.();
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
      await fetch(`${API}/feedback/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: feedbackRating, text: feedbackText, hardware_id: hwid }),
      });
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

  if (state === "loading") {
    return (
      <div className="max-w-lg mx-auto px-6 py-12">
        <Card className="border-border/60 shadow-sm">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Checking license status...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state === "licensed") {
    return (
      <div className="max-w-lg mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">License</h1>
          <p className="text-sm text-muted-foreground mt-1">Your license status</p>
        </div>
        <Separator />
        <Card className="border-border/60 shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <CardTitle className="text-sm font-medium">Licensed</CardTitle>
                <CardDescription className="text-xs">Your Woxus license is active</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Key className="h-4 w-4 text-muted-foreground" />
              <code className="text-xs bg-muted px-2 py-0.5 rounded">{licenseKey}</code>
            </div>
            <p className="text-xs text-muted-foreground">Hardware ID: <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{hwid}</code></p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">License</h1>
        <p className="text-sm text-muted-foreground mt-1">Activate Woxus to continue</p>
      </div>
      <Separator />

      {/* Trial section */}
      {!trialExpired && (
      <Card className="border-border/60 shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
              <Clock className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <CardTitle className="text-sm font-medium">
                {state === "trial" ? "Free Trial Active" : "Try Woxus Free"}
              </CardTitle>
              <CardDescription className="text-xs">
                {state === "trial"
                  ? `You have ${formatTime(trialSec)} remaining`
                  : "Test all features for a limited time"}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {state === "trial" ? (
            <div className="space-y-3">
              {trialEmail && (
                <p className="text-xs text-muted-foreground">Email: {trialEmail}</p>
              )}
              <div className="w-full bg-accent rounded-full h-2.5">
                <div
                  className="h-2.5 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-1000"
                  style={{ width: `${(trialSec / trialTotal) * 100}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Time remaining</span>
                <span className="font-mono font-medium text-foreground">{formatTime(trialSec)}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Start a free trial to explore Woxus with no commitment.
              </p>
              <input
                type="email"
                value={trialEmail}
                onChange={(e) => setTrialEmail(e.target.value)}
                placeholder="Enter your email"
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <button
                onClick={handleStartTrial}
                disabled={startingTrial || !trialEmail.trim()}
                className="w-full py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-medium hover:from-amber-400 hover:to-orange-400 disabled:opacity-50 transition-all"
              >
                {startingTrial ? "Starting..." : "Start Free Trial"}
              </button>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* License entry */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center">
              <Key className="h-5 w-5 text-accent-foreground" />
            </div>
            <div>
              <CardTitle className="text-sm font-medium">Enter License Key</CardTitle>
              <CardDescription className="text-xs">
                Already have a license? Enter your key below
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={licenseInput}
                onChange={(e) => setLicenseInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                placeholder="WOX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
                className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <button
                onClick={handleVerify}
                disabled={verifying || !licenseInput.trim()}
                className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 disabled:opacity-50 transition-all"
              >
                {verifying ? "..." : "Verify"}
              </button>
            </div>
            {licenseError && (
              <div className="flex items-center gap-1.5 text-xs text-red-500">
                <AlertCircle className="h-3 w-3" />
                <span>{licenseError}</span>
              </div>
            )}
            <div className="text-center">
              <a
                href={`${BUY_URL}?hardwareId=${hwid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-violet-500 hover:text-violet-400 transition-colors"
              >
                Don't have a key? Buy a license <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Feedback */}
      {!feedbackSent && (
      <Card className="border-border/60 shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center">
              <Star className="h-5 w-5 text-accent-foreground" />
            </div>
            <div>
              <CardTitle className="text-sm font-medium">Send Feedback</CardTitle>
              <CardDescription className="text-xs">Help us improve Woxus</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
            <div className="space-y-3">
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setFeedbackRating(n)}
                    className={`text-lg transition-colors ${
                      n <= feedbackRating ? "text-amber-400" : "text-muted-foreground/30 hover:text-muted-foreground/50"
                    }`}
                  >
                    ★
                  </button>
                ))}
              </div>
              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="Tell us what you think..."
                rows={3}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
              />
              <button
                onClick={handleSubmitFeedback}
                disabled={feedbackRating === 0 || feedbackSubmitting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 disabled:opacity-50 transition-all"
              >
                <Send className="h-3.5 w-3.5" />
                {feedbackSubmitting ? "Sending..." : "Send"}
              </button>
            </div>
        </CardContent>
      </Card>
      )}
    </div>
  );
}

import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Separator } from "@heroui/react";
import { Key, Clock, ExternalLink, Star, Send, AlertCircle, CheckCircle, MessageCircle } from "lucide-react";
import { toast } from "@/components/Toast";

const BUY_URL = import.meta.env.VITE_BUY_URL || "http://localhost:3000/buy";

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

  const checkStatus = useCallback(async () => {
    // @ts-ignore
    const result = await window.electronAPI?.getLicenseStatus?.();
    if (!result) { setState("unlicensed"); return; }

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
                <CardTitle>Active</CardTitle>
                <CardDescription>Your license is active</CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (trialExpired) {
    return (
      <div className="max-w-lg mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">License</h1>
          <p className="text-sm text-muted-foreground mt-1">Your free trial has ended</p>
        </div>
        <Separator />
        <Card className="border-destructive/50 border-2 shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertCircle className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <CardTitle>Trial Expired</CardTitle>
                <CardDescription>Purchase a license to continue using Woxus</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4 pb-6">
            <a
              href={BUY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <ExternalLink className="h-4 w-4" />
              Buy License
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">License</h1>
        <p className="text-sm text-muted-foreground mt-1">Activate Woxus with a license key or start a free trial</p>
      </div>
      <Separator />

      {state === "trial" && (
        <Card className="border-border/60 shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                <Clock className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <CardTitle>Free Trial</CardTitle>
                <CardDescription>
                  {trialEmail ? `Trial for ${trialEmail}` : "Trial in progress"}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3 pb-6">
            <div className="text-4xl font-mono font-bold tracking-wider">
              {formatTime(trialSec)}
            </div>
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full transition-all duration-1000"
                style={{ width: `${(trialSec / trialTotal) * 100}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {trialSec > 300
                ? "Enjoying Woxus? Buy a license to support development."
                : "Your trial is ending soon! Purchase a license to continue."}
            </p>
            <a
              href={BUY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <ExternalLink className="h-4 w-4" />
              Buy License
            </a>
          </CardContent>
        </Card>
      )}

      {state === "trial" && !feedbackSent && (
        <Card className="border-border/60 shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                <MessageCircle className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle>Feedback</CardTitle>
                <CardDescription>Help us improve Woxus</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pb-6">
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setFeedbackRating(star)}
                  className={`p-1 rounded transition-colors ${
                    star <= feedbackRating ? "text-amber-500" : "text-muted hover:text-muted-foreground"
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
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <button
              onClick={handleSubmitFeedback}
              disabled={feedbackRating === 0 || feedbackSubmitting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              <Send className="h-4 w-4" />
              {feedbackSubmitting ? "Sending..." : "Send Feedback"}
            </button>
          </CardContent>
        </Card>
      )}

      <Card className="border-border/60 shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
              <Key className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>Activate License</CardTitle>
              <CardDescription>Enter your license key to activate Woxus</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pb-6">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="XXXX-XXXX-XXXX-XXXX"
              value={licenseInput}
              onChange={(e) => { setLicenseInput(e.target.value.toUpperCase()); setLicenseError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleVerify(); }}
              className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <button
              onClick={handleVerify}
              disabled={!licenseInput.trim() || verifying}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {verifying ? "Verifying..." : "Activate"}
            </button>
          </div>
          {licenseError && (
            <p className="text-xs text-red-500 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {licenseError}
            </p>
          )}
        </CardContent>
      </Card>

      {state === "unlicensed" && (
        <Card className="border-border/60 shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                <Clock className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle>Start Free Trial</CardTitle>
                <CardDescription>Get 10 minutes of free trial access</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pb-6">
            <input
              type="email"
              placeholder="Your email (optional)"
              value={trialEmail}
              onChange={(e) => setTrialEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <button
              onClick={handleStartTrial}
              disabled={startingTrial}
              className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {startingTrial ? "Starting..." : "Start Free Trial"}
            </button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
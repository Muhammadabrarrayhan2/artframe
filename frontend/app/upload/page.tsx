"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { cn, formatBytes } from "@/lib/utils";
import { UploadCloud, X, Loader2, ShieldCheck, FileWarning, ShieldAlert, MailWarning, Ban, Link2, TriangleAlert, Sparkles } from "lucide-react";

const MAX_MB = 25;
const ACCEPT = "image/*,video/*,audio/*";

const SECURITY_EXAMPLES = [
  {
    label: "Fake bank alert",
    type: "phishing",
    text: "Urgent! Your bank account has been locked. Verify now at bit.ly/secure-bank to avoid permanent suspension. Enter your OTP within 5 minutes.",
  },
  {
    label: "Prize claim spam",
    type: "spam",
    text: "Congratulations!!! Your number won a free iPhone and a cash voucher. Click this link now and pay a small admin fee so your prize can be shipped today.",
  },
  {
    label: "Fake HR request",
    type: "phishing",
    text: "Hello, this is HR. Your payroll account has an issue. Log in again using your work email and old password through the link below so your salary is not delayed.",
  },
];

const PHISHING_PATTERNS = [
  { label: "Requests a password, PIN, OTP, or login credential", weight: 22, test: /password|otp|pin|verification code|login again|credential|security code/i },
  { label: "Contains a shortened or suspicious URL", weight: 16, test: /bit\.ly|tinyurl|t\.co|goo\.gl|s\.id|https?:\/\/|www\./i },
  { label: "Uses urgent or threatening language", weight: 14, test: /urgent|immediately|now|today|within \d+ (minutes|hours)|locked|suspended|terminated|warning/i },
  { label: "Pretends to be a bank, courier, HR, admin, or official institution", weight: 12, test: /bank|account|courier|hr|payroll|admin|customer service|support team|official/i },
  { label: "Asks you to verify your account or identity", weight: 12, test: /verify|validation|confirm account|confirm identity|update your details/i },
  { label: "Pushes you to click a link before checking the domain", weight: 10, test: /click|tap|open the link|visit the link|follow this link/i },
  { label: "Promises prizes, money, or unrealistic promotions", weight: 8, test: /prize|voucher|promo|cashback|free|won|bonus|reward/i },
  { label: "Requests a transfer, fee, or fast payment", weight: 12, test: /transfer|admin fee|payment|pay now|deposit|processing fee/i },
];

const SPAM_PATTERNS = [
  { label: "Uses repeated exclamation marks or all-caps wording", weight: 10, test: /!{2,}|[A-Z]{5,}/ },
  { label: "Promises prizes, giveaways, or exaggerated promotions", weight: 18, test: /free|promo|discount|voucher|bonus|jackpot|won|reward/i },
  { label: "Aggressively pushes you to click or buy right now", weight: 12, test: /click now|buy now|order now|claim now|sign up now/i },
  { label: "Looks repetitive and not personally addressed", weight: 10, test: /congratulations|last chance|limited offer|everyone|selected user/i },
  { label: "Contains a promotional link or domain", weight: 12, test: /https?:\/\/|www\.|bit\.ly|tinyurl/i },
  { label: "Disguises itself as an important notification", weight: 10, test: /invoice|billing|account|verification|delivery|package/i },
];

const BLOCKING_GUIDE = [
  "Do not click links or reply before checking the sender address and destination domain carefully.",
  "Block the sender's phone number, email address, or account directly from your chat, email, or SMS app.",
  "Report it as spam or phishing so your device and platform filters can learn from it.",
  "If the message claims to be from a bank, marketplace, HR, or courier, contact the official channel you find yourself.",
  "If you already clicked or shared data, change your password immediately, log out of active sessions, and enable MFA.",
];

type SecurityVerdict = "low" | "medium" | "high";

type SecurityAnalysis = {
  scamScore: number;
  phishingScore: number;
  spamScore: number;
  verdict: SecurityVerdict;
  triggers: string[];
  recommendedActions: string[];
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function scoreText(message: string, rules: { label: string; weight: number; test: RegExp }[]) {
  const hits = rules.filter((rule) => rule.test.test(message));
  return {
    score: clamp(hits.reduce((sum, rule) => sum + rule.weight, 0), 0, 100),
    hits: hits.map((rule) => rule.label),
  };
}

function analyzeSecurityText(message: string): SecurityAnalysis {
  const trimmed = message.trim();
  if (!trimmed) {
    return {
      scamScore: 0,
      phishingScore: 0,
      spamScore: 0,
      verdict: "low",
      triggers: [],
      recommendedActions: BLOCKING_GUIDE.slice(0, 3),
    };
  }

  const phishing = scoreText(trimmed, PHISHING_PATTERNS);
  const spam = scoreText(trimmed, SPAM_PATTERNS);
  const textLengthBonus = trimmed.length > 180 ? 6 : trimmed.length > 90 ? 3 : 0;
  const mixedScore = clamp(Math.round(phishing.score * 0.6 + spam.score * 0.4 + textLengthBonus), 0, 100);
  const verdict: SecurityVerdict = mixedScore >= 70 ? "high" : mixedScore >= 40 ? "medium" : "low";

  return {
    scamScore: mixedScore,
    phishingScore: phishing.score,
    spamScore: spam.score,
    verdict,
    triggers: [...new Set([...phishing.hits, ...spam.hits])].slice(0, 6),
    recommendedActions:
      verdict === "high"
        ? BLOCKING_GUIDE
        : verdict === "medium"
          ? BLOCKING_GUIDE.slice(0, 4)
          : BLOCKING_GUIDE.slice(0, 3),
  };
}

function scoreTone(verdict: SecurityVerdict) {
  if (verdict === "high") {
    return {
      label: "High risk",
      className: "border-red-500/30 bg-red-500/10 text-red-200",
      meter: "bg-red-400",
    };
  }
  if (verdict === "medium") {
    return {
      label: "Use caution",
      className: "border-accent-amber/30 bg-accent-amber/10 text-accent-amber",
      meter: "bg-accent-amber",
    };
  }
  return {
    label: "Low risk",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    meter: "bg-emerald-400",
  };
}

export default function UploadPage() {
  return (
    <ProtectedRoute>
      <AppShell>
        <UploadInner />
      </AppShell>
    </ProtectedRoute>
  );
}

function UploadInner() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const stageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeToastRef = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [consent, setConsent] = useState(false);
  const [progress, setProgress] = useState<"idle" | "uploading" | "analyzing">("idle");
  const [securityMessage, setSecurityMessage] = useState("");

  useEffect(() => {
    return () => {
      if (stageTimerRef.current) {
        clearTimeout(stageTimerRef.current);
      }
      if (activeToastRef.current) {
        toast.dismiss(activeToastRef.current);
      }
    };
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) accept(f);
  }, []);

  function accept(f: File) {
    if (f.size > MAX_MB * 1024 * 1024) {
      toast.error(`File exceeds ${MAX_MB} MB limit`);
      return;
    }
    setFile(f);
    if (f.type.startsWith("image/")) {
      const url = URL.createObjectURL(f);
      setPreview(url);
    } else {
      setPreview(null);
    }
  }

  function clearFile() {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
  }

  async function submit() {
    if (!file || progress !== "idle") return;
    if (!consent) {
      toast.error("Please confirm consent before uploading.");
      return;
    }

    if (stageTimerRef.current) {
      clearTimeout(stageTimerRef.current);
      stageTimerRef.current = null;
    }
    if (activeToastRef.current) {
      toast.dismiss(activeToastRef.current);
      activeToastRef.current = null;
    }

    setProgress("uploading");
    try {
      const toastId = toast.loading("Uploading media...");
      activeToastRef.current = toastId;

      stageTimerRef.current = setTimeout(() => {
        setProgress("analyzing");
        if (activeToastRef.current) {
          toast.loading("Analyzing forensic signals...", { id: activeToastRef.current });
        }
      }, 250);

      const res = await api.uploadMedia(file, true);

      if (stageTimerRef.current) {
        clearTimeout(stageTimerRef.current);
        stageTimerRef.current = null;
      }

      toast.success("Analysis complete", { id: toastId });
      activeToastRef.current = null;
      router.push(`/result/${res.media.id}`);
    } catch (err) {
      if (stageTimerRef.current) {
        clearTimeout(stageTimerRef.current);
        stageTimerRef.current = null;
      }

      const msg = err instanceof ApiError ? err.detail : "Upload failed";
      if (activeToastRef.current) {
        toast.error(msg, { id: activeToastRef.current });
        activeToastRef.current = null;
      } else {
        toast.error(msg);
      }
      setProgress("idle");
    }
  }

  const busy = progress !== "idle";
  const security = analyzeSecurityText(securityMessage);
  const securityTone = scoreTone(security.verdict);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="label mb-2">Upload</div>
      <h1 className="text-display text-4xl md:text-5xl tracking-[-0.025em] mb-3">
        Analyze a <span className="italic text-accent-amber">new</span> piece of media
      </h1>
      <p className="text-ink-secondary mb-10 max-w-2xl">
        Drop an image, video, or audio clip below. ArtFrame will run forensic signals against it and
        show you the full breakdown.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        onClick={() => !file && inputRef.current?.click()}
        className={cn(
          "relative border-2 border-dashed rounded-xl transition-all cursor-pointer overflow-hidden",
          over ? "border-accent-amber bg-accent-amber/5" : "border-border hover:border-border-strong",
          file ? "p-6" : "p-14 text-center"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) accept(f);
          }}
        />

        {!file ? (
          <>
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-bg-elevated border border-border mx-auto mb-5">
              <UploadCloud className="h-6 w-6 text-accent-amber" strokeWidth={1.5} />
            </div>
            <h3 className="text-display text-2xl mb-2">Drop your file here</h3>
            <p className="text-sm text-ink-secondary">
              or <span className="text-accent-amber underline">browse from your device</span>
            </p>
            <p className="text-xs text-ink-tertiary mt-6">
              Images · video · audio · up to {MAX_MB}MB
            </p>
          </>
        ) : (
          <div className="flex items-start gap-5">
            {preview ? (
              <img
                src={preview}
                alt=""
                className="w-32 h-32 object-cover rounded-lg border border-border-subtle shrink-0"
              />
            ) : (
              <div className="w-32 h-32 rounded-lg bg-bg-elevated border border-border-subtle flex items-center justify-center text-ink-tertiary text-xs shrink-0">
                {file.type.startsWith("video/") ? "Video" : file.type.startsWith("audio/") ? "Audio" : "File"}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3 mb-2">
                <h3 className="font-medium text-ink-primary truncate">{file.name}</h3>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    clearFile();
                  }}
                  className="text-ink-tertiary hover:text-ink-primary transition-colors"
                  disabled={busy}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="text-xs text-ink-tertiary">
                {formatBytes(file.size)} · {file.type || "unknown type"}
              </div>
            </div>
          </div>
        )}
      </div>

      {file && (
        <>
          <div className="mt-6 card p-5 bg-bg-surface/50">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                disabled={busy}
                className="mt-0.5 h-4 w-4 accent-accent-amber"
              />
              <div className="text-sm">
                <div className="text-ink-primary flex items-center gap-2 mb-1">
                  <ShieldCheck className="h-4 w-4 text-accent-amber" strokeWidth={1.5} />
                  I confirm I own or have the right to analyze this media
                </div>
                <div className="text-xs text-ink-tertiary leading-relaxed">
                  Uploaded media is only visible to you. Analysis results are stored for your history.
                  Do not upload other people's private content.
                </div>
              </div>
            </label>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button onClick={submit} disabled={busy || !consent} className="btn-primary">
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {progress === "uploading" ? "Uploading" : "Analyzing"}…
                </>
              ) : (
                <>Run forensic analysis</>
              )}
            </button>
            <button onClick={clearFile} disabled={busy} className="btn-ghost">
              Cancel
            </button>
          </div>
        </>
      )}

      {/* Guardrail callout */}
      <div className="mt-14 card p-6 border-border-subtle flex gap-4">
        <FileWarning className="h-5 w-5 text-ink-tertiary shrink-0 mt-0.5" strokeWidth={1.5} />
        <div>
          <h4 className="text-sm font-medium text-ink-primary mb-1">A word about limits</h4>
          <p className="text-xs text-ink-secondary leading-relaxed">
            ArtFrame uses classical forensic signals. It is decision-support, not a court-admissible
            verdict. A "likely AI" result means the signals agree the media has synthetic
            characteristics; it does not prove fabrication. Always consider context.
          </p>
        </div>
      </div>

      <div className="mt-8 card-elevated p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
          <div>
            <div className="label mb-2 flex items-center gap-2">
              <ShieldAlert className="h-3.5 w-3.5" strokeWidth={1.5} />
              Security Add-on
            </div>
            <h2 className="text-display text-2xl tracking-[-0.02em]">Analyze phishing or spam text</h2>
            <p className="text-sm text-ink-secondary mt-2 max-w-2xl">
              Paste a suspicious message to estimate scam probability, inspect phishing and spam indicators,
              and get quick blocking or response guidance.
            </p>
          </div>
          <div className={cn("tag border", securityTone.className)}>
            <Sparkles className="h-4 w-4" strokeWidth={1.6} />
            {securityTone.label}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-4">
            <div>
              <div className="label mb-3">Message to inspect</div>
              <textarea
                value={securityMessage}
                onChange={(e) => setSecurityMessage(e.target.value)}
                placeholder="Example: Your account has been locked. Click this link and enter your OTP to verify..."
                className="w-full min-h-[180px] rounded-xl border border-border bg-bg-surface px-4 py-3 text-sm text-ink-primary outline-none transition-colors placeholder:text-ink-tertiary focus:border-accent-amber"
              />
            </div>

            <div>
              <div className="label mb-3">Try a sample</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {SECURITY_EXAMPLES.map((example) => (
                  <button
                    key={example.label}
                    onClick={() => setSecurityMessage(example.text)}
                    className="card p-4 text-left hover:border-border-strong transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <MailWarning className="h-4 w-4 text-accent-amber" strokeWidth={1.5} />
                      <div className="text-sm font-medium text-ink-primary">{example.label}</div>
                    </div>
                    <div className="text-xs text-ink-tertiary uppercase tracking-[0.18em] mb-2">{example.type}</div>
                    <div className="text-xs text-ink-secondary line-clamp-4">{example.text}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 space-y-4">
            <div className="card p-5 bg-bg-surface/60">
              <div className="label mb-3">Risk estimate</div>
              <div className="flex items-end justify-between gap-4 mb-3">
                <div>
                  <div className="text-4xl font-semibold tracking-[-0.03em] text-ink-primary">{security.scamScore}%</div>
                  <div className="text-sm text-ink-secondary">estimated chance this message is a scam</div>
                </div>
                <div className={cn("tag border", securityTone.className)}>{securityTone.label}</div>
              </div>
              <div className="h-2 rounded-full bg-bg-inset overflow-hidden mb-4">
                <div
                  className={cn("h-full rounded-full transition-all duration-500", securityTone.meter)}
                  style={{ width: `${security.scamScore}%` }}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-border-subtle bg-bg-inset/60 p-3">
                  <div className="text-xs text-ink-tertiary mb-1">Phishing score</div>
                  <div className="text-xl font-medium text-ink-primary">{security.phishingScore}%</div>
                </div>
                <div className="rounded-lg border border-border-subtle bg-bg-inset/60 p-3">
                  <div className="text-xs text-ink-tertiary mb-1">Spam score</div>
                  <div className="text-xl font-medium text-ink-primary">{security.spamScore}%</div>
                </div>
              </div>
            </div>

            <div className="card p-5">
              <div className="label mb-3">Detected signals</div>
              {security.triggers.length ? (
                <div className="space-y-2">
                  {security.triggers.map((trigger) => (
                    <div key={trigger} className="flex gap-2 text-sm text-ink-secondary">
                      <TriangleAlert className="h-4 w-4 text-accent-amber shrink-0 mt-0.5" strokeWidth={1.5} />
                      <span>{trigger}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-ink-tertiary">
                  No clear signals yet. Paste a message or choose one of the examples to start the analysis.
                </div>
              )}
            </div>

            <div className="card p-5">
              <div className="label mb-3">How to block or respond</div>
              <div className="space-y-2">
                {security.recommendedActions.map((action) => (
                  <div key={action} className="flex gap-2 text-sm text-ink-secondary">
                    <Ban className="h-4 w-4 text-accent-amber shrink-0 mt-0.5" strokeWidth={1.5} />
                    <span>{action}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card p-5 bg-bg-surface/50">
              <div className="label mb-3">Quick checklist</div>
              <div className="space-y-2 text-sm text-ink-secondary">
                <div className="flex gap-2">
                  <Link2 className="h-4 w-4 text-accent-amber shrink-0 mt-0.5" strokeWidth={1.5} />
                  <span>Check whether the link domain really belongs to the official brand, not an imitation or shortlink.</span>
                </div>
                <div className="flex gap-2">
                  <ShieldCheck className="h-4 w-4 text-accent-amber shrink-0 mt-0.5" strokeWidth={1.5} />
                  <span>Never share OTPs, PINs, passwords, or reset codes through chat, email, or SMS.</span>
                </div>
                <div className="flex gap-2">
                  <MailWarning className="h-4 w-4 text-accent-amber shrink-0 mt-0.5" strokeWidth={1.5} />
                  <span>Compare the message tone with the official notifications you normally receive from that service.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

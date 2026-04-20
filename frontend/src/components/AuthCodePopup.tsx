"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, ShieldCheck, Sparkles } from "lucide-react";
import type { OTPChallengeOut } from "@/lib/api";

type AuthCodePopupProps = {
  open: boolean;
  challenge: OTPChallengeOut | null;
  code: string;
  onCodeChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  onResend?: () => void;
  confirming?: boolean;
  resending?: boolean;
  title: string;
  description: string;
  confirmLabel: string;
};

export function AuthCodePopup({
  open,
  challenge,
  code,
  onCodeChange,
  onClose,
  onConfirm,
  onResend,
  confirming = false,
  resending = false,
  title,
  description,
  confirmLabel,
}: AuthCodePopupProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!open || !challenge || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-3xl border border-border bg-bg-surface p-6 shadow-[0_20px_80px_-20px_rgba(0,0,0,0.8)]">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-accent-amber">
          <Sparkles className="h-4 w-4" strokeWidth={1.6} />
          Web Verification
        </div>

        <h2 className="text-display mt-4 text-3xl leading-tight text-ink-primary">{title}</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-secondary">{description}</p>

        <div className="mt-5 rounded-2xl border border-accent-amber/30 bg-accent-amber/10 p-4">
          <div className="label mb-2">Popup Code</div>
          <div className="font-mono text-3xl tracking-[0.35em] text-accent-amber">{challenge.dev_code}</div>
          <p className="mt-2 text-xs leading-relaxed text-ink-secondary">
            {challenge.detail || `Code is valid for ${challenge.otp_expires_minutes} minutes.`}
          </p>
        </div>

        <div className="mt-5">
          <label className="label block mb-2">Type the code</label>
          <input
            value={code}
            onChange={(e) => onCodeChange(e.target.value.replace(/\D/g, "").slice(0, 10))}
            inputMode="numeric"
            autoFocus
            placeholder="Enter the popup number"
            className="input text-center font-mono tracking-[0.3em]"
          />
        </div>

        <div className="mt-5 flex items-start gap-2 rounded-2xl border border-border bg-bg-inset/70 p-4 text-xs text-ink-secondary">
          <ShieldCheck className="mt-0.5 h-4 w-4 text-signal-real" strokeWidth={1.8} />
          <span>Enter the number shown in this popup to continue the authentication flow.</span>
        </div>

        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={confirming} className="btn-primary flex-1">
            {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>

        {onResend ? (
          <button
            type="button"
            onClick={onResend}
            disabled={resending}
            className="mt-3 w-full text-sm text-accent-amber transition-colors hover:text-accent-glow disabled:opacity-50"
          >
            {resending ? "Generating a new popup code..." : "Generate a new popup code"}
          </button>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

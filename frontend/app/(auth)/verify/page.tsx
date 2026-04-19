"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import { ArrowRight, Mail, RotateCw } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";

const OTP_LEN = 6;

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="h-24" />}>
      <VerifyInner />
    </Suspense>
  );
}

function VerifyInner() {
  const router = useRouter();
  const params = useSearchParams();
  const setToken = useAuth((s) => s.setToken);

  const email = params.get("email") || "";
  const [digits, setDigits] = useState<string[]>(Array(OTP_LEN).fill(""));
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (cooldown > 0) {
      const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
      return () => clearTimeout(t);
    }
  }, [cooldown]);

  function onChange(i: number, v: string) {
    const clean = v.replace(/\D/g, "").slice(0, 1);
    const next = [...digits];
    next[i] = clean;
    setDigits(next);
    if (clean && i < OTP_LEN - 1) {
      refs.current[i + 1]?.focus();
    }
  }

  function onKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      refs.current[i - 1]?.focus();
    }
  }

  function onPaste(e: React.ClipboardEvent) {
    const v = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LEN);
    if (v.length) {
      const next = v.split("").concat(Array(OTP_LEN - v.length).fill(""));
      setDigits(next);
      refs.current[Math.min(v.length, OTP_LEN - 1)]?.focus();
    }
    e.preventDefault();
  }

  async function submit() {
    const code = digits.join("");
    if (code.length !== OTP_LEN) {
      toast.error("Please enter all 6 digits");
      return;
    }
    setLoading(true);
    try {
      const { access_token } = await api.verifyOtp({ email, code });
      await setToken(access_token);
      toast.success("Email verified — welcome to ArtFrame");
      router.replace("/dashboard");
    } catch (err) {
      const msg = err instanceof ApiError ? err.detail : "Verification failed";
      toast.error(msg);
      setDigits(Array(OTP_LEN).fill(""));
      refs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    if (!email) return;
    setResending(true);
    try {
      await api.resendOtp(email);
      toast.success("New code sent");
      setCooldown(30);
    } catch (err) {
      toast.error("Could not resend");
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="animate-fade-up">
      <div className="label mb-3">Step 02 · Verify</div>
      <h1 className="text-display text-4xl tracking-[-0.02em] text-ink-primary leading-[1.05]">
        Check your <span className="italic text-accent-amber">inbox.</span>
      </h1>
      <p className="mt-4 text-sm text-ink-secondary">
        A 6-digit code was sent to{" "}
        <span className="text-ink-primary inline-flex items-center gap-1.5">
          <Mail className="h-3.5 w-3.5 text-accent-amber" />
          {email || "your email"}
        </span>
      </p>
      <p className="text-xs text-ink-tertiary mt-1.5">
        In dev mode, the code is printed to the backend console.
      </p>

      <div className="mt-10">
        <div className="flex gap-2 md:gap-3" onPaste={onPaste}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              value={d}
              onChange={(e) => onChange(i, e.target.value)}
              onKeyDown={(e) => onKey(i, e)}
              inputMode="numeric"
              maxLength={1}
              className="w-12 h-14 md:w-14 md:h-16 text-center text-2xl font-display bg-bg-inset border border-border rounded-lg text-ink-primary focus:outline-none focus:border-accent-amber focus:ring-1 focus:ring-accent-amber/30 transition-all"
            />
          ))}
        </div>

        <button
          onClick={submit}
          disabled={loading || digits.join("").length !== OTP_LEN}
          className="btn-primary w-full mt-8"
        >
          {loading ? "Verifying…" : "Verify & sign in"}
          {!loading && <ArrowRight className="h-4 w-4" />}
        </button>

        <button
          type="button"
          onClick={resend}
          disabled={resending || cooldown > 0}
          className="mt-4 w-full text-center text-sm text-ink-secondary hover:text-ink-primary transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          <RotateCw className="h-3.5 w-3.5" strokeWidth={1.5} />
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
        </button>

        <div className="text-center mt-8 text-xs text-ink-tertiary">
          Wrong email?{" "}
          <Link href="/register" className="text-accent-amber hover:underline">
            Start over
          </Link>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowRight, Eye, EyeOff, Lock, Mail, User } from "lucide-react";
import { AuthCodePopup } from "@/components/AuthCodePopup";
import { api, ApiError, type OTPChallengeOut } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";

export default function RegisterPage() {
  const router = useRouter();
  const setToken = useAuth((s) => s.setToken);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [consent, setConsent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [challenge, setChallenge] = useState<OTPChallengeOut | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!consent) {
      toast.error("Please accept the terms to continue.");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      const nextChallenge = await api.register({ email, name, password });
      setChallenge(nextChallenge);
      setOtpCode("");
      setPopupOpen(true);
      toast.success(nextChallenge.message);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Something went wrong";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function onVerifyOtp() {
    if (!challenge) return;
    if (!otpCode.trim()) {
      toast.error("Enter the popup code first.");
      return;
    }

    setVerifying(true);
    try {
      const { access_token } = await api.verifyOtp({ email: challenge.email, code: otpCode });
      await setToken(access_token);
      toast.success("Account created");
      router.replace("/dashboard");
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Something went wrong";
      toast.error(msg);
    } finally {
      setVerifying(false);
    }
  }

  async function onResendOtp() {
    if (!challenge) return;
    setResending(true);
    try {
      const nextChallenge = await api.resendOtp(challenge.email);
      setChallenge(nextChallenge);
      setOtpCode("");
      toast.success("A new popup code has been generated.");
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Something went wrong";
      toast.error(msg);
    } finally {
      setResending(false);
    }
  }

  return (
    <>
      <div className="animate-fade-up">
        <div className="label mb-3">Step 01 - Register</div>
        <h1 className="text-display text-4xl tracking-[-0.02em] text-ink-primary leading-[1.05]">
          Create your <br />
          <span className="italic text-accent-amber">ArtFrame</span> account.
        </h1>
        <p className="mt-4 text-sm text-ink-secondary">
          Already a member?{" "}
          <Link href="/login" className="text-accent-amber hover:underline">
            Sign in here
          </Link>
        </p>

        <form onSubmit={onSubmit} className="mt-10 space-y-5">
          <Field label="Full name" icon={<User className="h-4 w-4" strokeWidth={1.5} />}>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Rayhan"
              className="input pl-11"
              minLength={2}
            />
          </Field>

          <Field label="Email" icon={<Mail className="h-4 w-4" strokeWidth={1.5} />}>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="input pl-11"
            />
          </Field>

          <Field label="Password" icon={<Lock className="h-4 w-4" strokeWidth={1.5} />}>
            <input
              type={show ? "text" : "password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="input pl-11 pr-11"
              minLength={8}
            />
            <button
              type="button"
              onClick={() => setShow((value) => !value)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-tertiary hover:text-ink-primary transition-colors"
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </Field>

          <label className="flex items-start gap-3 pt-2 cursor-pointer">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-accent-amber"
            />
            <span className="text-xs text-ink-secondary leading-relaxed">
              I understand that I may only upload media I own or have rights to analyze, and I agree to
              the responsible use terms.
            </span>
          </label>

          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? "Preparing popup code..." : "Continue"}
            {!loading && <ArrowRight className="h-4 w-4" />}
          </button>
        </form>
      </div>

      <AuthCodePopup
        open={popupOpen}
        challenge={challenge}
        code={otpCode}
        onCodeChange={setOtpCode}
        onClose={() => setPopupOpen(false)}
        onConfirm={onVerifyOtp}
        onResend={onResendOtp}
        confirming={verifying}
        resending={resending}
        title="Finish registration"
        description="The number appears directly in the web popup. Type it back in to activate your new account."
        confirmLabel="Verify and continue"
      />
    </>
  );
}

function Field({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label block mb-2">{label}</label>
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-tertiary">{icon}</span>
        {children}
      </div>
    </div>
  );
}

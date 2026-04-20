"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowRight, Eye, EyeOff, Lock, ShieldCheck } from "lucide-react";
import { AuthCodePopup } from "@/components/AuthCodePopup";
import { api, ApiError, type OTPChallengeOut } from "@/lib/api";

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="h-24" />}>
      <ForgotPasswordContent />
    </Suspense>
  );
}

function ForgotPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email")?.trim() || "";
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [verifiedCode, setVerifiedCode] = useState("");
  const [identityVerified, setIdentityVerified] = useState(false);
  const [challenge, setChallenge] = useState<OTPChallengeOut | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);

  async function requestVerificationCode() {
    if (!email) {
      toast.error("Open password reset from the sign-in page after entering your email.");
      router.replace("/login");
      return;
    }

    setLoading(true);
    try {
      const nextChallenge = await api.requestForgotPasswordOtp(email);
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
      const result = await api.verifyForgotPasswordOtp({ email: challenge.email, code: otpCode });
      setVerifiedCode(otpCode);
      setIdentityVerified(true);
      setPopupOpen(false);
      toast.success(result.message);
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
      const nextChallenge = await api.requestForgotPasswordOtp(challenge.email);
      setChallenge(nextChallenge);
      setOtpCode("");
      setVerifiedCode("");
      setIdentityVerified(false);
      toast.success("A new reset popup code has been generated.");
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!identityVerified || !verifiedCode) {
      toast.error("Verify your identity before setting a new password.");
      return;
    }

    if (newPassword.length < 8) {
      toast.error("Your new password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("Password confirmation does not match.");
      return;
    }

    setLoading(true);
    try {
      const result = await api.forgotPassword({
        email,
        code: verifiedCode,
        new_password: newPassword,
      });
      toast.success(result.message);
      router.replace("/login");
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

  return (
    <>
      <div className="animate-fade-up">
        <div className="label mb-3">Reset Password</div>
        <h1 className="text-display text-4xl tracking-[-0.02em] text-ink-primary leading-[1.05]">
          Verify first, <br />
          <span className="italic text-accent-amber">then set a new password.</span>
        </h1>
        <p className="mt-4 text-sm text-ink-secondary">
          Password reset is for <span className="text-ink-primary">{email || "no email selected"}</span>.
        </p>

        {!identityVerified ? (
          <div className="mt-10 space-y-5">
            <div className="rounded-2xl border border-border bg-bg-inset/60 p-5 text-sm text-ink-secondary">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-signal-real" strokeWidth={1.8} />
                <div>
                  <p className="text-ink-primary">Identity check required</p>
                  <p className="mt-1">
                    Start verification first. After the popup code is confirmed, the new password form will appear.
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={requestVerificationCode}
              disabled={loading || !email}
              className="btn-primary w-full"
            >
              {loading ? "Preparing popup code..." : "Verify identity"}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-10 space-y-5">
            <div className="rounded-2xl border border-signal-real/30 bg-signal-real/10 p-4 text-sm text-ink-secondary">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-signal-real" strokeWidth={1.8} />
                <div>
                  <p className="text-ink-primary">Identity verified</p>
                  <p className="mt-1">You can now enter and save your new password.</p>
                </div>
              </div>
            </div>

            <Field label="New password" icon={<Lock className="h-4 w-4" strokeWidth={1.5} />}>
              <input
                type={showNewPassword ? "text" : "password"}
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="input pl-11 pr-11"
                minLength={8}
              />
              <button
                type="button"
                onClick={() => setShowNewPassword((value) => !value)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-tertiary hover:text-ink-primary transition-colors"
              >
                {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </Field>

            <Field label="Confirm new password" icon={<Lock className="h-4 w-4" strokeWidth={1.5} />}>
              <input
                type={showConfirmPassword ? "text" : "password"}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat your new password"
                className="input pl-11 pr-11"
                minLength={8}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((value) => !value)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-tertiary hover:text-ink-primary transition-colors"
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </Field>

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? "Saving new password..." : "Save new password"}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>
        )}

        <p className="mt-5 text-sm text-ink-secondary">
          Remembered it?{" "}
          <Link href="/login" className="text-accent-amber hover:underline">
            Back to sign in
          </Link>
        </p>
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
        title="Verify password reset access"
        description="Confirm the popup code first. After verification succeeds, the new password form will be unlocked."
        confirmLabel="Verify identity"
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

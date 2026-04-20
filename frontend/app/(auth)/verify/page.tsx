"use client";

import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="h-24" />}>
      <VerifyInner />
    </Suspense>
  );
}

function VerifyInner() {
  return (
    <div className="animate-fade-up">
      <div className="label mb-3">Verification In Popup</div>
      <h1 className="text-display text-4xl tracking-[-0.02em] text-ink-primary leading-[1.05]">
        Verification now happens <span className="italic text-accent-amber">inside the auth popup.</span>
      </h1>
      <p className="mt-4 text-sm text-ink-secondary">
        Registration and reset password now show a popup code directly in the web flow, then the user types that code to continue.
      </p>

      <div className="mt-8 rounded-2xl border border-border bg-bg-inset/60 p-5 text-sm text-ink-secondary">
        <div className="flex items-center gap-2 text-ink-primary">
          <CheckCircle2 className="h-4 w-4 text-signal-real" strokeWidth={1.8} />
          Use the code popup shown during registration or password reset.
        </div>
      </div>

      <div className="mt-8 space-y-3">
        <Link href="/login" className="btn-primary inline-flex w-full items-center justify-center">
          Sign in
          <ArrowRight className="h-4 w-4" />
        </Link>
        <Link href="/register" className="btn-secondary inline-flex w-full items-center justify-center">
          Create account
        </Link>
      </div>
    </div>
  );
}

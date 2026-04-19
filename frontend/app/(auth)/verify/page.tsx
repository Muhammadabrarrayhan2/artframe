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
      <div className="label mb-3">Verification Removed</div>
      <h1 className="text-display text-4xl tracking-[-0.02em] text-ink-primary leading-[1.05]">
        You can sign in <span className="italic text-accent-amber">right away.</span>
      </h1>
      <p className="mt-4 text-sm text-ink-secondary">
        Email OTP verification is no longer required. New accounts become active immediately after registration.
      </p>

      <div className="mt-8 rounded-2xl border border-border bg-bg-inset/60 p-5 text-sm text-ink-secondary">
        <div className="flex items-center gap-2 text-ink-primary">
          <CheckCircle2 className="h-4 w-4 text-signal-real" strokeWidth={1.8} />
          Account access now starts immediately after register or login.
        </div>
      </div>

      <div className="mt-8 space-y-3">
        <Link href="/login" className="btn-primary w-full inline-flex items-center justify-center">
          Sign in
          <ArrowRight className="h-4 w-4" />
        </Link>
        <Link href="/register" className="btn-secondary w-full inline-flex items-center justify-center">
          Create account
        </Link>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";

export default function LoginPage() {
  const router = useRouter();
  const setToken = useAuth((s) => s.setToken);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  function onForgotPassword() {
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      toast.error("Enter your email first, then continue to password reset.");
      return;
    }
    router.push(`/forgot-password?email=${encodeURIComponent(cleanEmail)}`);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { access_token } = await api.login({ email, password });
      await setToken(access_token);
      toast.success("Welcome back");
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
      setLoading(false);
    }
  }

  return (
    <div className="animate-fade-up">
      <div className="label mb-3">Sign in</div>
      <h1 className="text-display text-4xl tracking-[-0.02em] text-ink-primary leading-[1.05]">
        Welcome <br />
        <span className="italic text-accent-amber">back.</span>
      </h1>
      <p className="mt-4 text-sm text-ink-secondary">
        No account yet?{" "}
        <Link href="/register" className="text-accent-amber hover:underline">
          Register here
        </Link>
      </p>

      <form onSubmit={onSubmit} className="mt-10 space-y-5">
        <div>
          <label className="label block mb-2">Email</label>
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-tertiary" strokeWidth={1.5} />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="input pl-11"
            />
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="label">Password</label>
            <button
              type="button"
              onClick={onForgotPassword}
              className="text-xs text-accent-amber hover:underline"
            >
              Forgot password?
            </button>
          </div>
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-tertiary" strokeWidth={1.5} />
            <input
              type={show ? "text" : "password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input pl-11 pr-11"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShow((value) => !value)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-tertiary hover:text-ink-primary"
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Signing in..." : "Sign in"}
          {!loading && <ArrowRight className="h-4 w-4" />}
        </button>
      </form>
    </div>
  );
}

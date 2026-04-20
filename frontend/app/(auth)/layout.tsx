import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/Logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-5">
      {/* Left - form */}
      <div className="relative z-10 flex flex-col bg-bg-base px-6 py-6 lg:col-span-2 lg:px-12 lg:py-10">
        <div className="flex items-center justify-between">
          <Logo />
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-ink-tertiary transition-colors hover:text-ink-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} /> back
          </Link>
        </div>

        <div className="flex flex-1 items-center">
          <div className="mx-auto w-full max-w-md py-10">{children}</div>
        </div>

        <div className="text-xs text-ink-tertiary">
          Copyright {new Date().getFullYear()} ArtFrame - Responsible synthetic media
        </div>
      </div>

      {/* Right - visual */}
      <div className="relative hidden overflow-hidden border-l border-border-subtle lg:col-span-3 lg:block">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 30% 30%, rgba(232, 165, 75, 0.2), transparent 60%), radial-gradient(ellipse 60% 50% at 90% 90%, rgba(232, 102, 60, 0.1), transparent 70%), #0a0a0b",
          }}
        />

        <div className="relative z-10 flex h-full flex-col justify-end p-14">
          <blockquote className="text-display max-w-xl text-4xl leading-[1.1] tracking-[-0.02em] text-ink-primary xl:text-5xl">
            "We owe the world a way to know what was made,{" "}
            <span className="italic text-accent-amber">and what was captured.</span>"
          </blockquote>
          <div className="mt-6 flex items-center gap-3 text-sm text-ink-tertiary">
            <div className="h-px w-10 bg-ink-tertiary" />
            ArtFrame manifesto
          </div>
        </div>

        <svg className="absolute inset-0 h-full w-full opacity-[0.06]" preserveAspectRatio="none">
          <defs>
            <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
              <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#e8a54b" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>

        {/* Ambient specimens - floating cards */}
        <div
          className="animate-fade-up absolute right-16 top-16 w-48 rounded-lg border border-border bg-bg-surface/80 p-4 backdrop-blur-md"
          style={{ animationDelay: "0.3s" }}
        >
          <div className="mb-2 text-[10px] uppercase tracking-widest text-ink-tertiary">Specimen 01</div>
          <div className="mb-3 h-24 rounded bg-gradient-to-br from-accent-amber/20 to-signal-ai/20" />
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-signal-ai">AI 82%</span>
            <span className="text-[10px] text-ink-tertiary">ELA flat</span>
          </div>
        </div>

        <div
          className="animate-fade-up absolute bottom-48 right-44 w-48 rounded-lg border border-border bg-bg-surface/80 p-4 backdrop-blur-md"
          style={{ animationDelay: "0.5s" }}
        >
          <div className="mb-2 text-[10px] uppercase tracking-widest text-ink-tertiary">Specimen 02</div>
          <div className="mb-3 h-24 rounded bg-gradient-to-br from-signal-real/10 to-ink-tertiary/10" />
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-signal-real">REAL 91%</span>
            <span className="text-[10px] text-ink-tertiary">EXIF ok</span>
          </div>
        </div>
      </div>
    </div>
  );
}

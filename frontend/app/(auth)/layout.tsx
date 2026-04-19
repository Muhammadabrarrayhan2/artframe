import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ArrowLeft } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-5">
      {/* Left — form */}
      <div className="lg:col-span-2 flex flex-col px-6 py-6 lg:px-12 lg:py-10 bg-bg-base relative z-10">
        <div className="flex items-center justify-between">
          <Logo />
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-ink-tertiary hover:text-ink-primary transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} /> back
          </Link>
        </div>

        <div className="flex-1 flex items-center">
          <div className="w-full max-w-md mx-auto py-10">{children}</div>
        </div>

        <div className="text-xs text-ink-tertiary">
          © {new Date().getFullYear()} ArtFrame · Responsible synthetic media
        </div>
      </div>

      {/* Right — visual */}
      <div className="hidden lg:block lg:col-span-3 relative overflow-hidden border-l border-border-subtle">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 30% 30%, rgba(232, 165, 75, 0.2), transparent 60%), radial-gradient(ellipse 60% 50% at 90% 90%, rgba(232, 102, 60, 0.1), transparent 70%), #0a0a0b",
          }}
        />

        {/* Editorial quote */}
        <div className="relative z-10 h-full flex flex-col justify-end p-14">
          <blockquote className="text-display text-4xl xl:text-5xl leading-[1.1] tracking-[-0.02em] text-ink-primary max-w-xl">
            "We owe the world a way to know what was made,{" "}
            <span className="italic text-accent-amber">and what was captured.</span>"
          </blockquote>
          <div className="mt-6 flex items-center gap-3 text-ink-tertiary text-sm">
            <div className="h-px w-10 bg-ink-tertiary" />
            ArtFrame manifesto
          </div>
        </div>

        {/* Decorative SVG grid */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.06]" preserveAspectRatio="none">
          <defs>
            <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
              <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#e8a54b" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>

        {/* Ambient specimens — floating cards */}
        <div className="absolute top-16 right-16 w-48 rounded-lg border border-border bg-bg-surface/80 backdrop-blur-md p-4 animate-fade-up" style={{ animationDelay: "0.3s" }}>
          <div className="text-[10px] uppercase tracking-widest text-ink-tertiary mb-2">Specimen 01</div>
          <div className="h-24 rounded bg-gradient-to-br from-accent-amber/20 to-signal-ai/20 mb-3" />
          <div className="flex justify-between items-center">
            <span className="text-xs text-signal-ai font-mono">AI 82%</span>
            <span className="text-[10px] text-ink-tertiary">ELA flat</span>
          </div>
        </div>

        <div className="absolute bottom-48 right-44 w-48 rounded-lg border border-border bg-bg-surface/80 backdrop-blur-md p-4 animate-fade-up" style={{ animationDelay: "0.5s" }}>
          <div className="text-[10px] uppercase tracking-widest text-ink-tertiary mb-2">Specimen 02</div>
          <div className="h-24 rounded bg-gradient-to-br from-signal-real/10 to-ink-tertiary/10 mb-3" />
          <div className="flex justify-between items-center">
            <span className="text-xs text-signal-real font-mono">REAL 91%</span>
            <span className="text-[10px] text-ink-tertiary">EXIF ok</span>
          </div>
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ArrowRight, Shield, Eye, Layers, Fingerprint, Sparkles, Github } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      {/* Ambient grain overlay */}
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.035] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      {/* Header */}
      <header className="relative z-10 mx-auto max-w-7xl px-5 lg:px-8 py-6 flex items-center justify-between">
        <Logo />
        <nav className="hidden md:flex items-center gap-8 text-sm text-ink-secondary">
          <a href="#how" className="hover:text-ink-primary transition-colors">How it works</a>
          <a href="#forensics" className="hover:text-ink-primary transition-colors">Forensics</a>
          <a href="#safety" className="hover:text-ink-primary transition-colors">Safety</a>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/login" className="btn-ghost text-sm">Sign in</Link>
          <Link href="/register" className="btn-primary text-sm">
            Get started <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      {/* HERO */}
      <section className="relative z-10 mx-auto max-w-7xl px-5 lg:px-8 pt-16 md:pt-28 pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-end">
          <div className="lg:col-span-8 animate-fade-up">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-bg-surface/40 text-xs text-ink-secondary mb-8">
              <span className="relative inline-flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-accent-amber opacity-60 animate-glow-pulse" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-amber" />
              </span>
              Forensic media detection, responsibly built
            </div>

            <h1 className="text-display text-5xl md:text-7xl lg:text-[88px] leading-[0.95] tracking-[-0.035em] text-ink-primary">
              See what the{" "}
              <span className="italic text-accent-amber">camera</span>{" "}
              <br className="hidden md:block" />
              can no longer prove.
            </h1>

            <p className="mt-8 text-lg md:text-xl text-ink-secondary max-w-2xl leading-relaxed">
              ArtFrame inspects images, video, and audio for traces of synthetic generation —
              compression forensics, frequency signatures, sensor noise, temporal drift — then shows you
              <span className="text-ink-primary"> why</span> it thinks what it thinks.
            </p>

            <div className="mt-10 flex flex-wrap gap-3">
              <Link href="/register" className="btn-primary text-sm">
                Start analysing <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#how" className="btn-secondary text-sm">
                How it works
              </a>
            </div>

            <div className="mt-14 flex items-center gap-8 text-xs text-ink-tertiary">
              <div className="flex items-center gap-2">
                <Shield className="h-3.5 w-3.5" strokeWidth={1.5} />
                No model black box
              </div>
              <div className="flex items-center gap-2">
                <Fingerprint className="h-3.5 w-3.5" strokeWidth={1.5} />
                Every output watermarked
              </div>
              <div className="flex items-center gap-2">
                <Eye className="h-3.5 w-3.5" strokeWidth={1.5} />
                You see every signal
              </div>
            </div>
          </div>

          {/* Hero visual — stylized forensic preview */}
          <div className="lg:col-span-4 relative animate-fade-up" style={{ animationDelay: "0.15s" }}>
            <HeroVisual />
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="relative z-10 border-y border-border-subtle py-5 overflow-hidden bg-bg-surface/30">
        <div className="flex animate-marquee whitespace-nowrap text-xs uppercase tracking-[0.3em] text-ink-tertiary">
          {Array.from({ length: 2 }).map((_, k) => (
            <div key={k} className="flex items-center gap-12 px-6 shrink-0">
              <span>Error level analysis</span>
              <span className="text-border-strong">•</span>
              <span>Frequency domain</span>
              <span className="text-border-strong">•</span>
              <span>Sensor noise residual</span>
              <span className="text-border-strong">•</span>
              <span>EXIF audit</span>
              <span className="text-border-strong">•</span>
              <span>Temporal drift</span>
              <span className="text-border-strong">•</span>
              <span>Spectral prosody</span>
              <span className="text-border-strong">•</span>
              <span>Texture variance</span>
              <span className="text-border-strong">•</span>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="relative z-10 mx-auto max-w-7xl px-5 lg:px-8 py-28">
        <div className="max-w-3xl">
          <div className="label mb-4">01 — The method</div>
          <h2 className="text-display text-4xl md:text-5xl leading-[1.05] tracking-[-0.025em] text-ink-primary">
            Forensics first. Confidence scores second.
          </h2>
          <p className="mt-6 text-lg text-ink-secondary leading-relaxed">
            Most detectors hand you a single number and hope you trust it.
            ArtFrame runs an ensemble of classical forensic signals — the ones published in the
            image-forensics literature for two decades — and shows you each one, with its reasoning,
            before computing a verdict.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-16">
          {[
            {
              n: "01",
              title: "Upload",
              body: "Drop an image, a clip, a voice memo. Nothing is shared publicly. Every upload is bound to your account with an audit trail.",
            },
            {
              n: "02",
              title: "Inspect",
              body: "ArtFrame runs six parallel forensic signals on images, a per-frame ensemble plus temporal drift on video, and spectral profile checks on audio.",
            },
            {
              n: "03",
              title: "Interpret",
              body: "You get a verdict, a confidence score, and — crucially — the individual signal scores with plain-language reasons for each.",
            },
          ].map((step) => (
            <div
              key={step.n}
              className="group card p-7 relative overflow-hidden hover:border-border-strong transition-all"
            >
              <div className="font-display text-7xl text-ink-tertiary/15 absolute top-4 right-5 leading-none">
                {step.n}
              </div>
              <div className="label mb-5">Step {step.n.replace("0", "")}</div>
              <h3 className="text-display text-2xl text-ink-primary mb-3">{step.title}</h3>
              <p className="text-sm text-ink-secondary leading-relaxed">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FORENSIC SIGNALS detailed */}
      <section id="forensics" className="relative z-10 mx-auto max-w-7xl px-5 lg:px-8 py-28">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          <div className="lg:col-span-5 lg:sticky lg:top-24 self-start">
            <div className="label mb-4">02 — What we look at</div>
            <h2 className="text-display text-4xl md:text-5xl leading-[1.05] tracking-[-0.025em]">
              Six signals for images.<br />
              <span className="italic text-accent-amber">One honest verdict.</span>
            </h2>
            <p className="mt-6 text-ink-secondary leading-relaxed">
              Each signal produces an independent 0–100 "AI-ness" score. The final verdict is a weighted
              ensemble — and you see every component, not just the answer.
            </p>
          </div>

          <div className="lg:col-span-7 space-y-px">
            {[
              {
                name: "Metadata / EXIF audit",
                desc: "Real cameras leave behind make/model, capture time, and exposure data. Its absence is a soft signal; AI-labeled Software tags are a hard one.",
              },
              {
                name: "Error Level Analysis",
                desc: "Re-encoding the image at a fixed JPEG quality and diffing. Flat error maps suggest the pixels never lived through a real camera sensor.",
              },
              {
                name: "Frequency-domain profile",
                desc: "2D FFT over a normalized crop. Generative models often over-smooth high frequencies or leave periodic spectral peaks.",
              },
              {
                name: "Sensor noise residual",
                desc: "Natural photographs carry photon-shot noise with specific variance. Synthetic images are often too clean for real sensors.",
              },
              {
                name: "Block texture variance",
                desc: "Diffusion outputs produce large contiguous regions of ultra-smooth texture. We count them.",
              },
              {
                name: "File header inspection",
                desc: "PNG without compression history, missing markers, or explicit AI strings (stable-diffusion, midjourney) in the first 4KB.",
              },
            ].map((sig, i) => (
              <div
                key={sig.name}
                className="group flex items-start gap-6 py-6 border-b border-border-subtle hover:bg-bg-surface/30 px-4 -mx-4 rounded-md transition-colors"
              >
                <div className="font-mono text-xs text-accent-amber/70 pt-1 w-10 shrink-0">
                  0{i + 1}
                </div>
                <div className="flex-1">
                  <h3 className="text-ink-primary font-medium tracking-tight">{sig.name}</h3>
                  <p className="text-sm text-ink-secondary mt-2 leading-relaxed">{sig.desc}</p>
                </div>
                <Layers
                  className="h-4 w-4 text-ink-tertiary mt-1.5 group-hover:text-accent-amber transition-colors"
                  strokeWidth={1.5}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SAFETY / RESPONSIBLE AI */}
      <section id="safety" className="relative z-10 mx-auto max-w-7xl px-5 lg:px-8 py-28">
        <div className="card-elevated p-10 md:p-14 relative overflow-hidden">
          <div
            className="absolute inset-0 pointer-events-none opacity-40"
            style={{
              background:
                "radial-gradient(ellipse 60% 80% at 100% 0%, rgba(232, 165, 75, 0.15), transparent 60%)",
            }}
          />
          <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-10">
            <div className="lg:col-span-5">
              <div className="label mb-4">03 — The line we hold</div>
              <h2 className="text-display text-4xl md:text-5xl leading-[1.05] tracking-[-0.025em]">
                A lab, not a <span className="italic text-accent-amber">weapon</span>.
              </h2>
            </div>
            <div className="lg:col-span-7 space-y-5 text-ink-secondary">
              <p className="leading-relaxed text-lg">
                The Transformation Lab is deliberately limited. You get stylization — sketch, oil, watercolor,
                cyberpunk, vintage, duotone, mosaic, pixel — and{" "}
                <span className="text-ink-primary">nothing that imitates a specific person</span>.
              </p>
              <ul className="space-y-3 pt-4">
                {[
                  "No identity transfer. No face-swap. No voice cloning.",
                  "Every output is diagonally watermarked. Every output carries a bottom-right badge. The JPEG comment records style, user ID, and timestamp.",
                  "Daily quota of 10 transformations per account. Every request is audit-logged.",
                  "Before anything runs, you confirm the media is yours and you accept the AI-generated label on the output.",
                ].map((t) => (
                  <li key={t} className="flex gap-3 items-start text-sm">
                    <Sparkles className="h-4 w-4 text-accent-amber mt-1 shrink-0" strokeWidth={1.5} />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 mx-auto max-w-7xl px-5 lg:px-8 pb-32 pt-10">
        <div className="text-center max-w-3xl mx-auto">
          <h2 className="text-display text-5xl md:text-6xl leading-[1.02] tracking-[-0.03em]">
            Start with one image.<br />
            <span className="italic text-ink-tertiary">See what it's hiding.</span>
          </h2>
          <div className="mt-10 flex justify-center gap-3">
            <Link href="/register" className="btn-primary">
              Create an account <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/login" className="btn-secondary">
              I already have one
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border-subtle py-10">
        <div className="mx-auto max-w-7xl px-5 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-ink-tertiary">
          <div className="flex items-center gap-4">
            <Logo />
            <span className="text-ink-tertiary/50">·</span>
            <span>© {new Date().getFullYear()} ArtFrame</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#" className="hover:text-ink-primary transition-colors">Privacy</a>
            <a href="#" className="hover:text-ink-primary transition-colors">Terms</a>
            <a href="#" className="hover:text-ink-primary transition-colors inline-flex items-center gap-1.5">
              <Github className="h-3.5 w-3.5" strokeWidth={1.5} /> Source
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function HeroVisual() {
  return (
    <div className="relative aspect-[4/5] rounded-2xl border border-border bg-bg-surface overflow-hidden">
      {/* simulated image */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(135deg, #2a1a10 0%, #3a2418 40%, #1a1612 100%), radial-gradient(circle at 30% 40%, rgba(232, 165, 75, 0.25), transparent 50%)",
          backgroundBlendMode: "screen",
        }}
      />

      {/* scanning overlay */}
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute left-0 right-0 h-[140%] animate-scan opacity-80"
          style={{
            background:
              "linear-gradient(180deg, transparent 0%, rgba(232, 165, 75, 0.15) 48%, #e8a54b 50%, rgba(232, 165, 75, 0.15) 52%, transparent 100%)",
          }}
        />
      </div>

      {/* forensic grid */}
      <svg className="absolute inset-0 w-full h-full opacity-25" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <pattern id="g" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#e8a54b" strokeWidth="0.15" />
          </pattern>
        </defs>
        <rect width="100" height="100" fill="url(#g)" />
      </svg>

      {/* forensic callouts */}
      <div className="absolute top-5 left-5 right-5 flex justify-between items-start">
        <div className="font-mono text-[10px] text-accent-amber/90 bg-bg-base/80 backdrop-blur-sm px-2 py-1 rounded border border-accent-amber/30">
          SAMPLE · 256×256
        </div>
        <div className="font-mono text-[10px] text-signal-ai bg-bg-base/80 backdrop-blur-sm px-2 py-1 rounded border border-signal-ai/30">
          ● SCANNING
        </div>
      </div>

      <div className="absolute bottom-5 left-5 right-5 space-y-1.5 font-mono text-[10px]">
        {[
          ["EXIF", "absent", "#e8663c"],
          ["ELA μ", "1.24", "#e8a54b"],
          ["FFT HF/MF", "0.38", "#e8663c"],
          ["noise σ²", "6.81", "#e8663c"],
          ["smooth%", "67%", "#e8663c"],
        ].map(([k, v, c]) => (
          <div key={k} className="flex items-center justify-between px-2.5 py-1 rounded bg-bg-base/80 backdrop-blur-sm border border-border-subtle">
            <span className="text-ink-tertiary">{k}</span>
            <span style={{ color: c as string }}>{v}</span>
          </div>
        ))}
      </div>

      {/* circle readout */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="relative">
          <svg width="140" height="140" className="-rotate-90">
            <circle cx="70" cy="70" r="60" stroke="#2a2a2f" strokeWidth="2" fill="none" />
            <circle
              cx="70"
              cy="70"
              r="60"
              stroke="#e8663c"
              strokeWidth="2"
              fill="none"
              strokeDasharray="282"
              strokeDashoffset="56"
              strokeLinecap="round"
              className="drop-shadow-[0_0_8px_rgba(232,102,60,0.6)]"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-display text-3xl text-signal-ai font-light">80<span className="text-sm">%</span></div>
            <div className="text-[10px] uppercase tracking-widest text-ink-tertiary mt-0.5">AI likely</div>
          </div>
        </div>
      </div>
    </div>
  );
}

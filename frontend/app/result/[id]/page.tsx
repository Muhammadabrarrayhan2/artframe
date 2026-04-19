"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import { VerdictBadge } from "@/components/VerdictBadge";
import { ScoreRing } from "@/components/ScoreRing";
import { api, buildBackendUrl, type MediaWithAnalysis } from "@/lib/api";
import { cn, formatBytes, formatDate, pct } from "@/lib/utils";
import { ArrowLeft, Trash2, Loader2, Image as ImageIcon, Video, Music, Info } from "lucide-react";

export default function ResultPage() {
  return (
    <ProtectedRoute>
      <AppShell>
        <ResultInner />
      </AppShell>
    </ProtectedRoute>
  );
}

const SIGNAL_LABELS: Record<string, string> = {
  metadata: "Metadata / EXIF",
  ela: "Error Level Analysis",
  fft: "Frequency domain",
  noise: "Sensor noise residual",
  texture: "Texture variance",
  rendering: "Synthetic rendering style",
  jpeg: "File header",
  color: "Color coherence / saturation",
  depth: "Depth & sharpness uniformity",
  dynamics: "Dynamic range",
  spectral_flatness: "Spectral flatness",
  hf_rolloff: "High-frequency roll-off",
  frame_ensemble: "Per-frame ensemble",
  temporal: "Temporal consistency",
};

function ResultInner() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<MediaWithAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.getMedia(Number(id));
        setData(res);
      } catch {
        toast.error("Could not load result");
        router.push("/dashboard");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, router]);

  async function onDelete() {
    if (!data) return;
    if (!confirm("Delete this analysis permanently?")) return;
    try {
      await api.deleteMedia(data.media.id);
      toast.success("Deleted");
      router.push("/dashboard");
    } catch {
      toast.error("Could not delete");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-ink-tertiary" />
      </div>
    );
  }

  if (!data) return null;
  const { media: m, analysis: a } = data;
  const Icon = m.media_type === "image" ? ImageIcon : m.media_type === "video" ? Video : Music;

  // Normalize signals for display. For images the signals live at top-level;
  // for video they're nested under "ensemble".
  const signalEntries: [string, any][] = a
    ? Object.entries(a.signals).filter(([k]) => k !== "timeline" && k !== "ensemble_summary")
    : [];

  return (
    <div className="max-w-6xl mx-auto">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 text-sm text-ink-secondary hover:text-ink-primary mb-8 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </Link>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
        <div>
          <div className="label mb-2 inline-flex items-center gap-2">
            <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
            {m.media_type} result
          </div>
          <h1 className="text-display text-3xl md:text-4xl tracking-[-0.025em] break-all">
            {m.original_name}
          </h1>
          <div className="text-xs text-ink-tertiary mt-2">
            {formatBytes(m.file_size)} · {formatDate(m.created_at)} · id #{m.id}
          </div>
        </div>
        <button onClick={onDelete} className="btn-ghost self-start text-signal-ai hover:bg-signal-ai/10">
          <Trash2 className="h-4 w-4" /> Delete
        </button>
      </div>

      {a ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: preview + score ring */}
          <div className="lg:col-span-5 space-y-6">
            {m.media_type === "image" && !imgError ? (
              <div className="card overflow-hidden">
                <img
                  src={buildBackendUrl(`/api/v1/media/${m.id}/file`)}
                  alt={m.original_name}
                  className="w-full h-auto block"
                  onError={() => setImgError(true)}
                  crossOrigin="anonymous"
                />
              </div>
            ) : (
              <div className="card aspect-square flex items-center justify-center">
                <Icon className="h-14 w-14 text-ink-tertiary" strokeWidth={1} />
              </div>
            )}

            <div className="card-elevated p-8 flex flex-col items-center gap-5">
              <ScoreRing value={a.ai_probability} size={200} label="AI probability" />
              <div className="text-center">
                <VerdictBadge verdict={a.verdict} size="lg" />
                <div className="mt-3 text-xs text-ink-tertiary">
                  Confidence {pct(a.confidence)} · ensemble of{" "}
                  {signalEntries.length} signal{signalEntries.length === 1 ? "" : "s"}
                </div>
              </div>
            </div>
          </div>

          {/* Right: signal breakdown */}
          <div className="lg:col-span-7 space-y-6">
            <div className="card p-6">
              <div className="flex items-center gap-2 label mb-3">
                <Info className="h-3.5 w-3.5" strokeWidth={1.5} />
                Summary
              </div>
              <p className="text-sm text-ink-primary leading-relaxed">
                {a.reasons || "No specific reasons generated."}
              </p>
            </div>

            <div>
              <div className="label mb-3">Forensic signals</div>
              <div className="space-y-2">
                {signalEntries.map(([key, sig]) => (
                  <SignalRow key={key} name={SIGNAL_LABELS[key] || key} signal={sig} />
                ))}
              </div>
            </div>

            {/* Video-specific frame timeline */}
            {m.media_type === "video" && a.signals?.timeline?.length > 0 && (
              <div className="card p-6">
                <div className="label mb-4">Frame timeline</div>
                <div className="space-y-1.5">
                  {a.signals.timeline.map((t: any, i: number) => (
                    <div key={i} className="flex items-center gap-4 text-xs">
                      <span className="font-mono text-ink-tertiary w-12 shrink-0">
                        {t.timestamp?.toFixed(1)}s
                      </span>
                      <div className="flex-1 h-2 rounded-full bg-bg-inset overflow-hidden">
                        <div
                          className="h-full"
                          style={{
                            width: `${(t.ai_probability || 0) * 100}%`,
                            background:
                              t.ai_probability > 0.6
                                ? "#e8663c"
                                : t.ai_probability < 0.35
                                ? "#7dc47a"
                                : "#d9a23f",
                          }}
                        />
                      </div>
                      <span className="font-mono text-ink-secondary w-10 text-right">
                        {Math.round((t.ai_probability || 0) * 100)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card p-14 text-center">
          <Loader2 className="h-8 w-8 mx-auto mb-4 animate-spin text-ink-tertiary" />
          <p className="text-ink-secondary">Analysis is still processing…</p>
        </div>
      )}
    </div>
  );
}

function SignalRow({ name, signal }: { name: string; signal: any }) {
  const score = signal?.score ?? 0;
  const reason = signal?.reason ?? "—";
  const details = signal?.details ?? {};
  const color = score > 0.6 ? "#e8663c" : score < 0.35 ? "#7dc47a" : "#d9a23f";

  return (
    <div className="card p-4 group hover:border-border-strong transition-colors">
      <div className="flex items-center gap-4 mb-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-ink-primary font-medium">{name}</div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-32 h-1.5 rounded-full bg-bg-inset overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${score * 100}%`, background: color }}
            />
          </div>
          <span className="font-mono text-xs w-10 text-right" style={{ color }}>
            {Math.round(score * 100)}%
          </span>
        </div>
      </div>
      <p className="text-xs text-ink-secondary leading-relaxed ml-0">{reason}</p>
      {Object.keys(details).length > 0 && (
        <div className="mt-2 pt-2 border-t border-border-subtle flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-ink-tertiary">
          {Object.entries(details)
            .filter(([, v]) => typeof v !== "object")
            .slice(0, 6)
            .map(([k, v]) => (
              <span key={k}>
                <span className="opacity-60">{k}:</span> {String(v)}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

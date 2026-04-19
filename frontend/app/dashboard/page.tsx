"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import { VerdictBadge } from "@/components/VerdictBadge";
import { api, type MediaWithAnalysis, type StatsOut } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import { cn, formatBytes, formatDate, pct } from "@/lib/utils";
import { Upload, ArrowUpRight, Image as ImageIcon, Video, Music, TrendingUp, Loader2 } from "lucide-react";

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <AppShell>
        <DashboardInner />
      </AppShell>
    </ProtectedRoute>
  );
}

function DashboardInner() {
  const user = useAuth((s) => s.user);
  const [stats, setStats] = useState<StatsOut | null>(null);
  const [media, setMedia] = useState<MediaWithAnalysis[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [s, m] = await Promise.all([api.stats(), api.listMedia(12, 0)]);
        setStats(s);
        setMedia(m);
      } catch (e) {
        // user handled by ProtectedRoute
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="space-y-10">
      {/* Greeting */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <div className="label mb-2">Dashboard</div>
          <h1 className="text-display text-4xl md:text-5xl tracking-[-0.025em]">
            Good to see you,{" "}
            <span className="italic text-accent-amber">{user?.name.split(" ")[0] || "there"}</span>
          </h1>
        </div>
        <Link href="/upload" className="btn-primary self-start md:self-auto">
          <Upload className="h-4 w-4" strokeWidth={1.8} />
          New analysis
        </Link>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Total uploads"
          value={stats?.total_uploads ?? 0}
          icon={<Upload className="h-4 w-4" strokeWidth={1.5} />}
          loading={loading}
        />
        <StatCard
          label="Likely AI"
          value={stats?.likely_ai ?? 0}
          accent="ai"
          icon={<TrendingUp className="h-4 w-4" strokeWidth={1.5} />}
          loading={loading}
        />
        <StatCard
          label="Likely real"
          value={stats?.likely_real ?? 0}
          accent="real"
          loading={loading}
        />
        <StatCard
          label="Inconclusive"
          value={stats?.inconclusive ?? 0}
          accent="mixed"
          loading={loading}
        />
      </div>

      {/* Recent analyses */}
      <div>
        <div className="flex items-end justify-between mb-5">
          <div>
            <div className="label mb-1.5">Recent analyses</div>
            <h2 className="text-display text-2xl tracking-tight">History</h2>
          </div>
          {(media?.length ?? 0) > 0 && (
            <span className="text-xs text-ink-tertiary">
              {media!.length} item{media!.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {loading && <SkeletonGrid />}

        {!loading && (media?.length ?? 0) === 0 && <EmptyState />}

        {!loading && media && media.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {media.map((m) => (
              <MediaCard key={m.media.id} item={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  accent,
  loading,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
  accent?: "ai" | "real" | "mixed";
  loading?: boolean;
}) {
  const accentColor =
    accent === "ai"
      ? "text-signal-ai"
      : accent === "real"
      ? "text-signal-real"
      : accent === "mixed"
      ? "text-signal-mixed"
      : "text-ink-primary";
  return (
    <div className="card p-5 relative overflow-hidden group hover:border-border-strong transition-colors">
      <div className="flex items-center justify-between mb-3">
        <span className="label">{label}</span>
        {icon && <span className="text-ink-tertiary group-hover:text-accent-amber transition-colors">{icon}</span>}
      </div>
      <div className={cn("text-display text-4xl font-light tracking-[-0.02em]", accentColor)}>
        {loading ? (
          <span className="inline-block w-10 h-8 rounded bg-bg-elevated shimmer" />
        ) : (
          value.toLocaleString()
        )}
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="card aspect-[5/4] animate-pulse opacity-40" />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card p-14 text-center">
      <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-bg-elevated border border-border mx-auto mb-5">
        <Upload className="h-6 w-6 text-ink-tertiary" strokeWidth={1.5} />
      </div>
      <h3 className="text-display text-2xl mb-2">No analyses yet</h3>
      <p className="text-sm text-ink-secondary max-w-md mx-auto mb-6">
        Upload your first image, video, or audio clip to see ArtFrame's forensic breakdown.
      </p>
      <Link href="/upload" className="btn-primary">
        <Upload className="h-4 w-4" /> Upload media
      </Link>
    </div>
  );
}

function MediaCard({ item }: { item: MediaWithAnalysis }) {
  const { media: m, analysis: a } = item;
  const Icon = m.media_type === "image" ? ImageIcon : m.media_type === "video" ? Video : Music;
  return (
    <Link
      href={`/result/${m.id}`}
      className="group card p-5 hover:border-border-strong hover:bg-bg-elevated transition-all relative overflow-hidden"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="inline-flex items-center gap-2 text-xs text-ink-tertiary">
          <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
          {m.media_type}
        </div>
        <ArrowUpRight className="h-4 w-4 text-ink-tertiary group-hover:text-accent-amber transition-colors" strokeWidth={1.5} />
      </div>

      <div className="text-sm text-ink-primary font-medium truncate mb-1" title={m.original_name}>
        {m.original_name}
      </div>
      <div className="text-xs text-ink-tertiary mb-5">
        {formatBytes(m.file_size)} · {formatDate(m.created_at)}
      </div>

      {a ? (
        <div className="flex items-center justify-between pt-4 border-t border-border-subtle">
          <VerdictBadge verdict={a.verdict} size="sm" />
          <div className="font-mono text-xs text-ink-tertiary">AI {pct(a.ai_probability)}</div>
        </div>
      ) : (
        <div className="text-xs text-ink-tertiary pt-4 border-t border-border-subtle">
          {m.status === "processing" ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Processing
            </span>
          ) : (
            "No analysis"
          )}
        </div>
      )}
    </Link>
  );
}

import { cn } from "@/lib/utils";
import type { Verdict } from "@/lib/api";
import { AlertTriangle, CheckCircle2, HelpCircle } from "lucide-react";

const MAP: Record<Verdict, { label: string; color: string; icon: React.ElementType }> = {
  likely_ai: {
    label: "Likely AI-generated",
    color: "bg-signal-ai/10 text-signal-ai border-signal-ai/30",
    icon: AlertTriangle,
  },
  likely_real: {
    label: "Likely real",
    color: "bg-signal-real/10 text-signal-real border-signal-real/30",
    icon: CheckCircle2,
  },
  inconclusive: {
    label: "Inconclusive",
    color: "bg-signal-mixed/10 text-signal-mixed border-signal-mixed/30",
    icon: HelpCircle,
  },
};

export function VerdictBadge({ verdict, size = "md" }: { verdict: Verdict; size?: "sm" | "md" | "lg" }) {
  const { label, color, icon: Icon } = MAP[verdict] || MAP.inconclusive;
  const sizes = {
    sm: "text-xs px-2 py-0.5",
    md: "text-xs px-2.5 py-1",
    lg: "text-sm px-3 py-1.5",
  };
  const iconSize = { sm: 12, md: 14, lg: 16 }[size];
  return (
    <span className={cn("tag", color, sizes[size])}>
      <Icon style={{ width: iconSize, height: iconSize }} strokeWidth={1.8} />
      {label}
    </span>
  );
}

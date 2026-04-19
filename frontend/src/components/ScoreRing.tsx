import { cn } from "@/lib/utils";

type Props = {
  value: number; // 0..1
  size?: number;
  label?: string;
  sublabel?: string;
};

export function ScoreRing({ value, size = 180, label, sublabel }: Props) {
  const pct = Math.max(0, Math.min(1, value));
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * pct;

  const color = pct > 0.6 ? "#e8663c" : pct < 0.35 ? "#7dc47a" : "#d9a23f";

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#1f1f23" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${dash} ${c}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.16,1,0.3,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-display text-4xl font-light" style={{ color }}>
          {Math.round(pct * 100)}
          <span className="text-lg align-top text-ink-tertiary ml-0.5">%</span>
        </div>
        {label && <div className="label mt-1">{label}</div>}
        {sublabel && <div className="text-xs text-ink-tertiary mt-1">{sublabel}</div>}
      </div>
    </div>
  );
}

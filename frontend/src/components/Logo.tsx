import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2.5 font-display text-lg tracking-tight text-ink-primary hover:opacity-90 transition-opacity",
        className
      )}
    >
      <span className="relative inline-flex h-7 w-7 items-center justify-center">
        <svg viewBox="0 0 24 24" className="h-full w-full" fill="none" strokeWidth="1.5">
          <rect x="2.5" y="2.5" width="19" height="19" rx="3" stroke="#e8a54b" />
          <path d="M7 15 L12 7 L17 15 Z" stroke="#e8a54b" strokeLinejoin="round" fill="#e8a54b" fillOpacity="0.15" />
          <circle cx="12" cy="12" r="1.2" fill="#e8a54b" />
        </svg>
      </span>
      <span className="font-semibold tracking-[-0.01em]">
        Art<span className="text-accent-amber">Frame</span>
      </span>
    </Link>
  );
}

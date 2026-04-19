"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-store";
import { Logo } from "./Logo";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Upload, Wand2, User, LogOut, Menu, X } from "lucide-react";
import { useState } from "react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/upload", label: "Upload", icon: Upload },
  { href: "/lab", label: "Lab", icon: Wand2 },
  { href: "/profile", label: "Profile", icon: User },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-bg-base/70 border-b border-border-subtle">
        <div className="mx-auto max-w-7xl px-5 lg:px-8 py-3.5 flex items-center justify-between gap-6">
          <Logo />

          <nav className="hidden md:flex items-center gap-1">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname?.startsWith(href + "/");
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-all",
                    active
                      ? "bg-bg-elevated text-ink-primary"
                      : "text-ink-secondary hover:text-ink-primary hover:bg-bg-surface/60"
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.5} />
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden md:flex items-center gap-3">
            {user && (
              <div className="flex items-center gap-3 pl-3 border-l border-border-subtle">
                <div className="h-8 w-8 rounded-full bg-bg-elevated border border-border flex items-center justify-center text-xs font-medium text-accent-amber">
                  {user.name.slice(0, 1).toUpperCase()}
                </div>
                <button
                  onClick={() => logout()}
                  className="btn-ghost !px-2.5 !py-1.5"
                  title="Log out"
                >
                  <LogOut className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>
            )}
          </div>

          <button
            className="md:hidden btn-ghost !p-2"
            onClick={() => setOpen(!open)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {open && (
          <div className="md:hidden border-t border-border-subtle bg-bg-surface">
            <nav className="px-5 py-3 flex flex-col gap-1">
              {NAV.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || pathname?.startsWith(href + "/");
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "inline-flex items-center gap-3 px-3 py-2.5 rounded-md text-sm",
                      active ? "bg-bg-elevated text-ink-primary" : "text-ink-secondary"
                    )}
                  >
                    <Icon className="h-4 w-4" strokeWidth={1.5} />
                    {label}
                  </Link>
                );
              })}
              <button
                onClick={() => logout()}
                className="inline-flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-ink-secondary text-left"
              >
                <LogOut className="h-4 w-4" strokeWidth={1.5} />
                Log out
              </button>
            </nav>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-5 lg:px-8 py-10">{children}</main>
    </div>
  );
}

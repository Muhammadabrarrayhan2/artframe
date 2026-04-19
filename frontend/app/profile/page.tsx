"use client";

import toast from "react-hot-toast";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-store";
import { api } from "@/lib/api";
import { LogOut, ShieldX, Mail, CheckCircle2, Calendar } from "lucide-react";
import { formatDate } from "@/lib/utils";

export default function ProfilePage() {
  return (
    <ProtectedRoute>
      <AppShell>
        <ProfileInner />
      </AppShell>
    </ProtectedRoute>
  );
}

function ProfileInner() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);

  async function onLogoutAll() {
    if (!confirm("Revoke ALL active sessions across every device?")) return;
    try {
      await api.logoutAll();
      toast.success("All sessions revoked");
      logout();
    } catch {
      toast.error("Could not revoke sessions");
    }
  }

  if (!user) return null;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="label mb-2">Profile</div>
      <h1 className="text-display text-4xl md:text-5xl tracking-[-0.025em] mb-10">
        Your <span className="italic text-accent-amber">account</span>
      </h1>

      <div className="card-elevated p-8 mb-6">
        <div className="flex items-center gap-5 mb-8 pb-8 border-b border-border-subtle">
          <div className="h-16 w-16 rounded-full bg-accent-amber/10 border border-accent-amber/30 flex items-center justify-center text-2xl font-display text-accent-amber">
            {user.name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <h2 className="text-2xl font-display tracking-tight">{user.name}</h2>
            <div className="text-sm text-ink-secondary flex items-center gap-2 mt-1">
              <Mail className="h-3.5 w-3.5" strokeWidth={1.5} />
              {user.email}
              {user.is_verified && (
                <span className="tag bg-signal-real/10 border-signal-real/30 text-signal-real !text-[10px] !px-1.5 !py-0.5">
                  <CheckCircle2 className="h-2.5 w-2.5" strokeWidth={2} /> verified
                </span>
              )}
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-y-5 gap-x-8 text-sm">
          <Row label="Account ID" value={`#${user.id}`} />
          <Row label="Role" value={user.role} />
          <Row
            label="Joined"
            value={
              <span className="inline-flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5 text-ink-tertiary" strokeWidth={1.5} />
                {formatDate(user.created_at)}
              </span>
            }
          />
          <Row label="Status" value={user.is_verified ? "Active" : "Unverified"} />
        </dl>
      </div>

      {/* Security */}
      <div className="card p-6">
        <h3 className="font-medium text-ink-primary mb-1">Security & sessions</h3>
        <p className="text-xs text-ink-secondary mb-5">
          Signing out will invalidate the current session on the server — the back button cannot recover
          this tab.
        </p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => logout()} className="btn-secondary">
            <LogOut className="h-4 w-4" /> Log out
          </button>
          <button onClick={onLogoutAll} className="btn-secondary text-signal-ai hover:bg-signal-ai/10">
            <ShieldX className="h-4 w-4" /> Log out everywhere
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="label mb-1.5">{label}</dt>
      <dd className="text-ink-primary">{value}</dd>
    </div>
  );
}

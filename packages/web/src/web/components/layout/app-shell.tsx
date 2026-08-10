import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  Bell,
  Database,
  LogOut,
  Menu,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authClient, ROLE_LABELS } from "../../lib/auth";
import { useMarkNotificationsRead, useMe, useNotifications, useSeedDemo } from "../../queries/session";
import { useIdleLogout } from "../../hooks/use-idle-logout";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Spinner } from "../ui/feedback";
import { visibleNav } from "./nav";
import { CommandPalette } from "./command-palette";

/**
 * The Skillton wordmark spans the full sidebar width — the old split of a square
 * mark plus a text lockup is merged into one image so the logo reads at a glance.
 */
function Brand() {
  return (
    <Link to="/dashboard" className="block w-full" aria-label="Skillton — go to dashboard">
      <img
        src="/images/skillton-wordmark.png"
        alt="Skillton"
        className="h-auto w-[58%] max-w-[96px] lg:w-[58%] lg:max-w-[124px]"
      />
    </Link>
  );
}

function SidebarContent({ role, onNavigate }: { role?: string; onNavigate?: () => void }) {
  const [location] = useLocation();
  const groups = visibleNav(role);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center border-b border-border px-4">
        <Brand />
      </div>
      <nav className="no-scrollbar flex-1 overflow-y-auto px-3 py-4">
        {groups.map((group) => (
          <div key={group.label} className="mb-5">
            <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = location === item.href || location.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                      active
                        ? "bg-primary/12 text-primary-light"
                        : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                    )}
                  >
                    {active && (
                      <span className="absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-primary" />
                    )}
                    <item.icon className={cn("size-4 shrink-0", active && "text-primary")} />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </div>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const notifications = useNotifications();
  const markRead = useMarkNotificationsRead();
  const unread = (notifications.data ?? []).filter((n) => !n.isRead).length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open && unread > 0) markRead.mutate({});
        }}
        className="relative grid size-9 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-border-hover hover:text-foreground"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="num absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <button type="button" aria-label="Close" className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="glass absolute right-0 top-11 z-50 w-80 rounded-xl p-1.5 shadow-2xl">
            <p className="px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Notifications
            </p>
            <div className="max-h-80 overflow-y-auto">
              {notifications.isLoading && (
                <div className="flex justify-center py-6">
                  <Spinner />
                </div>
              )}
              {!notifications.isLoading && (notifications.data ?? []).length === 0 && (
                <p className="px-2.5 py-6 text-center text-[13px] text-muted-foreground">Nothing yet.</p>
              )}
              {(notifications.data ?? []).map((n) => (
                <div key={n.id} className="rounded-lg px-2.5 py-2 hover:bg-white/[0.04]">
                  <p className="text-[13px] font-medium">{n.title}</p>
                  {n.body && <p className="text-[12px] leading-snug text-muted-foreground">{n.body}</p>}
                  <p className="num mt-1 text-[10px] text-muted-foreground/70">
                    {new Date(n.createdAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function UserMenu({ name, email, role, image }: { name: string; email: string; role: string; image?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-lg border border-border py-1 pl-1 pr-2.5 transition-colors hover:border-border-hover"
      >
        {image ? (
          <img src={image} alt={name} className="size-7 rounded-md object-cover" />
        ) : (
          <span className="grid size-7 place-items-center rounded-md bg-primary/15 text-[12px] font-semibold text-primary-light">
            {name.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-[12px] font-medium">{name.split(" ")[0]}</span>
          <span className="block text-[10px] text-muted-foreground">{ROLE_LABELS[role] ?? role}</span>
        </span>
      </button>
      {open && (
        <>
          <button type="button" aria-label="Close" className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="glass absolute right-0 top-11 z-50 w-60 rounded-xl p-1.5 shadow-2xl">
            <div className="px-2.5 py-2">
              <p className="truncate text-[13px] font-medium">{name}</p>
              <p className="truncate text-[11px] text-muted-foreground">{email}</p>
              <Badge tone="primary" className="mt-2">
                {ROLE_LABELS[role] ?? role}
              </Badge>
            </div>
            <div className="hairline my-1" />
            <button
              type="button"
              onClick={() => authClient.signOut().then(() => window.location.assign("/"))}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"
            >
              <LogOut className="size-4" /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Nudge for an empty workspace — one click loads a realistic demo pipeline. */
function SeedDemoButton() {
  const seed = useSeedDemo();
  return (
    <Button size="sm" variant="outline" onClick={() => seed.mutate({ force: false })} disabled={seed.isPending}>
      {seed.isPending ? <Spinner /> : <Database className="size-3.5" />}
      Load demo data
    </Button>
  );
}

/**
 * Idle auto-logout banner. Rendered inside the shell so it only runs for a
 * signed-in user, and so it can read the agency's configured idle window.
 */
function IdleGuard({ idleMinutes }: { idleMinutes: number }) {
  const { secondsLeft, stayActive } = useIdleLogout(idleMinutes);
  if (secondsLeft == null) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex flex-wrap items-center justify-center gap-3 border-b border-warning/40 bg-warning/15 px-4 py-2 text-[13px] backdrop-blur">
      <span className="text-warning">
        You will be signed out in <span className="num font-semibold">{secondsLeft}s</span> due to inactivity.
      </span>
      <button
        type="button"
        onClick={stayActive}
        className="rounded-md border border-warning/50 px-2.5 py-1 text-[12px] font-medium text-warning transition-colors hover:bg-warning/20"
      >
        Stay signed in
      </button>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [, navigate] = useLocation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!me.authPending && !me.isSignedIn) navigate("/");
  }, [me.authPending, me.isSignedIn, navigate]);

  if (me.authPending || (me.isSignedIn && me.isLoading)) {
    return (
      <div className="app-bg grid min-h-screen place-items-center">
        <div className="flex flex-col items-center gap-3">
          <Spinner className="size-6 text-primary" />
          <p className="text-[13px] text-muted-foreground">Loading your workspace…</p>
        </div>
      </div>
    );
  }

  if (!me.isSignedIn) return null;

  const data = me.data && "user" in me.data ? me.data : null;
  const user = data?.user;

  return (
    <div className="app-bg min-h-screen">
      <IdleGuard idleMinutes={data && "settings" in data ? data.settings.sessionIdleMinutes : 0} />
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[228px] border-r border-border bg-[#0f0f0f]/80 backdrop-blur-xl lg:block">
        <SidebarContent role={user?.role} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[248px] border-r border-border bg-[#0f0f0f]">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-3 grid size-8 place-items-center rounded-lg border border-border text-muted-foreground"
            >
              <X className="size-4" />
            </button>
            <SidebarContent role={user?.role} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-[228px]">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-[#0d0d0d]/85 px-4 backdrop-blur-xl sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="grid size-9 place-items-center rounded-lg border border-border text-muted-foreground lg:hidden"
          >
            <Menu className="size-4" />
          </button>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 flex-1 items-center gap-2 rounded-lg border border-border bg-white/[0.02] px-3 text-left text-[13px] text-muted-foreground transition-colors hover:border-border-hover sm:max-w-sm"
          >
            <Search className="size-3.5" />
            <span className="flex-1 truncate">Search candidates, jobs, pages…</span>
            <kbd className="num hidden rounded border border-border bg-white/[0.04] px-1.5 text-[10px] sm:block">
              ⌘K
            </kbd>
          </button>

          <div className="ml-auto flex items-center gap-2">
            <Link
              to="/copilot"
              className="hidden h-9 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 text-[13px] font-medium text-primary-light transition-colors hover:bg-primary/15 sm:flex"
            >
              <Sparkles className="size-3.5" /> Copilot
            </Link>
            <NotificationBell />
            {user && <UserMenu name={user.name} email={user.email} role={user.role} image={user.image} />}
          </div>
        </header>

        <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

export { SeedDemoButton };

import type { ReactNode } from "react";
import { AlertTriangle, CircleCheck, CircleX, Inbox, LoaderCircle } from "lucide-react";

export function MoneyDisplay({ amount, compact = false }: { amount: number | bigint; compact?: boolean }) {
  const value = typeof amount === "bigint" ? Number(amount) : amount;
  const formatted = new Intl.NumberFormat("fr-FR", {
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: 0
  }).format(value);
  return <span className="money">{formatted} <span aria-label="Ryôs">Ryō</span></span>;
}

export function PointDisplay({ points }: { points: number }) {
  return <span className="points">{new Intl.NumberFormat("fr-FR").format(points)} <small>pts</small></span>;
}

const statusLabels = {
  paid: "À jour",
  due: "À payer",
  overdue: "En retard",
  warning: "À surveiller",
  pending: "En attente",
  draft: "Brouillon"
} as const;

export function StatusBadge({ status, children }: { status: keyof typeof statusLabels; children?: ReactNode }) {
  const Icon = status === "paid" ? CircleCheck : status === "overdue" ? CircleX : AlertTriangle;
  return <span className={`status-badge status-${status}`}><Icon size={13} aria-hidden="true" />{children ?? statusLabels[status]}</span>;
}

export function GradeBadge({ children }: { children: ReactNode }) {
  return <span className="grade-badge">{children}</span>;
}

export function NinjaAvatar({ name, image }: { name: string; image?: string | null }) {
  const initials = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return image ? <img className="avatar" src={image} alt="" /> : <span className="avatar avatar-fallback" aria-hidden="true">{initials}</span>;
}

export function MetricCard({ label, value, detail, tone = "neutral" }: { label: string; value: ReactNode; detail: string; tone?: "neutral" | "good" | "warn" | "danger" }) {
  return <article className={`metric-card tone-${tone}`}><div className="metric-label">{label}</div><div className="metric-value">{value}</div><p>{detail}</p></article>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string | undefined; title: string; description: string; actions?: ReactNode }) {
  return <header className="page-header"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1><p>{description}</p></div>{actions && <div className="page-actions">{actions}</div>}</header>;
}

export function SectionHeader({ title, description, action }: { title: string; description?: string | undefined; action?: ReactNode }) {
  return <div className="section-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="state-panel"><Inbox aria-hidden="true" /><h3>{title}</h3><p>{description}</p></div>;
}

export function LoadingState({ label = "Chargement" }: { label?: string }) {
  return <div className="state-panel" aria-live="polite"><LoaderCircle className="spin" aria-hidden="true" /><p>{label}…</p></div>;
}

export function ErrorState({ title = "Une erreur est survenue", description }: { title?: string; description: string }) {
  return <div className="state-panel state-error" role="alert"><CircleX aria-hidden="true" /><h3>{title}</h3><p>{description}</p></div>;
}

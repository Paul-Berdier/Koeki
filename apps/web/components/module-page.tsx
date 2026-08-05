import type { ReactNode } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { MetricCard, PageHeader, SectionHeader } from "@koeki/ui";

export function ModulePage({ eyebrow, title, description, actionLabel, actionHref, registerTitle = "Registre courant", registerDescription, registerAction, metrics, children, aside }: {
  eyebrow: string; title: string; description: string; actionLabel?: string | undefined; actionHref?: string | undefined;
  registerTitle?: string | undefined; registerDescription?: string | undefined; registerAction?: ReactNode;
  metrics: Array<{ label: string; value: ReactNode; detail: string; tone?: "neutral" | "good" | "warn" | "danger" }>;
  children: ReactNode; aside?: ReactNode | undefined;
}) {
  return <div className="page-wrap">
    <PageHeader eyebrow={eyebrow} title={title} description={description} actions={actionLabel && actionHref && <Link className="button button-primary" href={actionHref}><Plus size={17} />{actionLabel}</Link>} />
    <section className="metric-grid">{metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}</section>
    {/* The register table gets the full width — dense tables were being squeezed by a side column. */}
    <section className="panel module-panel stack-panel"><SectionHeader title={registerTitle} description={registerDescription} action={registerAction} />{children}</section>
    {aside}
  </div>;
}

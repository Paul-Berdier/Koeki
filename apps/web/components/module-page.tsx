import type { ReactNode } from "react";
import { ArrowRight, Plus } from "lucide-react";
import { MetricCard, PageHeader, SectionHeader } from "@koeki/ui";

export function ModulePage({ eyebrow, title, description, actionLabel, metrics, children, aside }: {
  eyebrow: string; title: string; description: string; actionLabel?: string;
  metrics: Array<{ label: string; value: ReactNode; detail: string; tone?: "neutral" | "good" | "warn" | "danger" }>;
  children: ReactNode; aside?: ReactNode;
}) {
  return <div className="page-wrap">
    <PageHeader eyebrow={eyebrow} title={title} description={description} actions={actionLabel && <button className="button button-primary"><Plus size={17} />{actionLabel}</button>} />
    <section className="metric-grid">{metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}</section>
    <div className={aside ? "module-grid" : undefined}><section className="panel module-panel"><SectionHeader title="Registre courant" description="Données fictives de démonstration" action={<button className="text-link">Tout consulter <ArrowRight size={15} /></button>} />{children}</section>{aside}</div>
  </div>;
}

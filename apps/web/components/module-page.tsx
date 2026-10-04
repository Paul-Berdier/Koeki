import type { ReactNode } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader, SectionHeader } from "@koeki/ui";

export function ModulePage({
  eyebrow,
  title,
  description,
  actionLabel,
  actionHref,
  registerTitle,
  registerDescription,
  registerAction,
  metrics,
  children,
  aside,
  beforeRegister,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actionLabel?: string | undefined;
  actionHref?: string | undefined;
  registerTitle?: string | undefined;
  registerDescription?: string | undefined;
  registerAction?: ReactNode;
  metrics: Array<{
    label: string;
    value: ReactNode;
    detail: string;
    tone?: "neutral" | "good" | "warn" | "danger";
  }>;
  children: ReactNode;
  aside?: ReactNode | undefined;
  beforeRegister?: ReactNode;
}) {
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={
          actionLabel &&
          actionHref && (
            <Link className="button button-primary" href={actionHref}>
              <Plus size={17} aria-hidden="true" />
              {actionLabel}
            </Link>
          )
        }
        metrics={metrics.map((metric) => ({
          label: metric.label,
          value: (
            <>
              <span className={`tone-${metric.tone ?? "neutral"}`}>
                {metric.value}
              </span>
              <small className="metric-context">{metric.detail}</small>
            </>
          ),
        }))}
      />
      {beforeRegister}
      {/* The register table gets the full width — dense tables were being squeezed by a side column. */}
      <section className="panel module-panel stack-panel">
        {registerTitle || registerDescription ? (
          <SectionHeader
            title={registerTitle ?? "Liste"}
            description={registerDescription}
            action={registerAction}
          />
        ) : registerAction ? (
          <div className="filter-bar">{registerAction}</div>
        ) : null}
        {children}
      </section>
      {aside}
    </div>
  );
}

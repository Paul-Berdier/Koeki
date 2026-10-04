import Link from "next/link";
import { formatReportDate, shiftReportDate } from "@/lib/report-period";

export function TeamPeriod({
  from,
  to,
  action,
  view,
}: {
  from: string;
  to: string;
  action: string;
  view?: string | undefined;
}) {
  const today = formatReportDate(new Date());
  return (
    <div className="period-control">
      <div className="period-presets" aria-label="Périodes rapides">
        {[7, 30, 90].map((days) => {
          const start = shiftReportDate(today, -(days - 1));
          return (
            <Link
              key={days}
              className={
                from === start && to === today ? "selected" : undefined
              }
              href={`${action}?${new URLSearchParams({ du: start, au: today, ...(view ? { vue: view } : {}) })}`}
            >
              {days} jours
            </Link>
          );
        })}
      </div>
      <form action={action} method="get">
        <label>
          Du
          <input
            type="date"
            name="du"
            defaultValue={from}
            key={`from-${from}`}
            required
          />
        </label>
        <label>
          Au
          <input
            type="date"
            name="au"
            defaultValue={to}
            key={`to-${to}`}
            required
          />
        </label>
        {view && <input type="hidden" name="vue" value={view} />}
        <button className="button button-ghost">Actualiser</button>
      </form>
    </div>
  );
}

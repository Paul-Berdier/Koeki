"use client";

import { useEffect, useId, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalyticsDay, TeamAnalytics } from "@/lib/team-analytics";
import Link from "next/link";

const series = [
  { key: "payments", label: "Paiements", color: "#345f4b" },
  { key: "donations", label: "Dons", color: "#a87924" },
  { key: "buybacks", label: "Rachats", color: "#6479a1" },
] as const;

export function ActivityChart({ days }: { days: AnalyticsDay[] }) {
  const id = useId();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  const [visible, setVisible] = useState<string[]>(
    series.map((item) => item.key),
  );
  const totals = series.map((item) => ({
    ...item,
    count: days.reduce((sum, day) => sum + day[item.key], 0),
  }));
  return (
    <div className="activity-chart">
      <div className="chart-legend" aria-label="Séries affichées">
        {totals.map((item) => (
          <button
            type="button"
            key={item.key}
            aria-pressed={visible.includes(item.key)}
            onClick={() =>
              setVisible((current) =>
                current.includes(item.key)
                  ? current.filter((key) => key !== item.key)
                  : [...current, item.key],
              )
            }
          >
            <i style={{ background: item.color }} aria-hidden="true" />
            <span>{item.label}</span>
            <strong>{item.count}</strong>
          </button>
        ))}
      </div>
      <div
        className="chart-canvas"
        role="group"
        aria-label="Courbe des opérations validées par jour"
        aria-describedby={id}
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
          minHeight={250}
          initialDimension={{ width: 680, height: 250 }}
        >
          <LineChart
            data={days}
            margin={{ top: 18, right: 20, left: -20, bottom: 0 }}
            accessibilityLayer
          >
            <CartesianGrid
              vertical={false}
              stroke="#e7ebe2"
              strokeDasharray="4 5"
            />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              minTickGap={36}
              tickMargin={12}
              stroke="#626d64"
              fontSize={12}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              tickMargin={10}
              stroke="#626d64"
              fontSize={12}
              domain={[0, (maximum: number) => Math.max(1, maximum)]}
            />
            <Tooltip
              contentStyle={{
                border: "1px solid #dce2d5",
                borderRadius: 10,
                background: "#fff",
                color: "#253b2e",
                fontSize: 13,
              }}
              itemStyle={{ color: "#253b2e" }}
              labelFormatter={(_label, payload) => {
                const date = payload?.[0]?.payload?.date as string | undefined;
                return date
                  ? new Date(`${date}T12:00:00Z`).toLocaleDateString("fr-FR", {
                      timeZone: "Europe/Paris",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })
                  : "";
              }}
            />
            {series
              .filter((item) => visible.includes(item.key))
              .map((item) => (
                <Line
                  key={item.key}
                  type="linear"
                  dataKey={item.key}
                  name={item.label}
                  stroke={item.color}
                  strokeWidth={2.5}
                  dot={days.length <= 7 ? { r: 3 } : false}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
              ))}
          </LineChart>
        </ResponsiveContainer>
        {!visible.length && (
          <p className="chart-message">
            Sélectionnez une série pour afficher sa courbe.
          </p>
        )}
      </div>
      <p id={id} className="chart-caption">
        {days.reduce((sum, day) => sum + day.total, 0)} opérations sur{" "}
        {days.length} jours · jours calendaires, Europe/Paris. Cliquez sur une
        légende pour afficher ou masquer sa courbe.
      </p>
      {/* Native details can toggle before React hydrates. Keep the initial DOM
          stable until the effect runs; do not suppress hydration diagnostics. */}
      <details className="chart-data" inert={!hydrated}>
        <summary>Voir les données de la courbe</summary>
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Données quotidiennes"
        >
          <table>
            <thead>
              <tr>
                <th>Date</th>
                {series.map((item) => (
                  <th key={item.key} className="num">
                    {item.label}
                  </th>
                ))}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date}>
                  <td>{day.date}</td>
                  <td className="num">{day.payments}</td>
                  <td className="num">{day.donations}</td>
                  <td className="num">{day.buybacks}</td>
                  <td className="num">{day.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export function WorkloadChart({
  rows,
  from,
  to,
}: {
  rows: TeamAnalytics["workload"];
  from: string;
  to: string;
}) {
  const [metric, setMetric] = useState<"tasksOpen" | "dossiers">("tasksOpen");
  const sorted = [...rows]
    .sort((a, b) => b[metric] - a[metric] || a.name.localeCompare(b.name, "fr"))
    .slice(0, 6);
  const maximum = Math.max(1, ...sorted.map((row) => row[metric]));
  const period = new URLSearchParams({ du: from, au: to });
  return (
    <div className="workload-chart">
      <div className="segmented-control" aria-label="Charge à comparer">
        <button
          type="button"
          aria-pressed={metric === "tasksOpen"}
          onClick={() => setMetric("tasksOpen")}
        >
          Tâches ouvertes
        </button>
        <button
          type="button"
          aria-pressed={metric === "dossiers"}
          onClick={() => setMetric("dossiers")}
        >
          Dossiers actifs
        </button>
      </div>
      <ul>
        {sorted.map((row) => (
          <li key={row.id}>
            <div>
              <Link href={`/equipe/${row.id}?${period}`}>{row.name}</Link>
              <strong>{row[metric]}</strong>
            </div>
            <div className="load-track" aria-hidden="true">
              <span style={{ width: `${(row[metric] / maximum) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {!rows.length && <p className="muted">Aucun agent à afficher.</p>}
      <p className="chart-caption">
        Situation actuelle · jusqu’à 6 agents les plus chargés. La charge ne
        mesure pas la difficulté des dossiers.
      </p>
    </div>
  );
}

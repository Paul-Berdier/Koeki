import Link from "next/link";
import { ArrowLeft, FilePlus2 } from "lucide-react";
import { PageHeader, SectionHeader } from "@koeki/ui";
import { demoMode, requirePermission } from "@/lib/session";
import { createReport } from "../actions";

export default async function NewReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("reports:write");
  const query = await searchParams;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 6 * 86_400_000);
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  return <div className="page-wrap">
    <PageHeader eyebrow="Suivi des agents" title="Nouveau rapport" description="Les totaux (paiements, dons, rachats, corrections) sont calculés automatiquement depuis vos écritures sur la période."
      actions={<Link className="button button-ghost" href="/reports"><ArrowLeft size={17} /> Rapports</Link>} />
    {error && <p className="notice error" role="alert">{error}</p>}
    {demoMode ? <p className="notice" role="status">Mode démonstration : les écritures sont désactivées.</p> : <section className="panel" style={{ maxWidth: 680 }}>
      <SectionHeader title="Période et contenu" description="Un seul rapport par agent et par période" />
      <form action={createReport} className="form-grid">
        <div className="form-row">
          <label>Début de période<input type="date" name="periodStart" required defaultValue={iso(weekAgo)} /></label>
          <label>Fin de période<input type="date" name="periodEnd" required defaultValue={iso(today)} /></label>
        </div>
        <label>Résumé de la période *<textarea name="summary" required minLength={10} maxLength={4000} placeholder="Activité générale, points marquants…" /></label>
        <label>Incidents<textarea name="incidents" maxLength={4000} /></label>
        <label>Problèmes de stock<textarea name="stockIssues" maxLength={4000} /></label>
        <label>Actions à suivre<textarea name="followUps" maxLength={4000} /></label>
        <div className="form-actions">
          <button className="button button-ghost" type="submit" name="intent" value="draft">Enregistrer en brouillon</button>
          <button className="button button-primary" type="submit" name="intent" value="submit"><FilePlus2 size={16} /> Soumettre au responsable</button>
        </div>
      </form>
    </section>}
  </div>;
}

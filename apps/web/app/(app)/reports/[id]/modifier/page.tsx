import Link from "next/link";
import { ArrowLeft, Send } from "lucide-react";
import { redirect } from "next/navigation";
import { prisma } from "@koeki/database";
import { PageHeader, SectionHeader } from "@koeki/ui";
import { formatReportDate } from "@/lib/report-period";
import { demoMode, requirePermission } from "@/lib/session";
import { updateReport } from "../../actions";

export default async function EditReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePermission("reports:write");
  if (demoMode) redirect("/reports");
  const { id } = await params;
  const query = await searchParams;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const report = await prisma.agentReport.findFirst({ where: { id, authorId: session.userId, status: { in: ["DRAFT", "RETURNED"] } } });
  if (!report) redirect("/reports?erreur=Ce%20rapport%20ne%20peut%20pas%20%C3%AAtre%20modifi%C3%A9");
  const returned = report.status === "RETURNED";

  return <div className="page-wrap">
    <PageHeader eyebrow="Suivi des agents" title={returned ? "Corriger le rapport" : "Modifier le brouillon"} description={returned ? "Apportez les corrections demandées puis soumettez à nouveau le rapport." : "Vous pouvez enregistrer vos changements ou soumettre le rapport au responsable."}
      actions={<Link className="button button-ghost" href="/reports"><ArrowLeft size={17} /> Rapports</Link>} />
    {error && <p className="notice error" role="alert">{error}</p>}
    {returned && <p className="notice" role="status">Ce rapport a été renvoyé par un responsable. Il restera marqué « Renvoyé » tant qu’il n’est pas soumis à nouveau.</p>}
    <section className="panel" style={{ maxWidth: 680 }}>
      <SectionHeader title="Période et contenu" description="Les totaux seront recalculés lors de l’enregistrement" />
      <form action={updateReport} className="form-grid">
        <input type="hidden" name="reportId" value={report.id} />
        <div className="form-row">
          <label>Début de période<input type="date" name="periodStart" required defaultValue={formatReportDate(report.periodStart)} /></label>
          <label>Fin de période<input type="date" name="periodEnd" required defaultValue={formatReportDate(report.periodEnd)} /></label>
        </div>
        <label>Résumé de la période *<textarea name="summary" required minLength={10} maxLength={4000} defaultValue={report.summary} /></label>
        <label>Incidents<textarea name="incidents" maxLength={4000} defaultValue={report.incidents ?? ""} /></label>
        <label>Problèmes de stock<textarea name="stockIssues" maxLength={4000} defaultValue={report.stockIssues ?? ""} /></label>
        <label>Actions à suivre<textarea name="followUps" maxLength={4000} defaultValue={report.followUps ?? ""} /></label>
        <div className="form-actions">
          <button className="button button-ghost" type="submit" name="intent" value="draft">Enregistrer les modifications</button>
          <button className="button button-primary" type="submit" name="intent" value="submit"><Send size={16} /> {returned ? "Soumettre à nouveau" : "Soumettre au responsable"}</button>
        </div>
      </form>
    </section>
  </div>;
}

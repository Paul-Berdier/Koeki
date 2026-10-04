import { ActionForm } from "@/components/action-form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MoneyDisplay, PageHeader } from "@koeki/ui";
import { getReportReviewData } from "@/lib/report-service";
import { hasPermission, requirePermission } from "@/lib/session";
import { agentName } from "@/lib/team-service";
import { reviewReport } from "../actions";

function ReviewedContent({ snapshot }: { snapshot: unknown }) {
  const value = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot as Record<string, unknown> : {};
  const text = (key: string) => typeof value[key] === "string" ? value[key] as string : "Non renseigné";
  const number = (key: string) => typeof value[key] === "number" ? String(value[key]) : "Inconnu";
  return <div><h4>Résumé examiné</h4><p style={{ whiteSpace: "pre-wrap" }}>{text("summary")}</p><h4>Incidents</h4><p>{text("incidents")}</p><h4>Stocks</h4><p>{text("stockIssues")}</p><h4>Suivi demandé</h4><p>{text("followUps")}</p><p>{number("paymentCount")} paiements · {number("donationCount")} dons · {number("buybackCount")} rachats</p></div>;
}

export default async function ReportDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requirePermission("reports:read");
  const { id } = await params, query = await searchParams;
  const report = await getReportReviewData(session, id);
  if (!report) notFound();
  const date = (value: Date | null) => value ? value.toLocaleString("fr-FR", { timeZone: "Europe/Paris" }) : "Date historique inconnue";
  return <div className="page-wrap"><PageHeader eyebrow="Rapports" title={`Rapport de ${agentName(report.author)}`} description={`Version ${report.version} · ${report.status} · du ${date(report.periodStart)} au ${date(report.periodEnd)}`} actions={<Link className="button button-ghost" href="/reports">Tous les rapports</Link>} />
    {query.erreur && <p className="notice error" role="alert">{query.erreur}</p>}
    <section className="panel"><h2>Synthèse de la période</h2><p>Soumission : {date(report.submittedAt)} · Décision : {date(report.decidedAt)}</p><p>{report.paymentCount} paiements · {report.donationCount} dons · {report.buybackCount} rachats · Encaissements : <MoneyDisplay amount={report.collectedAmount} /></p><p>Ces totaux sont un instantané ; ils ne constituent pas le score du classement.</p>{report.correctedSources > 0 && <p className="notice">Des corrections concernent les opérations de cette période. Les totaux approuvés sont conservés.</p>}<h3>Résumé</h3><p style={{ whiteSpace: "pre-wrap" }}>{report.summary}</p><h3>Incidents</h3><p>{report.incidents || "Aucun incident signalé"}</p><h3>Stocks</h3><p>{report.stockIssues || "Aucun problème signalé"}</p><h3>Actions à suivre</h3><p>{report.followUps || "Aucun suivi demandé"}</p>{hasPermission(session, "tasks:manage") && <Link className="button button-ghost" href={`/taches?reportId=${report.id}`}>Créer une tâche liée à ce rapport</Link>}</section>
    <section className="panel"><h2>Historique des avis</h2>{report.reviews.length ? report.reviews.map((review) => <article key={review.id}><h3>{review.decision === "RETURNED" ? "Correction demandée" : "Approuvé"} · version {review.reportVersion}</h3><p>{date(review.createdAt)} · responsable {review.reviewerName}</p><p>{review.comment || "Sans commentaire complémentaire"}</p><details><summary>Contenu examiné</summary><ReviewedContent snapshot={review.contentSnapshot} /></details></article>) : <p>Aucun avis enregistré. Les décisions antérieures à la migration ne sont pas reconstituées sans preuve.</p>}</section>
    {report.authorId === session.userId && ["DRAFT", "RETURNED"].includes(report.status) && <Link className="button button-primary" href={`/reports/${id}/modifier`}>Corriger mon rapport</Link>}
    {hasPermission(session, "reports:review") && report.authorId !== session.userId && report.status === "SUBMITTED" && <section className="panel"><h2>Examiner cette version</h2><ActionForm action={reviewReport} className="form-grid"><input type="hidden" name="reportId" value={id} /><input type="hidden" name="version" value={report.version} /><label>Avis du responsable<textarea name="comment" maxLength={4000} placeholder="Indiquez précisément les éléments à corriger (obligatoire pour un retour)." /></label><div className="form-actions"><button name="intent" value="approve" className="button button-primary">Approuver</button><button name="intent" value="return" className="button button-ghost">Demander une correction</button></div></ActionForm></section>}
  </div>;
}

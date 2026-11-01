import Link from "next/link";
import { MoneyDisplay, PageHeader } from "@koeki/ui";
import { rankingWeekAt } from "@koeki/domain";
import { getRankingContribution } from "@/lib/ranking-service";

const date = (value: Date | null) => value?.toLocaleString("fr-FR", { timeZone: "Europe/Paris" }) ?? "Inconnue";
const statuses: Record<string, string> = { VALIDATED: "Validée", PENDING: "En attente", PENDING_APPROVAL: "À approuver", DRAFT: "Brouillon", REVERSED: "Inversée", CANCELLED: "Annulée" };
const origins: Record<string, string> = { BUSINESS: "Opération métier", SELF_DECLARED: "Déclaration personnelle", IMPORT: "Import historique", UNKNOWN: "Origine non établie" };

export default async function RankingContributionPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const contribution = await getRankingContribution(kind, id);
  const provenValidation = contribution.firstValidatedAt && ["SERVER", "AUDIT_BACKFILL"].includes(contribution.validationEvidence ?? "");
  const week = provenValidation ? rankingWeekAt(contribution.firstValidatedAt!).key : null;
  return <div className="page-wrap">
    <PageHeader eyebrow="Journal des opérations" title={contribution.receiptNumber} description="Les dates et l’attribution connues de cette opération, y compris lorsqu’elle est exclue du classement." />
    <div className="page-actions">
      <Link className="button button-ghost" href={`/classement/agents/${contribution.historyUserId}`}>← Historique de l’agent</Link>
      <Link className="button button-ghost" href={week ? `/classement?semaine=${week}` : "/classement"}>Classement {week ?? "hebdomadaire"}</Link>
    </div>
    <section className="panel panel-body">
      <dl>
        <dt>Référence stable</dt><dd>{contribution.id}</dd>
        <dt>Type</dt><dd>{kind === "PAYMENT" ? "Paiement fiscal" : kind === "BUYBACK" ? "Rachat" : "Don"}</dd>
        <dt>{contribution.recordedById ? "Auteur enregistré" : "Agent associé"}</dt><dd>{contribution.authorName}{!contribution.recordedById && " · Auteur d’origine non établi"}</dd>
        <dt>Montant</dt><dd><MoneyDisplay amount={contribution.amount} /></dd>
        <dt>État courant</dt><dd>{statuses[contribution.status] ?? contribution.status}</dd>
        <dt>Enregistrement</dt><dd>{date(contribution.createdAt)}</dd>
        <dt>Date de validation enregistrée</dt><dd>{date(contribution.validatedAt)}</dd>
        <dt>Première validation prouvée</dt><dd>{provenValidation ? date(contribution.firstValidatedAt) : "Inconnue — exclue du classement officiel"}</dd>
        <dt>Preuve</dt><dd>{contribution.validationEvidence === "SERVER" ? "Horodatage serveur" : contribution.validationEvidence === "AUDIT_BACKFILL" ? "Date historique corroborée par une trace métier" : "Historique incomplet"}</dd>
        <dt>Origine</dt><dd>{origins[contribution.operationOrigin] ?? "Origine non établie"}</dd>
      </dl>
      {contribution.canReadNinja && <Link className="button button-secondary" href={`/ninjas/${contribution.ninjaId}`}>Ouvrir le dossier de l’opération</Link>}
      <p>La date d’enregistrement ou une date de validation isolée ne prouve pas la première validation. Les imports, les opérations inversées et les opérations sans participation établie à cette date sont exclus du classement.</p>
      <p>Une inversion après clôture s’applique à la semaine d’origine ; sa version publiée reste consultable.</p>
    </section>
  </div>;
}

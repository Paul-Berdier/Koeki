import Link from "next/link";
import { MoneyDisplay, PageHeader } from "@koeki/ui";
import { rankingWeekAt } from "@koeki/domain";
import { getRankingContribution } from "@/lib/ranking-service";

export default async function RankingContributionPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const contribution = await getRankingContribution(kind, id);
  const week = contribution.firstValidatedAt ? rankingWeekAt(contribution.firstValidatedAt).key : null;
  return <div className="page-wrap"><PageHeader eyebrow="Source métier" title={contribution.receiptNumber} description="Référence, auteur et première validation conservés pour vérifier le classement." />
    <Link className="button button-ghost" href={week ? `/classement?semaine=${week}` : "/classement"}>← Retour au classement</Link>
    <section className="panel panel-body"><dl><dt>Référence stable</dt><dd>{contribution.id}</dd><dt>Type</dt><dd>{kind === "PAYMENT" ? "Paiement fiscal" : kind === "BUYBACK" ? "Rachat" : "Don"}</dd><dt>Auteur métier (compte)</dt><dd>{contribution.recordedById ?? "Auteur historique inconnu"}</dd><dt>Montant</dt><dd><MoneyDisplay amount={contribution.amount} /></dd><dt>État courant</dt><dd>{contribution.status}</dd><dt>Première validation</dt><dd>{contribution.firstValidatedAt?.toLocaleString("fr-FR", { timeZone: "Europe/Paris" }) ?? "Inconnue — exclue du classement officiel"}</dd><dt>Preuve</dt><dd>{contribution.validationEvidence === "SERVER" ? "Horodatage serveur" : contribution.validationEvidence === "AUDIT_BACKFILL" ? "Date historique corroborée par une trace métier" : "Historique incomplet"}</dd><dt>Origine</dt><dd>{contribution.operationOrigin}</dd></dl>{contribution.canReadNinja && <Link className="button button-secondary" href={`/ninjas/${contribution.ninjaId}`}>Ouvrir le dossier de l’opération</Link>}<p>Une inversion après clôture s’applique à la semaine d’origine ; sa version publiée reste consultable.</p></section>
  </div>;
}

import Link from "next/link";
import { PageHeader, SectionHeader } from "@koeki/ui";
import { hasPermission, requirePermission } from "@/lib/session";

export default async function OperationsPage() {
  const session = await requirePermission("business:read");
  const write = hasPermission(session, "payments:write");
  return <div className="page-wrap">
    <PageHeader eyebrow="Comptoir de Suna" title="Opérations" description="Choisissez une démarche. Les montants, points et crédits sont calculés par le service au moment de la validation." />
    <div className="workflow-grid">
      <Link className="workflow-card" href="/ninjas"><strong>{write ? "Enregistrer un paiement" : "Consulter les dossiers"}</strong><span>Retrouvez le ninja, ouvrez sa fiche puis sélectionnez les taxes à régler.</span></Link>
      <Link className="workflow-card" href="/dons"><strong>{hasPermission(session, "inventory:write") ? "Enregistrer un don" : "Consulter les dons"}</strong><span>Examinez les déclarations et les ressources remises au service.</span></Link>
      {hasPermission(session, "inventory:write") && <Link className="workflow-card" href="/resources/transaction"><strong>Enregistrer un rachat</strong><span>Sélectionnez les ressources. Les tarifs autorisés sont appliqués côté serveur.</span></Link>}
      <Link className="workflow-card" href="/recouvrement"><strong>Suivre le recouvrement</strong><span>Retrouvez les obligations fiscales et les dossiers à relancer.</span></Link>
      <Link className="workflow-card" href="/crafting"><strong>Artisanat</strong><span>Recettes, besoins et fabrications du village.</span></Link>
      <Link className="workflow-card" href="/equipement"><strong>Équipement</strong><span>Consultez le suivi du matériel des Jōnin.</span></Link>
    </div>
    <section className="panel help-panel"><SectionHeader title="Une correction à apporter ?" /><p>Conservez le reçu d’origine. Une écriture validée se corrige par les actions de contre-écriture autorisées ; elle reste visible dans l’historique.</p></section>
  </div>;
}

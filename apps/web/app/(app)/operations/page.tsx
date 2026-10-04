import Link from "next/link";
import { ArrowRight, Coins, HandCoins, PackagePlus } from "lucide-react";
import { PageHeader, SectionHeader } from "@koeki/ui";
import { hasPermission, requirePermission } from "@/lib/session";

export default async function OperationsPage() {
  const session = await requirePermission("business:read");
  const write = hasPermission(session, "payments:write");
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="Comptoir"
        title="Opérations"
        description="Paiements, dons et rachats : choisissez l’opération à traiter."
      />
      <div className="workflow-grid operation-primary">
        <Link className="workflow-card" href="/ninjas">
          <Coins size={24} aria-hidden="true" />
          <strong>
            {write ? "Enregistrer un paiement" : "Consulter les dossiers"}
          </strong>
          <span>Ouvrir le dossier du ninja et choisir les taxes à régler.</span>
          <span className="text-link">
            Choisir un dossier <ArrowRight size={16} aria-hidden="true" />
          </span>
        </Link>
        <Link className="workflow-card" href="/dons">
          <PackagePlus size={24} aria-hidden="true" />
          <strong>
            {hasPermission(session, "inventory:write")
              ? "Enregistrer un don"
              : "Consulter les dons"}
          </strong>
          <span>
            Ressources remises et déclarations en attente de validation.
          </span>
          <span className="text-link">
            Ouvrir les dons <ArrowRight size={16} aria-hidden="true" />
          </span>
        </Link>
        {hasPermission(session, "inventory:write") && (
          <Link className="workflow-card" href="/resources/transaction">
            <HandCoins size={24} aria-hidden="true" />
            <strong>Enregistrer un rachat</strong>
            <span>
              Choisir les ressources et appliquer le tarif en vigueur.
            </span>
            <span className="text-link">
              Préparer le rachat <ArrowRight size={16} aria-hidden="true" />
            </span>
          </Link>
        )}
      </div>
      <div className="workspace-split">
        <section className="panel">
          <SectionHeader title="Suivre les opérations" />
          <div className="work-list">
            <Link className="work-row" href="/recouvrement">
              <span className="work-row-main">
                <strong>Recouvrement</strong>
                <small>Échéances et dossiers à relancer</small>
              </span>
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link className="work-row" href="/resources">
              <span className="work-row-main">
                <strong>Catalogue et tarifs</strong>
                <small>Valeurs de rachat et ressources disponibles</small>
              </span>
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link className="work-row" href="/inventory/movements">
              <span className="work-row-main">
                <strong>Mouvements de stock</strong>
                <small>Retrouver une entrée, une sortie ou sa correction</small>
              </span>
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </section>
        <section className="panel workspace-aside">
          <SectionHeader title="Services du village" />
          <div className="work-list">
            <Link className="work-row" href="/crafting">
              <span className="work-row-main">
                <strong>Artisanat</strong>
                <small>Recettes et fabrications</small>
              </span>
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link className="work-row" href="/equipement">
              <span className="work-row-main">
                <strong>Équipement</strong>
                <small>Matériel des Jōnin</small>
              </span>
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link className="work-row" href="/events">
              <span className="work-row-main">
                <strong>Événements</strong>
                <small>Activités et récompenses du village</small>
              </span>
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

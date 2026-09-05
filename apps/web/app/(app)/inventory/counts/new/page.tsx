import Link from "next/link";
import { ArrowLeft, FileUp } from "lucide-react";
import { PageHeader, SectionHeader } from "@koeki/ui";
import { StocktakeGrid } from "@/components/inventory/stocktake-grid";
import { getStocktakeCandidates } from "@/lib/inventory-data";
import { demoMode, requirePermission } from "@/lib/session";
import { importStocktakeCsv, openStocktakeAction } from "../actions";

export default async function NewStocktakePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("inventory:count");
  const query = await searchParams;
  const mode = query.mode === "initial" ? "initial" : query.mode === "import" ? "import" : "count";
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const candidates = mode === "import" ? [] : await getStocktakeCandidates(mode);
  const title = mode === "initial" ? "Initialiser l’inventaire" : mode === "import" ? "Importer un comptage" : "Nouveau comptage";
  const description = mode === "initial"
    ? "Saisissez la quantité réellement présente pour chaque ressource jamais comptée. Un solde initial tracé sera créé pour chacune — y compris à zéro, qui signifie « vérifié, il n’y en a aucun »."
    : mode === "import" ? "Un CSV « code ou nom ; quantité » crée une session de comptage à revoir. Rien n’écrase le stock : les écarts sont confirmés à l’étape suivante."
    : "Saisissez les quantités comptées. Le système compare au stock théorique et vous propose les ajustements avant toute écriture.";
  return <div className="page-wrap">
    <PageHeader eyebrow="Inventaire physique" title={title} description={description} actions={<Link className="button button-ghost" href="/inventory/counts"><ArrowLeft size={17} aria-hidden="true" /> Comptages</Link>} />
    {error && <p className="notice error" role="alert">{error}</p>}
    {demoMode ? <p className="notice" role="status">Mode démonstration : les écritures sont désactivées.</p>
      : mode === "import" ? <section className="panel" style={{ maxWidth: 760 }}>
        <SectionHeader title="Fichier ou texte collé" description="Une ligne par ressource : RES-IRON;520 ou Fer;520 — séparateur ; , ou tabulation, en-tête facultatif" />
        <form action={importStocktakeCsv} className="form-grid" encType="multipart/form-data">
          <label>Fichier CSV<input type="file" name="file" accept=".csv,text/csv,text/plain" /></label>
          <label>Ou collez le contenu<textarea name="csv" rows={8} placeholder={"code;quantite\nRES-IRON;520\nPlan T2;80"} /></label>
          <div className="form-actions"><button className="button button-primary" type="submit"><FileUp size={16} aria-hidden="true" /> Créer la session de comptage</button></div>
        </form>
      </section>
      : candidates.length ? <section className="panel inventory-panel"><StocktakeGrid candidates={candidates} mode={mode} action={openStocktakeAction} /></section>
      : <p className="notice" role="status">{mode === "initial" ? "Toutes les ressources actives ont déjà été comptées." : "Aucune ressource active à compter."} <Link href="/inventory/counts" className="text-link">Retour aux comptages</Link></p>}
  </div>;
}

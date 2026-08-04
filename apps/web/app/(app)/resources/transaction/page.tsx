import Link from "next/link";
import { ArrowLeft, HandCoins } from "lucide-react";
import { PageHeader, SectionHeader } from "@koeki/ui";
import { demoMode, requirePermission } from "@/lib/session";
import { recordResourceTransaction } from "../actions";
import { prisma } from "@koeki/database";

export default async function ResourceTransactionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("inventory:write");
  const query = await searchParams;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const [ninjas, resources] = demoMode ? [[], []] : await Promise.all([
    prisma.ninjaProfile.findMany({ where: { status: "ACTIVE" }, orderBy: { code: "asc" }, select: { id: true, code: true, firstName: true, lastName: true } }),
    prisma.resource.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, include: { unit: true } })
  ]);
  return <div className="page-wrap">
    <PageHeader eyebrow="Dons et rachats" title="Nouvelle transaction" description="Les prix et les points sont recalculés côté serveur avant validation — le formulaire n’est jamais la source de vérité."
      actions={<Link className="button button-ghost" href="/resources"><ArrowLeft size={17} /> Catalogue</Link>} />
    {error && <p className="notice error" role="alert">{error}</p>}
    {demoMode ? <p className="notice" role="status">Mode démonstration : les écritures sont désactivées.</p> : <section className="panel" style={{ maxWidth: 720 }}>
      <SectionHeader title="Opération" description="Un rachat exige un prix actif ; un don n’entraîne aucun paiement en Ryō" />
      <form action={recordResourceTransaction} className="form-grid">
        <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
        <div className="form-row">
          <label>Type d’opération<select name="type" required defaultValue="DONATION"><option value="DONATION">Don (points uniquement)</option><option value="BUYBACK">Rachat (payé en Ryō)</option></select></label>
          <label>Ninja<select name="ninjaId" required><option value="">Sélectionner…</option>{ninjas.map((ninja) => <option key={ninja.id} value={ninja.id}>{ninja.code} · {ninja.firstName} {ninja.lastName}</option>)}</select></label>
        </div>
        <fieldset>
          <legend>Ressources (jusqu’à 5 lignes)</legend>
          {[1, 2, 3, 4, 5].map((index) => <div className="form-row" key={index}>
            <label>Ressource {index}<select name={`resourceId_${index}`} defaultValue=""><option value="">—</option>{resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name} ({resource.unit.symbol})</option>)}</select></label>
            <label>Quantité<input type="number" name={`quantity_${index}`} min={0} step="0.01" placeholder="0" /></label>
          </div>)}
        </fieldset>
        <div className="form-actions"><button className="button button-primary" type="submit"><HandCoins size={16} /> Enregistrer et générer le reçu</button></div>
      </form>
    </section>}
  </div>;
}

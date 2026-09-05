import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader, SectionHeader } from "@koeki/ui";
import { TransactionItems } from "@/components/transaction-items";
import { demoMode, requirePermission } from "@/lib/session";
import { recordResourceTransaction } from "../actions";
import { prisma } from "@koeki/database";
import { parseExemptionPolicy } from "@koeki/domain";

const formatRyo = (value: number) => new Intl.NumberFormat("fr-FR").format(value);

export default async function ResourceTransactionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("inventory:write");
  const query = await searchParams;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const [ninjas, resources, prices, exemptionSetting] = demoMode ? [[], [], [], null] : await Promise.all([
    prisma.ninjaProfile.findMany({ where: { status: "ACTIVE" }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, code: true, firstName: true, lastName: true } }),
    prisma.resource.findMany({ where: { isActive: true, category: { code: { not: "TREASURY" } } }, orderBy: [{ exemptionPerUnit: "desc" }, { name: "asc" }] }),
    prisma.resourcePriceHistory.findMany({ where: { effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }] }, orderBy: { effectiveFrom: "desc" } }),
    prisma.appSetting.findUnique({ where: { key: "exemptionPolicy" } })
  ]);
  const exemptionPolicy = parseExemptionPolicy(exemptionSetting?.value);
  const priceOf = new Map<string, bigint>();
  for (const price of prices) if (!priceOf.has(price.resourceId)) priceOf.set(price.resourceId, price.pricePerUnit);
  const ninjaOptions = ninjas.map((ninja) => ({ id: ninja.id, name: `${ninja.firstName} ${ninja.lastName}`, label: `${ninja.firstName} ${ninja.lastName} · ${ninja.code}` }));
  const resourceOptions = resources.map((resource) => {
    const points = resource.pointsPerUnit;
    const rate = Number(resource.exemptionPerUnit);
    const price = Number(priceOf.get(resource.id) ?? 0n);
    const donDetail = [points > 0 ? `${formatRyo(points)} pts/u` : null, rate > 0 ? `${formatRyo(rate)} ¥/u` : null].filter(Boolean).join(" · ");
    return {
      id: resource.id, name: resource.name,
      donLabel: donDetail ? `${resource.name} — ${donDetail}` : resource.name,
      buyLabel: price > 0 ? `${resource.name} — rachat ${formatRyo(price)} ¥/u` : `${resource.name} — sans prix`,
      points, rate, price, hasPrice: price > 0
    };
  });
  return <div className="page-wrap">
    <PageHeader eyebrow="Dons et rachats" title="Nouvelle transaction" description="Tapez pour chercher le ninja et les ressources — prix, points et crédits d’exonération sont recalculés côté serveur et conservés dans le registre."
      actions={<Link className="button button-ghost" href="/resources"><ArrowLeft size={17} /> Catalogue</Link>} />
    {error && <p className="notice error" role="alert">{error}</p>}
    {demoMode ? <p className="notice" role="status">Mode démonstration : les écritures sont désactivées.</p> : <section className="panel" style={{ maxWidth: 760 }}>
      <SectionHeader title="Opération" description={`Un don crédite les points et le solde d’exonération ; son application aux taxes est actuellement de ${(exemptionPolicy.weeklyTaxCoverageBps / 100).toLocaleString("fr-FR")} % maximum par semaine. Un rachat se négocie à la baisse.`} />
      <form action={recordResourceTransaction} className="form-grid">
        <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
        <TransactionItems ninjas={ninjaOptions} resources={resourceOptions} taxCoverageBps={exemptionPolicy.weeklyTaxCoverageBps} />
      </form>
    </section>}
  </div>;
}

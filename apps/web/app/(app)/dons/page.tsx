import Link from "next/link";
import { UserCircle2 } from "lucide-react";
import { EmptyState, MetricCard, MoneyDisplay, PageHeader, PointDisplay, SectionHeader, StatusBadge } from "@koeki/ui";
import { DonationDeclaration } from "@/components/donation-declaration";
import { DonsFilters } from "@/components/dons-filters";
import { getRpService } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { demoMode, hasPermission, requireSession } from "@/lib/session";
import { prisma, type Prisma } from "@koeki/database";
import { declareOwnDonation, rejectDonation, validateDonation } from "./actions";

const formatRyo = (value: number) => new Intl.NumberFormat("fr-FR").format(value);

export default async function DonsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const declared = typeof query.declare === "string" ? query.declare : null;
  const info = typeof query.info === "string" ? query.info : null;
  if (demoMode) return <div className="page-wrap">
    <PageHeader eyebrow="Générosité du village" title="Dons" description="Registre des dons et déclarations des ninjas." />
    <p className="notice" role="status">Mode démonstration : les écritures sont désactivées.</p>
  </div>;
  const canValidate = hasPermission(session, "inventory:write");
  const service = await getRpService();
  const rpYear = service.currentRpYear();
  const since = service.startOfRpYear(rpYear);
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const statut = typeof query.statut === "string" ? query.statut : "";
  const isFiltered = Boolean(q || statut);
  // Every search token must match somewhere: ninja, receipt or a donated object.
  const tokens = q.split(/\s+/).filter((token) => token && token !== "·");
  const registerWhere: Prisma.ResourceTransactionWhereInput = {
    type: "DONATION",
    status: statut === "valides" ? "VALIDATED" : statut === "attente" ? "PENDING_APPROVAL" : { in: ["VALIDATED", "PENDING_APPROVAL"] },
    AND: tokens.map((token) => ({ OR: [
      { ninja: { is: { OR: [{ firstName: { contains: token, mode: "insensitive" } }, { lastName: { contains: token, mode: "insensitive" } }, { code: { contains: token, mode: "insensitive" } }] } } },
      { receiptNumber: { contains: token, mode: "insensitive" } },
      { items: { some: { resource: { name: { contains: token, mode: "insensitive" } } } } }
    ] }))
  };
  const itemsInclude = { include: { resource: { select: { name: true, pointsPerUnit: true, exemptionPerUnit: true } } } } as const;
  const [profile, resources, pending, recent, cyclePoints, cycleDons, allNinjas] = await Promise.all([
    prisma.ninjaProfile.findUnique({ where: { userId: session.userId }, select: { id: true, code: true, firstName: true, lastName: true, status: true } }),
    prisma.resource.findMany({ where: { isActive: true }, orderBy: [{ exemptionPerUnit: "desc" }, { name: "asc" }] }),
    prisma.resourceTransaction.findMany({ where: { type: "DONATION", status: "PENDING_APPROVAL" }, orderBy: { createdAt: "asc" }, include: { ninja: { select: { code: true, firstName: true, lastName: true } }, items: itemsInclude } }),
    prisma.resourceTransaction.findMany({ where: registerWhere, orderBy: { createdAt: "desc" }, take: 100, include: { ninja: { select: { code: true, firstName: true, lastName: true } }, items: itemsInclude } }),
    prisma.pointLedgerEntry.aggregate({ where: { eventType: "DONATION", points: { gt: 0 }, createdAt: { gte: since } }, _sum: { points: true } }),
    prisma.resourceTransaction.findMany({ where: { type: "DONATION", status: "VALIDATED", validatedAt: { gte: since } }, select: { id: true } }),
    prisma.ninjaProfile.findMany({ where: { status: "ACTIVE" }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { firstName: true, lastName: true } })
  ]);
  const searchSuggestions = [...allNinjas.map((ninja) => `${ninja.firstName} ${ninja.lastName}`), ...resources.map((resource) => resource.name)];
  const [cycleExemption, grantedBySource] = await Promise.all([
    prisma.exemptionLedgerEntry.aggregate({ where: { sourceType: "ResourceTransaction", amount: { gt: 0 }, sourceId: { in: cycleDons.map((don) => don.id) } }, _sum: { amount: true } }),
    prisma.exemptionLedgerEntry.findMany({ where: { sourceType: "ResourceTransaction", amount: { gt: 0 }, sourceId: { in: recent.filter((don) => don.status === "VALIDATED").map((don) => don.id) } }, select: { sourceId: true, amount: true } })
  ]);
  const grantedMap = new Map(grantedBySource.map((entry) => [entry.sourceId, entry.amount]));
  type DonItems = Array<{ quantity: unknown; resource: { name: string; pointsPerUnit: number; exemptionPerUnit: bigint } }>;
  const estimate = (items: DonItems) => items.reduce((sum, item) => ({
    points: sum.points + Number(item.quantity) * item.resource.pointsPerUnit,
    exemption: sum.exemption + Number(item.quantity) * Number(item.resource.exemptionPerUnit)
  }), { points: 0, exemption: 0 });
  const contentOf = (items: DonItems) => items.map((item) => `${Number(item.quantity).toLocaleString("fr-FR")}× ${item.resource.name}`).join(", ");
  const donatable = resources.map((resource) => {
    const points = resource.pointsPerUnit;
    const rate = Number(resource.exemptionPerUnit);
    const detail = [points > 0 ? `${formatRyo(points)} pts/u` : null, rate > 0 ? `${formatRyo(rate)} ¥/u` : null].filter(Boolean).join(" · ");
    return { id: resource.id, name: resource.name, label: detail ? `${resource.name} — ${detail}` : resource.name, points, rate };
  });
  return <div className="page-wrap">
    <PageHeader eyebrow="Générosité du village" title="Dons" description="Chaque don rapporte des points de classement et un crédit d’exonération selon le barème du catalogue. Les ninjas déclarent, un agent valide, le registre garde tout."
      actions={canValidate ? <Link className="button button-primary" href="/resources/transaction">Enregistrer un don (agent)</Link> : undefined} />
    {declared && <p className="notice" role="status">Déclaration envoyée — reçu <code>{declared}</code>. Un agent doit la valider avant que les points et l’exonération soient crédités.</p>}
    {info && <p className="notice" role="status">{info}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <section className="metric-grid" aria-label="Dons du cycle">
      <MetricCard label={`Dons validés (année RP ${rpYear})`} value={String(cycleDons.length)} detail="Cycle en cours" />
      <MetricCard label="Points gagnés par dons" value={<PointDisplay points={cyclePoints._sum.points ?? 0} />} detail="Cycle en cours" tone="good" />
      <MetricCard label="Exonération accordée" value={<MoneyDisplay amount={cycleExemption._sum.amount ?? 0n} />} detail="Crédit gagné par les dons du cycle" tone="good" />
      <MetricCard label="En attente de validation" value={String(pending.length)} detail={pending.length ? "Déclarations à traiter" : "Aucune déclaration en attente"} tone={pending.length ? "warn" : "neutral"} />
    </section>
    <div className="detail-grid" style={{ alignItems: "start" }}>
      <section className="panel">
        {profile && profile.status === "ACTIVE" ? <>
          <SectionHeader title="Déclarer mon don" description={`Au nom de ${profile.firstName} ${profile.lastName} (${profile.code}) — points et exonération crédités après validation par un agent`} />
          <form action={declareOwnDonation} className="form-grid">
            <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
            <DonationDeclaration resources={donatable} />
          </form>
        </> : <>
          <SectionHeader title="Déclarer mon don" description="Votre compte n’est lié à aucune fiche ninja" />
          <p className="notice" style={{ margin: 18 }}>Pour déclarer un don, liez d’abord votre fiche depuis la page <Link href="/profil" className="text-link"><UserCircle2 size={14} /> Ma fiche</Link>. Vos dons seront alors crédités en points et en exonération de taxe.</p>
        </>}
      </section>
      {canValidate && <section className="panel">
        <SectionHeader title="Déclarations à valider" description="Vérifiez la remise réelle des objets avant de créditer" />
        {pending.length ? <div className="mini-list">{pending.map((don) => {
          const totals = estimate(don.items);
          return <div key={don.id} style={{ display: "block" }}>
            <span><strong>{don.ninja.firstName} {don.ninja.lastName}</strong><small>{don.receiptNumber} · {formatDateTime(don.createdAt)} — {contentOf(don.items)}</small></span>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
              <form action={validateDonation}><input type="hidden" name="transactionId" value={don.id} /><button className="button button-primary" type="submit" style={{ minHeight: 32 }}>Valider · +{formatRyo(totals.points)} pts · {formatRyo(totals.exemption)} ¥</button></form>
              <form action={rejectDonation} style={{ display: "flex", gap: 8, flex: 1, minWidth: 220 }}><input type="hidden" name="transactionId" value={don.id} /><input name="reason" placeholder="Motif du refus (facultatif)" maxLength={300} style={{ flex: 1 }} /><button className="button button-ghost" type="submit" style={{ minHeight: 32 }}>Refuser</button></form>
            </div>
          </div>;
        })}</div> : <EmptyState title="Rien à valider" description="Les déclarations des ninjas apparaîtront ici." />}
      </section>}
    </div>
    <section className="panel stack-panel">
      <SectionHeader title="Registre des dons" description={isFiltered ? "Résultats filtrés — 100 plus récents" : "Les 100 derniers dons — validés et en attente"} />
      <DonsFilters suggestions={searchSuggestions} />
      {recent.length ? <div className="table-scroll"><table><thead><tr><th>Date</th><th>Ninja</th><th>Contenu</th><th>Points</th><th>Exonération</th><th>Statut</th><th>Reçu</th></tr></thead><tbody>
        {recent.map((don) => {
          const totals = estimate(don.items);
          const granted = grantedMap.get(don.id);
          const isPending = don.status === "PENDING_APPROVAL";
          return <tr key={don.id}>
            <td>{formatDateTime(don.createdAt)}</td>
            <td><strong>{don.ninja.firstName} {don.ninja.lastName}</strong> <small style={{ color: "var(--sand-500)" }}>{don.ninja.code}</small></td>
            <td>{contentOf(don.items) || <span className="muted">—</span>}</td>
            <td>{isPending ? <span className="muted">~{formatRyo(totals.points)}</span> : <PointDisplay points={don.totalPoints} />}</td>
            <td>{isPending ? <span className="muted">~{formatRyo(totals.exemption)} ¥</span> : granted !== undefined ? <MoneyDisplay amount={granted} /> : totals.exemption > 0 ? <MoneyDisplay amount={BigInt(Math.round(totals.exemption))} /> : <span className="muted">—</span>}</td>
            <td><StatusBadge status={isPending ? "pending" : "paid"}>{isPending ? "En attente" : "Validé"}</StatusBadge></td>
            <td><code>{don.receiptNumber}</code></td>
          </tr>;
        })}
      </tbody></table></div> : <EmptyState title={isFiltered ? "Aucun don ne correspond" : "Aucun don"} description={isFiltered ? "Essayez un autre ninja, objet ou numéro de reçu, ou réinitialisez les filtres." : "Les dons validés et les déclarations apparaîtront ici."} />}
    </section>
  </div>;
}

import Link from "next/link";
import { UserCircle2 } from "lucide-react";
import {
  EmptyState,
  MoneyDisplay,
  PageHeader,
  PointDisplay,
  SectionHeader,
  StatusBadge,
} from "@koeki/ui";
import { DonationDeclaration } from "@/components/donation-declaration";
import { DonsFilters } from "@/components/dons-filters";
import { getRpService } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { demoMode, hasPermission, requireSession } from "@/lib/session";
import { prisma, type Prisma } from "@koeki/database";
import { parseExemptionPolicy } from "@koeki/domain";
import {
  declareOwnDonation,
  rejectDonation,
  validateDonation,
} from "./actions";

const formatRyo = (value: number) =>
  new Intl.NumberFormat("fr-FR").format(value);

export default async function DonsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const query = await searchParams;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const declared = typeof query.declare === "string" ? query.declare : null;
  const info = typeof query.info === "string" ? query.info : null;
  if (demoMode)
    return (
      <div className="page-wrap">
        <PageHeader
          eyebrow="Générosité du village"
          title="Dons"
          description="Registre des dons et déclarations des ninjas."
        />
        <p className="notice" role="status">
          Mode démonstration : les écritures sont désactivées.
        </p>
      </div>
    );
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
    status:
      statut === "valides"
        ? "VALIDATED"
        : statut === "attente"
          ? "PENDING_APPROVAL"
          : { in: ["VALIDATED", "PENDING_APPROVAL"] },
    AND: tokens.map((token) => ({
      OR: [
        {
          ninja: {
            is: {
              OR: [
                { firstName: { contains: token, mode: "insensitive" } },
                { lastName: { contains: token, mode: "insensitive" } },
                { code: { contains: token, mode: "insensitive" } },
              ],
            },
          },
        },
        { receiptNumber: { contains: token, mode: "insensitive" } },
        {
          items: {
            some: {
              resource: { name: { contains: token, mode: "insensitive" } },
            },
          },
        },
      ],
    })),
  };
  const itemsInclude = {
    include: {
      resource: {
        select: { name: true, pointsPerUnit: true, exemptionPerUnit: true },
      },
    },
  } as const;
  const [
    profile,
    resources,
    pending,
    recent,
    cyclePoints,
    cycleDons,
    allNinjas,
    exemptionSetting,
  ] = await Promise.all([
    prisma.ninjaProfile.findUnique({
      where: { userId: session.userId },
      select: {
        id: true,
        code: true,
        firstName: true,
        lastName: true,
        status: true,
      },
    }),
    prisma.resource.findMany({
      where: { isActive: true, category: { code: { not: "TREASURY" } } },
      orderBy: [{ exemptionPerUnit: "desc" }, { name: "asc" }],
    }),
    prisma.resourceTransaction.findMany({
      where: { type: "DONATION", status: "PENDING_APPROVAL" },
      orderBy: { createdAt: "asc" },
      include: {
        ninja: {
          select: { id: true, code: true, firstName: true, lastName: true },
        },
        items: itemsInclude,
      },
    }),
    prisma.resourceTransaction.findMany({
      where: registerWhere,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        ninja: {
          select: { id: true, code: true, firstName: true, lastName: true },
        },
        items: itemsInclude,
      },
    }),
    prisma.pointLedgerEntry.aggregate({
      where: {
        eventType: "DONATION",
        points: { gt: 0 },
        createdAt: { gte: since },
      },
      _sum: { points: true },
    }),
    prisma.resourceTransaction.findMany({
      where: {
        type: "DONATION",
        status: "VALIDATED",
        validatedAt: { gte: since },
      },
      select: { id: true },
    }),
    prisma.ninjaProfile.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { firstName: true, lastName: true },
    }),
    prisma.appSetting.findUnique({ where: { key: "exemptionPolicy" } }),
  ]);
  const exemptionPolicy = parseExemptionPolicy(exemptionSetting?.value);
  const searchSuggestions = [
    ...allNinjas.map((ninja) => `${ninja.firstName} ${ninja.lastName}`),
    ...resources.map((resource) => resource.name),
  ];
  const [cycleExemption, grantedBySource] = await Promise.all([
    prisma.exemptionLedgerEntry.aggregate({
      where: {
        sourceType: "ResourceTransaction",
        amount: { gt: 0 },
        sourceId: { in: cycleDons.map((don) => don.id) },
      },
      _sum: { amount: true },
    }),
    prisma.exemptionLedgerEntry.findMany({
      where: {
        sourceType: "ResourceTransaction",
        amount: { gt: 0 },
        sourceId: {
          in: recent
            .filter((don) => don.status === "VALIDATED")
            .map((don) => don.id),
        },
      },
      select: { sourceId: true, amount: true },
    }),
  ]);
  const grantedMap = new Map(
    grantedBySource.map((entry) => [entry.sourceId, entry.amount]),
  );
  type DonItems = Array<{
    quantity: unknown;
    resource: { name: string; pointsPerUnit: number; exemptionPerUnit: bigint };
  }>;
  const estimate = (items: DonItems) =>
    items.reduce(
      (sum, item) => ({
        points:
          sum.points + Number(item.quantity) * item.resource.pointsPerUnit,
        exemption:
          sum.exemption +
          Number(item.quantity) * Number(item.resource.exemptionPerUnit),
      }),
      { points: 0, exemption: 0 },
    );
  const contentOf = (items: DonItems) =>
    items
      .map(
        (item) =>
          `${Number(item.quantity).toLocaleString("fr-FR")}× ${item.resource.name}`,
      )
      .join(", ");
  const donatable = resources.map((resource) => {
    const points = resource.pointsPerUnit;
    const rate = Number(resource.exemptionPerUnit);
    const detail = [
      points > 0 ? `${formatRyo(points)} pts/u` : null,
      rate > 0 ? `${formatRyo(rate)} ¥/u` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      id: resource.id,
      name: resource.name,
      label: detail ? `${resource.name} — ${detail}` : resource.name,
      points,
      rate,
    };
  });
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="Opérations"
        title="Dons"
        description={
          canValidate
            ? "Vérifiez les déclarations reçues et retrouvez les dons du village."
            : "Déclarez les ressources remises au service et suivez leur validation."
        }
        actions={
          canValidate ? (
            <Link
              className="button button-primary"
              href="/resources/transaction?type=DONATION"
            >
              Enregistrer un don (agent)
            </Link>
          ) : undefined
        }
        metrics={[
          {
            label: `Dons validés · année RP ${rpYear}`,
            value: cycleDons.length,
          },
          {
            label: "Points accordés",
            value: <PointDisplay points={cyclePoints._sum.points ?? 0} />,
          },
          {
            label: "Crédit d’exonération accordé",
            value: <MoneyDisplay amount={cycleExemption._sum.amount ?? 0n} />,
          },
          {
            label: "À valider",
            value:
              canValidate && pending.length ? (
                <Link href="#don-validations">{pending.length}</Link>
              ) : (
                pending.length
              ),
          },
        ]}
      />
      {declared && (
        <p className="notice" role="status">
          Déclaration envoyée — reçu <code>{declared}</code>. Un agent doit la
          valider avant que les points et l’exonération soient crédités.
        </p>
      )}
      {info && (
        <p className="notice" role="status">
          {info}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="settings-stack">
        <details className="panel settings-disclosure" open={!canValidate}>
          <summary>
            Déclarer mon don
            {profile && (
              <span>
                {profile.firstName} {profile.lastName}
              </span>
            )}
          </summary>
          {profile && profile.status === "ACTIVE" ? (
            <>
              <form action={declareOwnDonation} className="form-grid">
                <p>
                  Vos points et votre crédit seront accordés après validation de
                  la remise.
                </p>
                <input
                  type="hidden"
                  name="idempotencyKey"
                  value={crypto.randomUUID()}
                />
                <DonationDeclaration
                  resources={donatable}
                  taxCoverageBps={exemptionPolicy.weeklyTaxCoverageBps}
                />
              </form>
            </>
          ) : (
            <>
              <p className="empty-inline">
                Pour déclarer un don, liez d’abord votre{" "}
                <Link href="/profil" className="text-link">
                  <UserCircle2 size={14} aria-hidden="true" /> fiche ninja
                </Link>
                .
              </p>
            </>
          )}
        </details>
        {canValidate && pending.length > 0 && (
          <section className="panel" id="don-validations">
            <SectionHeader
              title="Déclarations à valider"
              description="Confirmez la remise réelle des ressources."
            />
            <div className="work-list">
              {pending.map((don) => {
                const totals = estimate(don.items);
                return (
                  <div key={don.id} className="work-row donation-review">
                    <div className="work-row-main">
                      <Link
                        className="ninja-record-link"
                        href={`/ninjas/${don.ninja.id}`}
                      >
                        <strong>
                          {don.ninja.firstName} {don.ninja.lastName}
                        </strong>
                      </Link>
                      <small>
                        {don.receiptNumber} · {formatDateTime(don.createdAt)}
                      </small>
                      <p>{contentOf(don.items)}</p>
                      <span className="muted">
                        Estimation : {formatRyo(totals.points)} pts ·{" "}
                        {formatRyo(totals.exemption)} Ryō de crédit
                      </span>
                    </div>
                    <div className="work-row-actions">
                      <form action={validateDonation}>
                        <input
                          type="hidden"
                          name="transactionId"
                          value={don.id}
                        />
                        <button className="button button-primary" type="submit">
                          Valider ce don
                        </button>
                      </form>
                      <details className="account-more-actions">
                        <summary>Refuser</summary>
                        <form action={rejectDonation} className="form-grid">
                          <input
                            type="hidden"
                            name="transactionId"
                            value={don.id}
                          />
                          <label>
                            Motif du refus (facultatif)
                            <input name="reason" maxLength={300} />
                          </label>
                          <button className="button button-ghost" type="submit">
                            Confirmer le refus
                          </button>
                        </form>
                      </details>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
      <section className="panel stack-panel">
        <SectionHeader
          title="Registre des dons"
          description={
            isFiltered
              ? "Résultats filtrés — 100 plus récents"
              : "Les 100 derniers dons — validés et en attente"
          }
        />
        <DonsFilters suggestions={searchSuggestions} />
        {recent.length ? (
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Registre des dons"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Ninja / reçu</th>
                  <th scope="col">Contenu</th>
                  <th scope="col">Points</th>
                  <th scope="col">Exonération</th>
                  <th scope="col">Statut / date</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((don) => {
                  const totals = estimate(don.items);
                  const granted = grantedMap.get(don.id);
                  const isPending = don.status === "PENDING_APPROVAL";
                  return (
                    <tr key={don.id}>
                      <th scope="row">
                        <Link
                          className="ninja-record-link"
                          href={`/ninjas/${don.ninja.id}`}
                        >
                          <strong>
                            {don.ninja.firstName} {don.ninja.lastName}
                          </strong>
                        </Link>
                        <small className="cell-detail">{don.ninja.code}</small>
                        <code className="cell-detail">{don.receiptNumber}</code>
                      </th>
                      <td>
                        {contentOf(don.items) || (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {isPending ? (
                          <span className="muted">
                            ~{formatRyo(totals.points)}
                          </span>
                        ) : (
                          <PointDisplay points={don.totalPoints} />
                        )}
                      </td>
                      <td>
                        {isPending ? (
                          <span className="muted">
                            ~{formatRyo(totals.exemption)} ¥
                          </span>
                        ) : granted !== undefined ? (
                          <MoneyDisplay amount={granted} />
                        ) : totals.exemption > 0 ? (
                          <MoneyDisplay
                            amount={BigInt(Math.round(totals.exemption))}
                          />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <StatusBadge status={isPending ? "pending" : "paid"}>
                          {isPending ? "En attente" : "Validé"}
                        </StatusBadge>
                        <small className="cell-detail">
                          {formatDateTime(don.createdAt)}
                        </small>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={isFiltered ? "Aucun don ne correspond" : "Aucun don"}
            description={
              isFiltered
                ? "Essayez un autre ninja, objet ou numéro de reçu, ou réinitialisez les filtres."
                : "Les dons validés et les déclarations apparaîtront ici."
            }
          />
        )}
      </section>
    </div>
  );
}

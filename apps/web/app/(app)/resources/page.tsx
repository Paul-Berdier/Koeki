import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import {
  EmptyState,
  MoneyDisplay,
  SectionHeader,
  StatusBadge,
} from "@koeki/ui";
import { formatQuantity } from "@koeki/domain";
import { ModulePage } from "@/components/module-page";
import { ResourceFilters } from "@/components/resource-filters";
import { getResources } from "@/lib/data";
import { demoMode, hasPermission, requireSession } from "@/lib/session";
import {
  approveTransaction,
  createCategory,
  createUnit,
  updatePrice,
} from "./actions";

export default async function ResourcesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const query = await searchParams;
  const canManage = !demoMode && hasPermission(session, "settings:manage");
  const canCatalog = !demoMode && hasPermission(session, "inventory:catalog");
  const canApprove =
    !demoMode &&
    session.roles.some(
      (role) => role === "SUPER_ADMIN" || role === "KOEKI_MANAGER",
    );
  const canTransact = !demoMode && hasPermission(session, "inventory:write");
  const canSeeInventory = hasPermission(session, "inventory:read");
  const data = await getResources(canApprove, {
    q: typeof query.q === "string" ? query.q : undefined,
    categorie:
      typeof query.categorie === "string" && query.categorie
        ? query.categorie
        : undefined,
    besoin:
      typeof query.besoin === "string" && query.besoin
        ? query.besoin
        : undefined,
    etat: typeof query.etat === "string" && query.etat ? query.etat : undefined,
  });
  const receipt = typeof query.recu === "string" ? query.recu : null;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const info = typeof query.info === "string" ? query.info : null;
  const approvals =
    canApprove && data.pendingApprovals.length > 0 ? (
      <section className="panel">
        <SectionHeader
          title={`${data.pendingApprovals.length} rachat(s) à valider`}
          description="Vérifiez les opérations dépassant le seuil d’approbation."
        />
        <div className="work-list">
          {data.pendingApprovals.map((pending) => (
            <div className="work-row" key={pending.id}>
              <span className="work-row-main">
                <Link
                  className="ninja-record-link"
                  href={`/ninjas/${pending.ninjaId}`}
                >
                  <strong>{pending.ninja}</strong>
                </Link>
                <small>
                  {pending.receipt} · {pending.at}
                </small>
              </span>
              <form action={approveTransaction} className="form-actions">
                <MoneyDisplay amount={pending.total} />
                <input type="hidden" name="transactionId" value={pending.id} />
                <button className="button button-ghost" type="submit">
                  <CheckCircle2 size={15} aria-hidden="true" /> Valider
                </button>
              </form>
            </div>
          ))}
        </div>
      </section>
    ) : undefined;
  const aside =
    canManage || canCatalog ? (
      <div className="settings-grid">
        {canManage && (
          <details className="panel settings-disclosure">
            <summary>Modifier un prix de rachat</summary>
            <form action={updatePrice} className="form-grid">
              <p>Le nouveau prix s’applique aux prochaines opérations.</p>
              <label>
                Ressource
                <select name="resourceId" required>
                  {data.resources.map((resource) => (
                    <option key={resource.id} value={resource.id}>
                      {resource.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-row">
                <label>
                  Nouveau prix (Ryō)
                  <input type="number" name="price" min={0} step={1} required />
                </label>
                <label>
                  Motif
                  <input
                    type="text"
                    name="reason"
                    required
                    minLength={3}
                    maxLength={300}
                  />
                </label>
              </div>
              <div className="form-actions">
                <button className="button button-ghost" type="submit">
                  Appliquer le prix
                </button>
              </div>
            </form>
          </details>
        )}
        {canCatalog && (
          <details className="panel settings-disclosure">
            <summary>Créer une catégorie</summary>
            <form action={createCategory} className="form-grid">
              <div className="form-row">
                <label>
                  Libellé *
                  <input
                    type="text"
                    name="label"
                    required
                    minLength={2}
                    maxLength={60}
                    placeholder="Poisons, Parchemins…"
                  />
                </label>
                <label>
                  Code <small className="field-help">(facultatif)</small>
                  <input
                    type="text"
                    name="code"
                    maxLength={30}
                    placeholder="POISONS"
                    style={{ textTransform: "uppercase" }}
                  />
                </label>
              </div>
              <div className="form-actions">
                <button className="button button-ghost" type="submit">
                  Créer la catégorie
                </button>
              </div>
            </form>
          </details>
        )}
        {canCatalog && (
          <details className="panel settings-disclosure">
            <summary>Créer une unité</summary>
            <form action={createUnit} className="form-grid">
              <div className="form-row">
                <label>
                  Libellé *
                  <input
                    type="text"
                    name="label"
                    required
                    maxLength={20}
                    placeholder="sac, flacon…"
                  />
                </label>
                <label>
                  Décimales
                  <select name="decimals" defaultValue="0">
                    <option value="0">0 (entière)</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                  </select>
                </label>
              </div>
              <label>
                Code <small className="field-help">(facultatif)</small>
                <input
                  type="text"
                  name="code"
                  maxLength={20}
                  placeholder="SAC"
                  style={{ textTransform: "uppercase" }}
                />
              </label>
              <div className="form-actions">
                <button className="button button-ghost" type="submit">
                  Créer l’unité
                </button>
              </div>
            </form>
          </details>
        )}
      </div>
    ) : undefined;
  return (
    <ModulePage
      eyebrow="Stocks et tarifs"
      title="Catalogue des ressources"
      description="Tarifs de rachat, valeur des dons et besoins du village."
      actionLabel={canTransact ? "Enregistrer un rachat" : undefined}
      actionHref="/resources/transaction"
      registerTitle="Ressources"
      registerAction={
        canCatalog ? (
          <Link className="text-link" href="/resources/new">
            Nouvelle ressource <ArrowRight size={15} aria-hidden="true" />
          </Link>
        ) : undefined
      }
      aside={aside}
      beforeRegister={approvals}
      metrics={[
        {
          label: "Rachats ce cycle",
          value: <MoneyDisplay amount={data.metrics.buybackTotal} />,
          detail: `${data.metrics.buybackCount} opération${data.metrics.buybackCount > 1 ? "s" : ""}`,
        },
        {
          label: "Dons reçus",
          value: <MoneyDisplay amount={data.metrics.donationValue} />,
          detail: `${data.metrics.donationCount} don${data.metrics.donationCount > 1 ? "s" : ""} · valeur estimée`,
          tone: "good",
        },
        {
          label: "Catalogue",
          value: String(data.metrics.totalCount),
          detail: `${data.metrics.activeCount} ressources actives`,
        },
      ]}
    >
      {receipt && (
        <p className="notice" role="status" style={{ margin: "12px 20px 0" }}>
          Transaction validée — reçu <code>{receipt}</code>.
        </p>
      )}
      {info && (
        <p className="notice" role="status" style={{ margin: "12px 20px 0" }}>
          {info}
        </p>
      )}
      {error && (
        <p
          className="notice error"
          role="alert"
          style={{ margin: "12px 20px 0" }}
        >
          {error}
        </p>
      )}
      <ResourceFilters categories={data.categories} />
      {data.resources.length ? (
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Catalogue des ressources"
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Ressource</th>
                <th scope="col">Catégorie / unité</th>
                <th scope="col" className="num">
                  Rachat par unité
                </th>
                <th scope="col" className="num">
                  Don par unité
                </th>
                <th scope="col" className="num">
                  Stock
                </th>
                <th scope="col">Situation</th>
              </tr>
            </thead>
            <tbody>
              {data.resources.map((resource) => (
                <tr key={resource.id}>
                  <th scope="row">
                    {canSeeInventory ? (
                      <Link
                        className="ninja-record-link"
                        href={`/inventory/${resource.id}`}
                      >
                        <strong>{resource.name}</strong>
                      </Link>
                    ) : (
                      <strong>{resource.name}</strong>
                    )}
                    <small className="cell-detail">{resource.code}</small>
                    {canCatalog && (
                      <Link
                        className="text-link"
                        href={`/resources/${resource.id}/modifier`}
                        aria-label={`Modifier ${resource.name}`}
                      >
                        Modifier
                      </Link>
                    )}
                  </th>
                  <td>
                    {resource.category}
                    <small className="cell-detail">{resource.unit}</small>
                  </td>
                  <td className="num">
                    {resource.price > 0n ? (
                      <MoneyDisplay amount={resource.price} />
                    ) : (
                      <span className="muted">Non défini</span>
                    )}
                  </td>
                  <td className="num">
                    {resource.points > 0 ? (
                      `${resource.points.toLocaleString("fr-FR")} pts`
                    ) : (
                      <span className="muted">Sans points</span>
                    )}
                    <small className="cell-detail">
                      {resource.exemption > 0n ? (
                        <>
                          <MoneyDisplay amount={resource.exemption} /> de crédit
                        </>
                      ) : (
                        "Sans crédit"
                      )}
                    </small>
                  </td>
                  <td className="num">
                    {resource.counted ? (
                      `${formatQuantity(resource.stock, resource.unitDecimals)} ${resource.unit}`
                    ) : (
                      <span className="muted">Non compté</span>
                    )}
                  </td>
                  <td>
                    {resource.demand === "CRITICAL" ? (
                      <StatusBadge status="overdue">
                        Besoin critique
                      </StatusBadge>
                    ) : resource.demand === "NEEDED" ? (
                      <StatusBadge status="warning">
                        Besoin du village
                      </StatusBadge>
                    ) : null}
                    <span className="cell-detail">
                      <StatusBadge status={resource.badge}>
                        {resource.stateLabel}
                      </StatusBadge>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="Aucune ressource dans cette sélection"
          description={
            canCatalog
              ? "Ajustez les filtres ou créez une nouvelle ressource."
              : "Ajustez les filtres pour retrouver une ressource."
          }
        />
      )}
    </ModulePage>
  );
}

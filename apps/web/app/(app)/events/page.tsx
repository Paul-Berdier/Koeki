import { Ban, Trophy } from "lucide-react";
import { EmptyState, MetricCard, MoneyDisplay, PageHeader, PointDisplay, SectionHeader, StatusBadge } from "@koeki/ui";
import { getEvents } from "@/lib/data";
import { demoMode, hasPermission, requireSession } from "@/lib/session";
import { cancelEvent, createEvent, finishEvent } from "./actions";
import { prisma } from "@koeki/database";

export default async function EventsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const data = await getEvents();
  const canManage = !demoMode && hasPermission(session, "settings:manage");
  const openEvents = data.events.filter((event) => event.isOpen);
  const ninjas = canManage && openEvents.length ? await prisma.ninjaProfile.findMany({ where: { status: "ACTIVE" }, orderBy: [{ firstName: "asc" }, { lastName: "asc" }], select: { id: true, code: true, firstName: true, lastName: true } }) : [];
  return <div className="page-wrap">
    <PageHeader eyebrow="Vie du village" title="Événements" description="Tournois, théâtre et jeux organisés par la Kōeki — cagnotte en Ryō et points pour les vainqueurs." />
    {error && <p className="notice error" role="alert">{error}</p>}
    <section className="metric-grid" aria-label="Résumé des événements">
      <MetricCard label="En cours ou à venir" value={String(data.metrics.open)} detail={data.metrics.open ? "Inscriptions ouvertes en RP" : "Rien de planifié"} tone={data.metrics.open ? "good" : "neutral"} />
      <MetricCard label="Terminés" value={String(data.metrics.finished)} detail="Depuis l’ouverture du registre" />
      <MetricCard label="Cagnottes distribuées" value={<MoneyDisplay amount={data.metrics.totalPrize} />} detail="Total des prix annoncés" tone="warn" />
      <MetricCard label="Participations" value={String(data.metrics.participants)} detail="Toutes éditions confondues" />
    </section>
    <div className={canManage ? "module-grid" : undefined}>
      <section className="panel module-panel">
        <SectionHeader title="Registre des événements" description="Vainqueurs, cagnottes et points attribués" />
        {data.events.length ? <div className="table-scroll"><table><thead><tr><th>Événement</th><th>Type</th><th>Période</th><th>Cagnotte</th><th>Points</th><th>Participants</th><th>Vainqueur</th><th>État</th>{canManage && <th></th>}</tr></thead><tbody>{data.events.map((event) => <tr key={event.id}><td><strong>{event.name}</strong>{event.resourceFocus && <><br/><code>{event.resourceFocus}</code></>}</td><td>{event.kindLabel}</td><td>{event.period}</td><td>{event.prize > 0n ? <MoneyDisplay amount={event.prize} /> : <span className="muted">—</span>}</td><td>{event.rewardPoints > 0 ? <PointDisplay points={event.rewardPoints} /> : <span className="muted">—</span>}</td><td>{event.participants || "—"}</td><td>{event.winner ? <strong>{event.winner}</strong> : <span className="muted">—</span>}</td><td><StatusBadge status={event.badge}>{event.statusLabel}</StatusBadge></td>{canManage && <td>{event.isOpen && <form action={cancelEvent}><input type="hidden" name="eventId" value={event.id} /><button className="button button-ghost" style={{ minHeight: 30 }} type="submit"><Ban size={14} /> Annuler</button></form>}</td>}</tr>)}</tbody></table></div>
          : <EmptyState title="Aucun événement" description="Créez le premier tournoi, une pièce de théâtre ou un jeu du village." />}
      </section>
      {canManage && <aside style={{ display: "grid", gap: 12, alignContent: "start" }}>
        <section className="panel">
          <SectionHeader title="Créer un événement" description="La cagnotte est versée en RP ; les points vont au vainqueur à la clôture" />
          <form action={createEvent} className="form-grid">
            <label>Nom *<input type="text" name="name" required maxLength={120} placeholder="Tournoi Lavande #2…" /></label>
            <div className="form-row">
              <label>Type<select name="kind" defaultValue="TOURNOI"><option value="TOURNOI">Tournoi</option><option value="THEATRE">Théâtre</option><option value="JEU">Jeu</option><option value="AUTRE">Autre</option></select></label>
              <label>Ressource concernée<input type="text" name="resourceFocus" maxLength={120} placeholder="Lavande, toutes…" /></label>
            </div>
            <div className="form-row">
              <label>Début *<input type="date" name="startsAt" required /></label>
              <label>Fin (facultatif)<input type="date" name="endsAt" /></label>
            </div>
            <div className="form-row">
              <label>Cagnotte (Ryō)<input type="number" name="prize" min={0} step={1} defaultValue={0} /></label>
              <label>Points du vainqueur<input type="number" name="rewardPoints" min={0} step={1} defaultValue={0} /></label>
            </div>
            <label>Description<textarea name="description" maxLength={1000} /></label>
            <div className="form-actions"><button className="button button-primary" type="submit"><Trophy size={16} /> Créer l’événement</button></div>
          </form>
        </section>
        {openEvents.length > 0 && <section className="panel">
          <SectionHeader title="Clôturer un événement" description="Désigne le vainqueur et lui attribue les points prévus" />
          <form action={finishEvent} className="form-grid">
            <label>Événement<select name="eventId" required>{openEvents.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label>
            <label>Vainqueur (facultatif)<select name="winnerId" defaultValue=""><option value="">Aucun vainqueur</option>{ninjas.map((ninja) => <option key={ninja.id} value={ninja.id}>{ninja.firstName} {ninja.lastName} · {ninja.code}</option>)}</select></label>
            <label>Nombre de participants<input type="number" name="participants" min={0} step={1} defaultValue={0} /></label>
            <div className="form-actions"><button className="button button-ghost" type="submit"><Trophy size={16} /> Clôturer</button></div>
          </form>
        </section>}
      </aside>}
    </div>
  </div>;
}

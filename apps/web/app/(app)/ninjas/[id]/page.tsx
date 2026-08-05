import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, KeyRound, Pencil } from "lucide-react";
import { EmptyState, GradeBadge, MetricCard, MoneyDisplay, NinjaAvatar, PageHeader, PointDisplay, SectionHeader, StatusBadge } from "@koeki/ui";
import { getNinjaDetail } from "@/lib/data";
import { lateYearsLabel } from "@/lib/format";
import { demoMode, hasPermission, requireSession } from "@/lib/session";
import { changeGrade, recordPayment, waiveAssessment } from "../actions";
import { prisma } from "@koeki/database";

export default async function NinjaDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const { id } = await params;
  const query = await searchParams;
  if (!demoMode && session.roles.length === 1 && session.roles[0] === "NINJA") {
    const own = await prisma.ninjaProfile.findUnique({ where: { userId: session.userId }, select: { id: true } });
    if (!own) redirect("/profil");
    if (own!.id !== id) redirect("/access-denied");
  }
  const canPay = hasPermission(session, "payments:write");
  const canWrite = hasPermission(session, "ninjas:write");
  const ownProfile = demoMode ? null : await prisma.ninjaProfile.findUnique({ where: { userId: session.userId }, select: { id: true } });
  const isOwner = ownProfile?.id === id;
  const data = await getNinjaDetail(id, { canSeeNotes: canWrite || hasPermission(session, "audit:read") });
  if (!data) notFound();
  const receipt = typeof query.recu === "string" ? query.recu : null;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const info = typeof query.info === "string" ? query.info : null;
  const settleable = data.assessments.filter((row) => row.remaining > 0n || row.badge === "overdue" || row.badge === "due" || row.badge === "warning");
  return <div className="page-wrap">
    <PageHeader eyebrow={`Dossier ${data.code}`} title={data.name} description={`${data.grade.label}${data.alias ? ` · « ${data.alias} »` : ""} · ${data.statusLabel}`}
      actions={<>{(canWrite || isOwner) && <Link className="button button-ghost" href={`/ninjas/${data.id}/modifier`}><Pencil size={17} /> Modifier</Link>}<Link className="button button-ghost" href="/ninjas"><ArrowLeft size={17} /> Registre des ninjas</Link></>} />
    {receipt && <p className="notice" role="status">Paiement validé — reçu <code>{receipt}</code> enregistré et audité.</p>}
    {info && <p className="notice" role="status">{info}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}

    <section className="metric-grid" aria-label="Situation fiscale">
      <MetricCard label="Dette totale" value={<MoneyDisplay amount={data.totalDebt} />} detail={data.totalDebt > 0n ? "Majorations comprises" : "Aucune dette ouverte"} tone={data.totalDebt > 0n ? "danger" : "good"} />
      <MetricCard label="Crédit d’exonération" value={<MoneyDisplay amount={data.exemptionBalance} />} detail="Gagné par les dons et rachats — déduit automatiquement de la taxe chaque dimanche" tone={data.exemptionBalance > 0n ? "good" : "neutral"} />
      <MetricCard label="Retard" value={lateYearsLabel(data.lateYears)} detail={data.lateYears >= 2 ? "Dossier prioritaire" : "Sous surveillance normale"} tone={data.lateYears >= 2 ? "danger" : data.lateYears > 0 ? "warn" : "good"} />
      <MetricCard label="Points" value={<PointDisplay points={data.pointsBalance} />} detail="Solde explicable depuis le registre" tone="neutral" />
    </section>

    <div className="detail-grid">
      <div>
        <section className="panel">
          <SectionHeader title="Historique fiscal" description="Une ligne par année RP, instantanés immuables" />
          {data.assessments.length ? <div className="table-scroll"><table><thead><tr><th>Année</th><th>Grade</th><th>Montant</th><th>Majorations</th><th>Corrections</th><th>Payé</th><th>Reste</th><th>Statut</th></tr></thead><tbody>{data.assessments.map((row) => <tr key={row.id}><td><strong>RP {row.rpYear}</strong></td><td>{row.gradeLabel}</td><td><MoneyDisplay amount={row.original} /></td><td className={row.penalties > 0n ? "negative" : "muted"}>{row.penalties > 0n ? <MoneyDisplay amount={row.penalties} /> : "—"}</td><td className="muted">{row.adjustments !== 0n || row.exemptions !== 0n ? <MoneyDisplay amount={row.adjustments - row.exemptions} /> : "—"}</td><td className="positive"><MoneyDisplay amount={row.paid} /></td><td className={row.remaining > 0n || row.badge === "overdue" ? "negative" : "muted"}>{row.remaining > 0n ? <MoneyDisplay amount={row.remaining} /> : row.badge === "overdue" ? "Impayée (ancien registre)" : "Soldé"}</td><td><StatusBadge status={row.badge}>{row.statusLabel}</StatusBadge></td></tr>)}</tbody></table></div>
            : <EmptyState title="Aucune taxe" description="Aucune année fiscale n’a encore été générée pour ce dossier." />}
        </section>
        <section className="panel">
          <SectionHeader title="Historique économique" description="Paiements, dons et rachats liés au dossier" />
          {data.operations.length ? <div className="table-scroll"><table><thead><tr><th>Reçu</th><th>Opération</th><th>Montant</th><th>État</th><th>Date</th></tr></thead><tbody>{data.operations.map((operation) => <tr key={operation.id}><td><code>{operation.receipt}</code></td><td>{operation.label}</td><td><MoneyDisplay amount={operation.amount} /></td><td><StatusBadge status={operation.badge}>{operation.statusLabel}</StatusBadge></td><td>{operation.at}</td></tr>)}</tbody></table></div>
            : <EmptyState title="Aucune opération" description="Les reçus apparaîtront ici dès la première écriture." />}
        </section>
      </div>
      <div>
        {canPay && <section className="panel">
          <SectionHeader title="Encaisser un paiement" description="Cochez les semaines réglées par ce versement — le reçu et l’audit suivent" />
          {settleable.length ? <form action={recordPayment} className="form-grid">
            <input type="hidden" name="ninjaId" value={data.id} />
            <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
            <fieldset>
              <legend>Semaines à régler</legend>
              <div className="mini-list" style={{ padding: 0 }}>
                {settleable.map((row) => <label key={row.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--paper-100)" }}>
                  <input type="checkbox" name="years" value={row.id} defaultChecked={row.badge === "overdue"} style={{ minHeight: 0, width: 16, height: 16 }} />
                  RP {row.rpYear} — {row.remaining > 0n ? <>reste <MoneyDisplay amount={row.remaining} /></> : "impayée (ancien registre)"}
                </label>)}
              </div>
            </fieldset>
            <div className="form-row">
              <label>Montant reçu (Ryō) *<input type="number" name="amount" min={1} step={1} required placeholder="Versé par le joueur" /></label>
              <label>Moyen<select name="method" defaultValue="ESPECES"><option value="ESPECES">Espèces</option><option value="TRANSFERT">Transfert</option><option value="AUTRE">Autre</option></select></label>
            </div>
            <label>Référence (facultatif)<input type="text" name="reference" maxLength={120} placeholder="Arrangement, contexte…" /></label>
            <div className="form-actions"><button className="button button-primary" type="submit"><KeyRound size={16} /> Encaisser et solder les semaines cochées</button></div>
          </form> : <p className="notice" style={{ margin: 18 }}>Rien à encaisser : aucune semaine ouverte. La prochaine taxe sera générée dimanche minuit{data.exemptionBalance > 0n ? " et sera couverte automatiquement par le crédit d’exonération" : ""}. Les dons et rachats s’enregistrent depuis la page <Link href="/resources/transaction" className="text-link">Ressources</Link>.</p>}
        </section>}
        {canWrite && settleable.length > 0 && <section className="panel">
          <SectionHeader title="Remettre une année" description="Annule la semaine sans encaissement — motif obligatoire, audité" />
          <form action={waiveAssessment} className="form-grid">
            <input type="hidden" name="ninjaId" value={data.id} />
            <div className="form-row">
              <label>Année concernée<select name="assessmentId" required>{settleable.map((row) => <option key={row.id} value={row.id}>RP {row.rpYear} — {row.remaining > 0n ? `reste ${new Intl.NumberFormat("fr-FR").format(Number(row.remaining))} ¥` : "impayée (ancien registre)"}</option>)}</select></label>
              <label>Motif *<input type="text" name="reason" required minLength={3} maxLength={300} placeholder="Geste commercial, erreur…" /></label>
            </div>
            <div className="form-actions"><button className="button button-ghost" type="submit">Remettre cette année</button></div>
          </form>
        </section>}
        <section className="panel">
          <SectionHeader title="Identité" description="Registre administratif" />
          <div className="identity-list">
            <div className="person-cell" style={{ gridColumn: "1/-1" }}><NinjaAvatar name={data.name} /><span><strong>{data.name}</strong><small>{data.code}</small></span></div>
            <div><span>Grade</span><GradeBadge>{data.grade.label}</GradeBadge></div>
            <div><span>État</span>{data.statusLabel}</div>
            <div><span>Clan</span>{data.clan ?? "—"}</div>
            <div><span>Pseudonyme</span>{data.alias ?? "—"}</div>
            <div style={{ gridColumn: "1/-1" }}><span>Compte lié</span>{data.linkedUserName ?? "Aucun compte Discord associé"}</div>
            {data.notes && <div style={{ gridColumn: "1/-1" }}><span>Notes internes</span><div className="notes-block">{data.notes}</div></div>}
          </div>
        </section>
        <section className="panel">
          <SectionHeader title="Points" description="Dernières écritures du registre" />
          {data.pointEntries.length ? <div className="mini-list">{data.pointEntries.map((entry) => <div key={entry.id}><span>{entry.label}{entry.reason && <small>{entry.reason}</small>}<small>{entry.at}</small></span><strong className={entry.points < 0 ? "negative" : "positive"}>{entry.points > 0 ? "+" : ""}{entry.points} pts</strong></div>)}</div>
            : <EmptyState title="Aucun point" description="Les points gagnés apparaîtront ici." />}
        </section>
        {canWrite && <section className="panel">
          <SectionHeader title="Changer le grade" description="Historisé, motif obligatoire, non rétroactif" />
          <form action={changeGrade} className="form-grid">
            <input type="hidden" name="ninjaId" value={data.id} />
            <label>Nouveau grade<select name="gradeId" defaultValue={data.grades.find((grade) => grade.code === data.grade.code)?.id}>{data.grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.label}</option>)}</select></label>
            <label>Motif<input type="text" name="reason" required minLength={3} maxLength={300} placeholder="Promotion validée par le conseil…" /></label>
            <div className="form-actions"><button className="button button-ghost" type="submit">Appliquer le changement</button></div>
          </form>
        </section>}
      </div>
    </div>
  </div>;
}

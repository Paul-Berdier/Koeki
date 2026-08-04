import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, KeyRound, Pencil, Search } from "lucide-react";
import { EmptyState, GradeBadge, MetricCard, MoneyDisplay, NinjaAvatar, PageHeader, PointDisplay, SectionHeader, StatusBadge } from "@koeki/ui";
import { getNinjaDetail } from "@/lib/data";
import { lateYearsLabel } from "@/lib/format";
import { demoMode, hasPermission, requireSession } from "@/lib/session";
import { changeGrade, recordPayment } from "../actions";
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
  const previewAmount = typeof query.montant === "string" && /^\d+$/.test(query.montant) ? BigInt(query.montant) : undefined;
  const data = await getNinjaDetail(id, { previewAmount, canSeeNotes: canWrite || hasPermission(session, "audit:read") });
  if (!data) notFound();
  const receipt = typeof query.recu === "string" ? query.recu : null;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  return <div className="page-wrap">
    <PageHeader eyebrow={`Dossier ${data.code}`} title={data.name} description={`${data.grade.label}${data.alias ? ` · « ${data.alias} »` : ""} · ${data.statusLabel}`}
      actions={<>{canWrite && <Link className="button button-ghost" href={`/ninjas/${data.id}/modifier`}><Pencil size={17} /> Modifier</Link>}<Link className="button button-ghost" href="/ninjas"><ArrowLeft size={17} /> Registre des ninjas</Link></>} />
    {receipt && <p className="notice" role="status">Paiement validé — reçu <code>{receipt}</code> enregistré et audité.</p>}
    {error && <p className="notice error" role="alert">{error}</p>}

    <section className="metric-grid" aria-label="Situation fiscale">
      <MetricCard label="Dette totale" value={<MoneyDisplay amount={data.totalDebt} />} detail={data.totalDebt > 0n ? "Majorations comprises" : "Aucune dette ouverte"} tone={data.totalDebt > 0n ? "danger" : "good"} />
      <MetricCard label="Crédit d’exonération" value={<MoneyDisplay amount={data.exemptionBalance} />} detail="Gagné par les dons et rachats, dépensable sur les taxes" tone={data.exemptionBalance > 0n ? "good" : "neutral"} />
      <MetricCard label="Retard" value={lateYearsLabel(data.lateYears)} detail={data.lateYears >= 2 ? "Dossier prioritaire" : "Sous surveillance normale"} tone={data.lateYears >= 2 ? "danger" : data.lateYears > 0 ? "warn" : "good"} />
      <MetricCard label="Points" value={<PointDisplay points={data.pointsBalance} />} detail="Solde explicable depuis le registre" tone="neutral" />
    </section>

    <div className="detail-grid">
      <div>
        <section className="panel">
          <SectionHeader title="Historique fiscal" description="Une ligne par année RP, instantanés immuables" />
          {data.assessments.length ? <div className="table-scroll"><table><thead><tr><th>Année</th><th>Grade</th><th>Montant</th><th>Majorations</th><th>Corrections</th><th>Payé</th><th>Reste</th><th>Statut</th></tr></thead><tbody>{data.assessments.map((row) => <tr key={row.id}><td><strong>RP {row.rpYear}</strong></td><td>{row.gradeLabel}</td><td><MoneyDisplay amount={row.original} /></td><td className={row.penalties > 0n ? "negative" : "muted"}>{row.penalties > 0n ? <MoneyDisplay amount={row.penalties} /> : "—"}</td><td className="muted">{row.adjustments !== 0n || row.exemptions !== 0n ? <MoneyDisplay amount={row.adjustments - row.exemptions} /> : "—"}</td><td className="positive"><MoneyDisplay amount={row.paid} /></td><td className={row.remaining > 0n ? "negative" : "muted"}>{row.remaining > 0n ? <MoneyDisplay amount={row.remaining} /> : "Soldé"}</td><td><StatusBadge status={row.badge}>{row.statusLabel}</StatusBadge></td></tr>)}</tbody></table></div>
            : <EmptyState title="Aucune taxe" description="Aucune année fiscale n’a encore été générée pour ce dossier." />}
        </section>
        <section className="panel">
          <SectionHeader title="Historique économique" description="Paiements, dons et rachats liés au dossier" />
          {data.operations.length ? <div className="table-scroll"><table><thead><tr><th>Reçu</th><th>Opération</th><th>Montant</th><th>État</th><th>Date</th></tr></thead><tbody>{data.operations.map((operation) => <tr key={operation.id}><td><code>{operation.receipt}</code></td><td>{operation.label}</td><td><MoneyDisplay amount={operation.amount} /></td><td><StatusBadge status={operation.badge}>{operation.statusLabel}</StatusBadge></td><td>{operation.at}</td></tr>)}</tbody></table></div>
            : <EmptyState title="Aucune opération" description="Les reçus apparaîtront ici dès la première écriture." />}
        </section>
      </div>
      <div>
        <section className="panel">
          <SectionHeader title="Identité" description="Registre administratif" />
          <div className="identity-list">
            <div className="person-cell" style={{ gridColumn: "1/-1" }}><NinjaAvatar name={data.name} /><span><strong>{data.name}</strong><small>{data.code}</small></span></div>
            <div><span>Grade</span><GradeBadge>{data.grade.label}</GradeBadge></div>
            <div><span>État</span>{data.statusLabel}</div>
            <div><span>Clan</span>{data.clan ?? "—"}</div>
            <div><span>Pseudonyme</span>{data.alias ?? "—"}</div>
            <div style={{ gridColumn: "1/-1" }}><span>Compte lié</span>{data.linkedUserName ?? "Aucun compte Discord associé"}</div>
            {data.notes && <div style={{ gridColumn: "1/-1" }}><span>Notes internes</span>{data.notes}</div>}
          </div>
        </section>
        {canPay && data.totalDebt === 0n && <section className="panel">
          <SectionHeader title="Encaisser des Ryōs" description="Paiement de taxes" />
          <p className="notice" style={{ margin: 18 }}>Aucune taxe ouverte pour ce dossier : la prochaine taxe annuelle sera générée au passage de l’année RP (dimanche minuit). Les dons et rachats de ressources s’enregistrent depuis la page <Link href="/resources/transaction" className="text-link">Ressources</Link>.</p>
        </section>}
        {canPay && data.totalDebt > 0n && <section className="panel">
          <SectionHeader title="Enregistrer un paiement" description="Allocation recalculée côté serveur" />
          <form method="get" action={`/ninjas/${data.id}`} className="form-grid" style={{ paddingBottom: 0 }}>
            <label>Montant reçu (Ryō)<input type="number" name="montant" min={1} step={1} required defaultValue={data.preview ? String(data.preview.amount) : undefined} /></label>
            <div className="form-actions"><button className="button button-ghost" type="submit"><Search size={16} /> Prévisualiser la répartition</button></div>
          </form>
          {data.preview && <div className="allocation-preview" role="status">
            <strong>Paiement reçu : <MoneyDisplay amount={data.preview.amount} /></strong>
            <ul>{data.preview.lines.map((line) => <li key={line.label}><span>{line.label}</span><MoneyDisplay amount={line.amount} /></li>)}</ul>
            {data.preview.unallocated > 0n && <p className="negative">Excédent non alloué : <MoneyDisplay amount={data.preview.unallocated} /> — réduisez le montant.</p>}
          </div>}
          {data.preview && data.preview.unallocated === 0n && <form action={recordPayment} className="form-grid" style={{ paddingTop: 0 }}>
            <input type="hidden" name="ninjaId" value={data.id} />
            <input type="hidden" name="amount" value={String(data.preview.amount)} />
            <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
            <div className="form-row">
              <label>Moyen de paiement<select name="method" defaultValue={data.exemptionBalance > 0n ? "EXONERATION" : "ESPECES"}><option value="EXONERATION">Crédit d’exonération ({new Intl.NumberFormat("fr-FR").format(Number(data.exemptionBalance))} ¥ dispo)</option><option value="ESPECES">Espèces</option><option value="TRANSFERT">Transfert</option><option value="AUTRE">Autre</option></select></label>
              <label>Référence (facultatif)<input type="text" name="reference" maxLength={120} /></label>
            </div>
            <div className="form-actions"><button className="button button-primary" type="submit"><KeyRound size={16} /> Confirmer le paiement</button></div>
          </form>}
        </section>}
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

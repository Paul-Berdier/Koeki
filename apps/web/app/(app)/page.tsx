import Link from "next/link";
import { AlertTriangle, ArrowRight, Boxes, CircleCheck, Clock3, Plus, ReceiptText } from "lucide-react";
import { MetricCard, MoneyDisplay, PageHeader, SectionHeader, StatusBadge } from "@koeki/ui";
import { activity } from "@/lib/demo-data";

export default function DashboardPage() {
  return <div className="page-wrap">
    <PageHeader eyebrow="Situation du village · année RP 48" title="Salle des comptes" description="Une lecture immédiate des finances, des échéances et des opérations à traiter."
      actions={<><button className="button button-ghost"><ReceiptText size={17} /> Rapprocher la journée</button><Link className="button button-primary" href="/ninjas"><Plus size={17} /> Enregistrer</Link></>} />

    <section className="metric-grid" aria-label="Indicateurs principaux">
      <MetricCard label="Recettes fiscales" value={<MoneyDisplay amount={286500} />} detail="71 % des taxes attendues" tone="good" />
      <MetricCard label="Dette à recouvrer" value={<MoneyDisplay amount={143000} />} detail="12 ninjas nécessitent un suivi" tone="danger" />
      <MetricCard label="Rachats ce cycle" value={<MoneyDisplay amount={67400} />} detail="23 transactions, dans le budget" />
      <MetricCard label="Valeur des stocks" value={<MoneyDisplay amount={418200} />} detail="3 ressources sous le seuil" tone="warn" />
    </section>

    <div className="dashboard-grid">
      <section className="panel recovery-panel">
        <SectionHeader title="Recouvrement fiscal" description="Progression des encaissements par année RP" action={<Link href="/statistics" className="text-link">Détails <ArrowRight size={15} /></Link>} />
        <div className="recovery-summary"><div><span>Taux actuel</span><strong>71,4 %</strong></div><div><span>Attendu</span><MoneyDisplay amount={401000} /></div><div><span>Encaissé</span><MoneyDisplay amount={286500} /></div></div>
        <div className="bar-chart" role="img" aria-label="Taux de recouvrement: année 44 82 %, 45 76 %, 46 88 %, 47 69 %, 48 71 %">
          {[82, 76, 88, 69, 71].map((value, index) => <div key={value + index}><span style={{ height: `${value}%` }}><i>{value}%</i></span><small>RP {44 + index}</small></div>)}
        </div>
        <p className="chart-summary">Le recouvrement remonte de 2 points par rapport à l’année RP 47, mais reste sous la moyenne des cinq dernières années.</p>
      </section>

      <section className="panel alerts-panel">
        <SectionHeader title="À traiter" description="Actions prioritaires" />
        <div className="priority-list">
          <Link href="/admin"><span className="priority-icon danger"><AlertTriangle /></span><span><strong>Taux de majoration absent</strong><small>L’automatisation reste désactivée</small></span><b>Configurer</b></Link>
          <Link href="/recouvrement"><span className="priority-icon warn"><Clock3 /></span><span><strong>12 dossiers à relancer</strong><small>4 dépassent deux années RP</small></span><b>Ouvrir</b></Link>
          <Link href="/inventory"><span className="priority-icon"><Boxes /></span><span><strong>3 stocks critiques</strong><small>Cuivre, tissu renforcé, bois d’aulne</small></span><b>Vérifier</b></Link>
          <Link href="/reports"><span className="priority-icon good"><CircleCheck /></span><span><strong>2 rapports à valider</strong><small>Période réelle du 28 juil. au 3 août</small></span><b>Examiner</b></Link>
        </div>
      </section>
    </div>

    <section className="panel activity-panel">
      <SectionHeader title="Dernières opérations" description="Écritures enregistrées par le service économique" action={<Link href="/audit" className="text-link">Voir le registre <ArrowRight size={15} /></Link>} />
      <div className="table-scroll"><table><thead><tr><th>Référence</th><th>Opération</th><th>Ninja</th><th>Montant</th><th>État</th><th>Horodatage</th></tr></thead><tbody>{activity.map((item) => <tr key={item.code}><td><code>{item.code}</code></td><td>{item.label}</td><td><strong>{item.subject}</strong></td><td className={item.amount < 0 ? "negative" : "positive"}><MoneyDisplay amount={Math.abs(item.amount)} /></td><td><StatusBadge status="paid">Validée</StatusBadge></td><td>{item.time}</td></tr>)}</tbody></table></div>
    </section>
  </div>;
}

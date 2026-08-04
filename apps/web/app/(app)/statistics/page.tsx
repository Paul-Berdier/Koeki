import { MoneyDisplay, PageHeader, SectionHeader } from "@koeki/ui";

const debtByGrade = [["Genin confirmé", 18000, 22], ["Chunin", 35000, 42], ["Konin", 27000, 33], ["Jonin", 56000, 68], ["Tokubetsu", 8000, 10]] as const;

export default function StatisticsPage() {
  return <div className="page-wrap">
    <PageHeader eyebrow="Analyse multi-dimensionnelle" title="Statistiques" description="Finances, stocks et activité des agents — chaque graphique possède une synthèse textuelle." actions={<button className="button button-ghost">Année RP 48</button>} />
    <section className="stats-hero"><div><span>Taux de recouvrement</span><strong>71,4 %</strong><p>+2,1 points depuis l’année RP 47</p></div><div className="collection-ring" role="img" aria-label="71,4 pour cent recouvrés"><span>71%</span></div><dl><div><dt>Attendu</dt><dd><MoneyDisplay amount={401000} /></dd></div><div><dt>Encaissé</dt><dd><MoneyDisplay amount={286500} /></dd></div><div><dt>Restant</dt><dd className="negative"><MoneyDisplay amount={114500} /></dd></div></dl></section>
    <div className="dashboard-grid stats-grid">
      <section className="panel"><SectionHeader title="Dette par grade" description="Montant ouvert et part relative" /><div className="horizontal-chart" role="img" aria-label="Dette la plus élevée chez les Jonin, 56 000 Ryō">{debtByGrade.map(([grade, amount, percent]) => <div key={grade}><span>{grade}</span><i><b style={{ width: `${percent}%` }} /></i><strong><MoneyDisplay amount={amount} /></strong></div>)}</div><p className="chart-summary">Les Jonin concentrent 39 % de la dette ouverte. Le suivi doit toutefois tenir compte de l’ancienneté et non du seul montant.</p></section>
      <section className="panel"><SectionHeader title="Activité des agents" description="Score composite, non financier uniquement" /><div className="agent-scores"><article><span className="agent-avatar">SH</span><div><strong>Sonemi Hakumei</strong><small>Fiabilité 94 · Délai 88 · Volume 91</small><i><b style={{width:"91%"}} /></i></div><em>91</em></article><article><span className="agent-avatar">KT</span><div><strong>Kaemon Tori</strong><small>Fiabilité 89 · Délai 92 · Volume 84</small><i><b style={{width:"88%"}} /></i></div><em>88</em></article></div><p className="chart-summary">Les deux agents ont une performance équilibrée ; aucune comparaison n’est fondée uniquement sur les montants encaissés.</p></section>
    </div>
  </div>;
}

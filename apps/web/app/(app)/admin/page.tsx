import { AlertTriangle, CheckCircle2, ChevronRight, KeyRound, Settings2, ShieldCheck, TimerReset } from "lucide-react";
import { PageHeader, SectionHeader, StatusBadge } from "@koeki/ui";

export default function AdminPage() {
  return <div className="page-wrap"><PageHeader eyebrow="Accès responsable" title="Administration" description="Politiques, invitations, permissions et paramètres structurants." actions={<button className="button button-primary"><KeyRound size={17}/> Générer une invitation</button>} />
    <div className="admin-alert" role="alert"><AlertTriangle /><div><strong>Le taux de majoration n’est pas configuré.</strong><p>Les majorations automatiques sont désactivées jusqu’à validation explicite d’un responsable.</p></div><button>Configurer</button></div>
    <div className="admin-grid">
      <section className="panel"><SectionHeader title="Configuration financière" description="Paramètres versionnés et audités"/><div className="settings-list">
        <button><span className="setting-icon"><Settings2/></span><span><strong>Politique fiscale</strong><small>Barème initial complet · 10 grades</small></span><StatusBadge status="paid">Active</StatusBadge><ChevronRight/></button>
        <button><span className="setting-icon"><TimerReset/></span><span><strong>Temps RP</strong><small>1 semaine réelle = 1 année RP</small></span><StatusBadge status="paid">Configuré</StatusBadge><ChevronRight/></button>
        <button><span className="setting-icon"><ShieldCheck/></span><span><strong>Seuil d’approbation</strong><small>50 000 Ryō · validation managériale</small></span><StatusBadge status="warning">À valider</StatusBadge><ChevronRight/></button>
      </div></section>
      <aside className="panel"><SectionHeader title="État du système" description="Contrôles de sécurité"/><div className="system-checks"><p><CheckCircle2/>Base Kōeki isolée</p><p><CheckCircle2/>Invitations à usage unique</p><p><CheckCircle2/>Sessions révocables</p><p><CheckCircle2/>Worker idempotent</p><p><CheckCircle2/>Indexation interdite</p></div></aside>
    </div>
  </div>;
}

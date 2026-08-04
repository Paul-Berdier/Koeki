"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3, BookOpenText, Boxes, ChevronDown, FileText, HandCoins,
  LayoutDashboard, Menu, PackageSearch, ScrollText, Settings, ShieldCheck, Users, X
} from "lucide-react";

const navigation = [
  { href: "/", label: "Vue d’ensemble", icon: LayoutDashboard },
  { href: "/ninjas", label: "Ninjas", icon: Users },
  { href: "/recouvrement", label: "Recouvrement", icon: HandCoins },
  { href: "/resources", label: "Ressources", icon: PackageSearch },
  { href: "/inventory", label: "Inventaire", icon: Boxes },
  { href: "/crafting", label: "Artisanat", icon: BookOpenText },
  { href: "/statistics", label: "Statistiques", icon: BarChart3 },
  { href: "/reports", label: "Rapports", icon: FileText },
  { href: "/audit", label: "Registre d’audit", icon: ScrollText },
  { href: "/admin", label: "Administration", icon: Settings }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return <div className="app-shell">
    <a className="skip-link" href="#main">Aller au contenu</a>
    <button className="mobile-menu" onClick={() => setOpen(true)} aria-label="Ouvrir la navigation"><Menu /></button>
    {open && <button className="nav-backdrop" onClick={() => setOpen(false)} aria-label="Fermer la navigation" />}
    <aside className={`sidebar ${open ? "is-open" : ""}`}>
      <div className="brand-row">
        <div className="brand-mark" aria-hidden="true"><span /></div>
        <div><div className="brand-name">KŌEKI</div><div className="brand-subtitle">Service économique</div></div>
        <button className="sidebar-close" onClick={() => setOpen(false)} aria-label="Fermer"><X /></button>
      </div>
      <div className="rp-clock"><span>Année RP</span><strong>48</strong><small>Jour fiscal 3 sur 7</small><div><i style={{ width: "43%" }} /></div></div>
      <nav aria-label="Navigation principale">
        <p className="nav-label">Registres de Suna</p>
        {navigation.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return <Link key={href} href={href} className={active ? "active" : ""} onClick={() => setOpen(false)}><Icon size={18} aria-hidden="true" /><span>{label}</span>{label === "Recouvrement" && <b>12</b>}</Link>;
        })}
      </nav>
      <div className="sidebar-footer">
        <button><span className="agent-avatar">SH</span><span><strong>Sonemi Hakumei</strong><small>Responsable Kōeki</small></span><ChevronDown size={16} /></button>
        <div className="secure-line"><ShieldCheck size={14} /> Session sécurisée</div>
      </div>
    </aside>
    <main id="main" className="main-content">{children}</main>
  </div>;
}

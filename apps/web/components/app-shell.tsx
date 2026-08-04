"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3, BookOpenText, Boxes, FileText, HandCoins,
  LayoutDashboard, LogOut, Menu, PackageSearch, ScrollText, Settings, ShieldCheck, Trophy, Users, X
} from "lucide-react";
import type { ShellInfo } from "@/lib/types";

const navigation = [
  { href: "/", label: "Vue d’ensemble", icon: LayoutDashboard },
  { href: "/ninjas", label: "Ninjas", icon: Users },
  { href: "/recouvrement", label: "Recouvrement", icon: HandCoins },
  { href: "/resources", label: "Ressources", icon: PackageSearch },
  { href: "/inventory", label: "Inventaire", icon: Boxes },
  { href: "/crafting", label: "Artisanat", icon: BookOpenText },
  { href: "/events", label: "Événements", icon: Trophy },
  { href: "/statistics", label: "Statistiques", icon: BarChart3 },
  { href: "/reports", label: "Rapports", icon: FileText },
  { href: "/audit", label: "Registre d’audit", icon: ScrollText },
  { href: "/admin", label: "Administration", icon: Settings }
];

export function AppShell({ children, shell, allowed }: { children: React.ReactNode; shell: ShellInfo; allowed: string[] }) {
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
      <div className="rp-clock"><span>Année RP</span><strong>{shell.rpYear}</strong><small>{shell.rpDayLabel}</small><div><i style={{ width: `${Math.round(shell.rpProgress * 100)}%` }} /></div></div>
      <nav aria-label="Navigation principale">
        <p className="nav-label">Registres de Suna</p>
        {navigation.filter(({ href }) => allowed.includes(href)).map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return <Link key={href} href={href} className={active ? "active" : ""} onClick={() => setOpen(false)}><Icon size={18} aria-hidden="true" /><span>{label}</span>{label === "Recouvrement" && shell.overdueCount > 0 && <b aria-label={`${shell.overdueCount} dossiers en retard`}>{shell.overdueCount}</b>}</Link>;
        })}
      </nav>
      <div className="sidebar-footer">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- route handler (NextAuth signout), pas une page */}
        <a href="/api/auth/signout" title="Se déconnecter"><span className="agent-avatar">{shell.userName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span><strong>{shell.userName}</strong><small>{shell.userRoleLabel}</small></span><LogOut size={16} aria-hidden="true" /></a>
        <div className="secure-line"><ShieldCheck size={14} /> Session sécurisée</div>
      </div>
    </aside>
    <main id="main" className="main-content">{children}</main>
  </div>;
}

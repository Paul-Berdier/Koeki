"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeftRight, Bell, Boxes, ChevronLeft, ChevronRight, ClipboardList, FileText, LayoutDashboard, LogOut, Menu, ScrollText, Settings, Trophy, UserCircle2, Users, X } from "lucide-react";
import type { ShellInfo } from "@/lib/types";

const navigation = [
  { label: "Quotidien", items: [
    { href: "/", label: "Accueil", icon: LayoutDashboard },
    { href: "/operations", label: "Opérations", icon: ArrowLeftRight },
    { href: "/ninjas", label: "Ninjas", icon: Users },
    { href: "/taches", label: "Tâches de suivi", icon: ClipboardList },
    { href: "/reports", label: "Rapports", icon: FileText },
    { href: "/classement", label: "Classement", icon: Trophy }
  ] },
  { label: "Stocks et ressources", items: [
    { href: "/inventory", label: "Inventaire", icon: Boxes },
    { href: "/inventory/movements", label: "Mouvements", icon: ArrowLeftRight },
    { href: "/inventory/counts", label: "Comptages", icon: ClipboardList },
    { href: "/resources", label: "Catalogue et rachats", icon: Boxes },
    { href: "/crafting", label: "Artisanat", icon: Settings }
  ] },
  { label: "Village", items: [
    { href: "/profil", label: "Ma fiche", icon: UserCircle2 },
    { href: "/dons", label: "Dons", icon: ArrowLeftRight },
    { href: "/recouvrement", label: "Recouvrement", icon: ScrollText },
    { href: "/equipement", label: "Équipement", icon: Boxes },
    { href: "/events", label: "Événements", icon: Trophy },
    { href: "/statistics", label: "Statistiques", icon: LayoutDashboard }
  ] },
  { label: "Responsable", items: [
    { href: "/equipe", label: "Équipe", icon: Users },
    { href: "/admin/comptes", label: "Comptes", icon: UserCircle2 },
    { href: "/admin", label: "Administration", icon: Settings },
    { href: "/audit", label: "Audit", icon: ScrollText }
  ] }
];

export function AppShell({ children, shell, allowed, demo = false }: { children: React.ReactNode; shell: ShellInfo; allowed: string[]; demo?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { setCollapsed(localStorage.getItem("koeki.nav") === "collapsed"); }, []);
  const toggleCollapsed = () => setCollapsed((current) => { const next = !current; localStorage.setItem("koeki.nav", next ? "collapsed" : "expanded"); return next; });
  const groups = navigation.map((group) => ({ ...group, items: group.items.filter((item) => allowed.includes(item.href)) })).filter((group) => group.items.length);
  const activeHref = groups.flatMap((group) => group.items.map((item) => item.href)).filter((href) => href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`)).sort((a, b) => b.length - a.length)[0];
  function contents(mobile: boolean) {
    return <>
      <div className="brand-row"><div className="brand-mark" aria-hidden="true"><span /></div><div><div className="brand-name">KŌEKI</div><div className="brand-subtitle">Registre de Suna</div></div>{mobile && <Dialog.Close className="sidebar-close" aria-label="Fermer la navigation"><X /></Dialog.Close>}</div>
      <div className="rp-clock"><span>Année RP</span><strong>{shell.rpYear}</strong><small>{shell.rpDayLabel}</small><div><i style={{ width: `${Math.round(shell.rpProgress * 100)}%` }} /></div></div>
      <nav aria-label={mobile ? "Navigation mobile" : "Navigation principale"}>
        {groups.map((group, index) => {
          const links = group.items.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={href === activeHref ? "active" : ""} aria-current={href === activeHref ? "page" : undefined} title={label} onClick={() => setOpen(false)}><Icon size={18} aria-hidden="true" /><span>{label}</span></Link>);
          return index === 0 || group.label === "Responsable" ? <div key={group.label}><p className="nav-label">{group.label}</p>{links}</div> : <details key={group.label} className="nav-section" open={group.items.some((item) => item.href === activeHref)}><summary>{group.label}</summary>{links}</details>;
        })}
      </nav>
      <div className="sidebar-footer">
        {allowed.includes("/notifications") && <Link href="/notifications" onClick={() => setOpen(false)}><Bell size={18} aria-hidden="true" /><span>Notifications</span></Link>}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Auth.js route handler */}
        <a href="/api/auth/signout" title={`${shell.userName} — se déconnecter`}><span className="agent-avatar">{shell.userName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2)}</span><span><strong>{shell.userName}</strong><small>{shell.userRoleLabel}</small></span><LogOut size={18} aria-hidden="true" /></a>
      </div>
    </>;
  }
  return <div className={`app-shell${collapsed ? " nav-collapsed" : ""}`}>
    <a className="skip-link" href="#main">Aller au contenu</a>
    <aside className="sidebar desktop-sidebar"><button className="nav-collapse" onClick={toggleCollapsed} aria-label={collapsed ? "Déplier la navigation" : "Replier la navigation"}>{collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</button>{contents(false)}</aside>
    <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Trigger className="mobile-menu" aria-label="Ouvrir la navigation"><Menu aria-hidden="true" /><span>Menu</span></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="navigation-overlay" /><Dialog.Content className="sidebar mobile-sidebar"><Dialog.Title className="sr-only">Navigation Kōeki</Dialog.Title><Dialog.Description className="sr-only">Accédez aux pages autorisées pour votre compte.</Dialog.Description>{contents(true)}</Dialog.Content></Dialog.Portal></Dialog.Root>
    <main id="main" className="main-content" tabIndex={-1}>{demo && <div className="demo-banner">Démonstration — données fictives, écritures désactivées</div>}{children}</main>
  </div>;
}

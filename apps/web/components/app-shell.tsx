"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowLeftRight,
  Bell,
  Boxes,
  ChevronRight,
  ClipboardList,
  Compass,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings2,
  UserCircle2,
  Users,
  X,
} from "lucide-react";
import type { ShellInfo } from "@/lib/types";
import { workspaceNavigation } from "@/lib/workspace-navigation";

const icons = {
  desk: LayoutDashboard,
  dossiers: Users,
  operations: ArrowLeftRight,
  stocks: Boxes,
  work: ClipboardList,
  management: Compass,
  admin: Settings2,
  village: UserCircle2,
};

export function AppShell({
  children,
  shell,
  allowed,
  demo = false,
}: {
  children: React.ReactNode;
  shell: ShellInfo;
  allowed: string[];
  demo?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const modules = workspaceNavigation(allowed);
  const match = modules
    .flatMap((module) => module.routes.map((route) => ({ module, route })))
    .filter(({ route }) =>
      route.href === "/"
        ? pathname === "/"
        : pathname === route.href || pathname.startsWith(`${route.href}/`),
    )
    .sort((a, b) => b.route.href.length - a.route.href.length)[0];
  const active = match?.module;
  const sectionName =
    active?.label ??
    (pathname === "/notifications" ? "Notifications" : "Mon profil");

  function contents(mobile: boolean) {
    return (
      <>
        <Link
          href="/"
          className="brand-row"
          onClick={() => setOpen(false)}
          aria-label="Kōeki — bureau"
        >
          <span className="brand-symbol" aria-hidden="true">
            砂
          </span>
          <span>
            <strong className="brand-name">
              KŌEKI<span>.</span>
            </strong>
            <small className="brand-subtitle">Service économique · Suna</small>
          </span>
        </Link>
        {mobile && (
          <Dialog.Close
            className="sidebar-close"
            aria-label="Fermer la navigation"
          >
            <X />
          </Dialog.Close>
        )}
        <nav
          aria-label={mobile ? "Navigation mobile" : "Navigation principale"}
        >
          <p className="nav-label">Espace de travail</p>
          {modules.map((module) => {
            const Icon = icons[module.id];
            return (
              <Link
                key={module.id}
                href={module.routes[0]!.href}
                className={active?.id === module.id ? "active" : undefined}
                aria-current={active?.id === module.id ? "location" : undefined}
                onClick={() => setOpen(false)}
              >
                <Icon size={19} aria-hidden="true" />
                <span>{module.label}</span>
                {module.id === "management" && allowed.includes("/equipe") && (
                  <span className="nav-role-dot" aria-label="Responsable" />
                )}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-service">
          <span className="service-seal" aria-hidden="true">
            砂
          </span>
          <div>
            <strong>Au service du village</strong>
            <small>Registres & ressources</small>
          </div>
        </div>
        <div className="sidebar-footer">
          {allowed.includes("/notifications") && (
            <Link href="/notifications" onClick={() => setOpen(false)}>
              <Bell size={18} aria-hidden="true" />
              <span>Notifications</span>
            </Link>
          )}
          <Link
            href="/profil"
            className="sidebar-identity"
            onClick={() => setOpen(false)}
          >
            <span className="agent-avatar" aria-hidden="true">
              {shell.userName
                .split(/\s+/)
                .map((part) => part[0])
                .join("")
                .slice(0, 2)}
            </span>
            <span>
              <strong>{shell.userName}</strong>
              <small>{shell.userRoleLabel}</small>
            </span>
          </Link>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Auth.js route handler */}
          <a href="/api/auth/signout" className="signout-link">
            <LogOut size={16} aria-hidden="true" />
            <span>Se déconnecter</span>
          </a>
        </div>
      </>
    );
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Aller au contenu
      </a>
      <aside className="sidebar desktop-sidebar">{contents(false)}</aside>
      <div className="main-content">
        <header className="workspace-header">
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger
              className="mobile-menu"
              aria-label="Ouvrir la navigation"
            >
              <Menu aria-hidden="true" />
              <span>Menu</span>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="navigation-overlay" />
              <Dialog.Content className="sidebar mobile-sidebar">
                <Dialog.Title className="sr-only">
                  Navigation Kōeki
                </Dialog.Title>
                <Dialog.Description className="sr-only">
                  Accédez aux espaces autorisés pour votre compte.
                </Dialog.Description>
                {contents(true)}
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <div className="workspace-location">
            <span>Kōeki</span>
            <ChevronRight size={14} aria-hidden="true" />
            <strong>{sectionName}</strong>
          </div>
          <div className="workspace-date">
            <span>
              Année RP <strong>{shell.rpYear}</strong>
            </span>
            <span>{shell.rpDayLabel}</span>
          </div>
        </header>
        {active && active.routes.length > 1 && (
          <nav
            className="workspace-tabs"
            aria-label={`Rubriques ${active.label}`}
          >
            {active.routes.map((route) => (
              <Link
                href={route.href}
                key={route.href}
                aria-current={
                  match?.route.href === route.href ? "page" : undefined
                }
              >
                {route.label}
              </Link>
            ))}
          </nav>
        )}
        <main id="main" tabIndex={-1}>
          {demo && (
            <div className="demo-banner">
              Démonstration — données fictives, écritures désactivées
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}

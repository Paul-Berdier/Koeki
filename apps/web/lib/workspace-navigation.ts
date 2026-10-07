/** Presentation only. The allowed routes come from the central permission matrix. */
const modules = [
  { id: "desk", label: "Bureau", routes: [{ href: "/", label: "Bureau" }] },
  { id: "dossiers", label: "Dossiers ninjas", routes: [{ href: "/ninjas", label: "Dossiers" }, { href: "/recouvrement", label: "Recouvrement" }] },
  { id: "operations", label: "Opérations", routes: [{ href: "/operations", label: "Nouvelle opération" }, { href: "/dons", label: "Dons" }, { href: "/resources/transaction", label: "Rachats" }, { href: "/equipement", label: "Équipement" }] },
  { id: "stocks", label: "Stocks & catalogue", routes: [{ href: "/inventory", label: "Inventaire" }, { href: "/inventory/movements", label: "Mouvements" }, { href: "/inventory/counts", label: "Comptages" }, { href: "/resources", label: "Catalogue" }, { href: "/resources/valeurs", label: "Valeurs & tarifs" }, { href: "/crafting", label: "Artisanat" }] },
  { id: "work", label: "Tâches & rapports", routes: [{ href: "/taches", label: "Tâches" }, { href: "/reports", label: "Rapports" }] },
  { id: "management", label: "Pilotage", routes: [{ href: "/equipe", label: "Équipe" }, { href: "/equipe/taxes", label: "Taxes par agent" }, { href: "/classement", label: "Classement hebdomadaire" }, { href: "/statistics", label: "Économie" }] },
  { id: "village", label: "Vie du village", routes: [{ href: "/events", label: "Événements" }] },
  { id: "admin", label: "Administration", routes: [{ href: "/admin/comptes", label: "Comptes & accès" }, { href: "/admin", label: "Réglages" }, { href: "/audit", label: "Journal d’audit" }] },
] as const;

export function workspaceNavigation(allowed: string[]) {
  return modules.map((module) => ({ ...module,
    label: module.id === "management" && !allowed.includes("/equipe") ? "Résultats" : module.label,
    routes: module.routes.filter((route) => allowed.includes(route.href)),
  })).filter((module) => module.routes.length);
}

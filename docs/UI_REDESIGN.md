# Refonte UI « Registre de Suna » — journal de refonte

Branche `refonte-ui`. Aucune fonctionnalité, route, permission ou donnée modifiée :
la refonte porte sur `globals.css` (tokens + composants), `packages/ui`
(primitives), le shell et la composition des pages. Une seule addition de données,
non destructive : `NinjasData.stats` (chiffres du bandeau d'en-tête).

## Ce qui a été refait

- **Fondations** : système de tokens complet (couleurs, typo, espacement, rayons,
  ombres, mouvement), réécriture intégrale de `apps/web/app/globals.css` — toutes
  les classes existantes conservées, donc chaque page hérite du nouveau style.
- **AppShell** : navigation groupée (Ninjas / Économie / Analyse /
  Administration), sidebar repliable (préférence mémorisée), rail or actif,
  compteur de retards, drawer mobile, identité au pied (ninja lié, rôle).
- **PageHeader** : nouveau bandeau `metrics` (chiffres clés sous la description).
- **Salle des comptes** : zones hiérarchisées (Revenus de Suna → Économie et
  stocks → Dernières opérations) via `ZoneTitle`, montants alignés.
- **Ninjas** : en-tête chiffré (dossiers / à jour / en retard / dette), bascule
  **table ⇄ cartes** mémorisée (`NinjaViews`), colonnes numériques à droite,
  cartes compactes avec « Voir → ».
- **Fiche ninja** : onglets (`Aperçu · Semaines fiscales · Opérations · Gestion`)
  — le règlement, l'identité et les points en Aperçu ; l'historique fiscal en
  onglet dédié avec colonnes Montant/Majorations/Corrections/Payé/Reste.
- **Statistiques** : tranches thématiques (Économie du village · Ninjas et dons ·
  Agents et ressources).
- **Connexion** : nouvelle page `/connexion` (sceau, dunes, Discord), branchée
  dans Auth.js (`pages.signIn`) et `requireSession` ; invitation harmonisée.
- **Docs** : `docs/DESIGN_SYSTEM.md` réécrit comme référence unique.

## Fichiers créés

`apps/web/app/connexion/page.tsx`, `apps/web/components/detail-tabs.tsx`,
`apps/web/components/ninja-views.tsx`, `demo.cjs` (serveur de démo local pour
l'audit visuel : `node demo.cjs` → http://localhost:3005, aucune base requise),
`docs/UI_REDESIGN.md`.

## Audit visuel réalisé (mode démo, build de production)

Desktop 1280×800 : salle des comptes, ninjas (table et cartes), fiche (onglets),
statistiques, artisanat, connexion. Mobile 390×844 : ninjas (cartes), drawer de
navigation. Aucun overflow horizontal, aucune erreur console.

## Reste à faire (pistes)

- Palette de commandes Ctrl+K et recherche globale (non implémentées — nécessitent
  un endpoint de recherche transverse).
- Tests E2E Playwright sur les parcours critiques.
- Représentation mobile spécifique des tables secondaires (audit, inventaire)
  au-delà du défilement horizontal.
- Skeletons par page (le composant `.skeleton` existe, non branché partout).

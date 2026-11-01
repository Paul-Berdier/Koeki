# Refonte du front Kōeki — suivi

Refonte initiale : PR #3, fusionnée dans `f381792`. Corrections des retours utilisateur : branche `codex/restore-jonin-equipment`, depuis cette révision.

## Demande

Reprendre la logique du front, supprimer les doublons, revoir la direction artistique et donner aux responsables un espace concret de suivi des agents, de leur travail et de leur activité.

## Réalisation

- Navigation par espaces : Bureau, Dossiers, Équipements Jōnin+, Opérations, Stocks et catalogue, Tâches et rapports, Pilotage, Village et Administration. Les sous-rubriques sont locales à chaque espace et filtrées par les permissions centrales. L'équipement conserve un accès direct dans le menu ordinateur et mobile ; les sept emplacements et les grades Jōnin, commandant Jōnin, Kage et Sanin restent inchangés.
- Nouveau système clair « Sable & encre » : surfaces claires, navigation en encre verte, typographie sans empattement, accents sable, composants et états partagés. Feuilles séparées en fondations, modules existants et nouveaux espaces.
- Bureau recentré sur les actions et échéances ; espace responsable distinct.
- `/equipe` : synthèse, courbes quotidiennes, tâches à traiter et registre recherchable/triable/paginé. Périodes civiles de 7, 30 ou 90 jours, ou intervalle de 1 à 366 jours pour les indicateurs.
- Les dossiers ninjas sont communs au service : aucun référent, filtre « mes dossiers », transfert ou indicateur d’affectation ninja. Les tâches restent attribuables à des agents.
- Fiche agent : aperçu avec courbe, journal paginé des opérations et accompagnement confidentiel. Les liens conservent la période ; les mutations d’accompagnement conservent l’onglet.
- Journal complet `/classement/agents/[userId]` : aucune limite d’ancienneté par défaut, 25 écritures par page, accessible à l’agent pour lui-même et aux dirigeants pour tous. Les imports et écritures sans preuve restent consultables avec leur provenance ; leur affichage ne les rend pas éligibles au classement.
- Les courbes et les agents utilisent les mêmes agrégats SQL. Jours sans opération inclus, montants fiscaux BigInt sérialisés en chaînes exactes. Aucun montant n’est converti en Number pour ces graphiques.
- Charge actuelle et activité de période sont explicitement distinguées. Les agents sans activité et les périodes de participation/absence restent visibles.
- La page Économie ne contient plus de second classement 60/40 ; le classement hebdomadaire demeure la référence collective.
- Tâches, rapports, comptes et réglages simplifiés ; formulaires secondaires dépliables. Les ressources, dons et recettes utilisent des tableaux ou cartes lisibles en pleine largeur.
- Correction du parcours rachat : le formulaire s’ouvre sur BUYBACK ; DONATION est explicite et conservé après erreur. Les mutations et contrôles financiers restent ceux du service existant.

## Protection des données

Aucune modification de barème, suppression de données, modification de `.env` ou écriture manuelle en production. La migration additive `0021_receipt_audit_backfill` récupère des preuves de règlements anciens uniquement quand auteur, reçu et date concordent avec un audit unique. Les montants, dates financières, participations et versions publiées restent inchangés ; les périodes publiées concernées sont signalées pour examen. Les références ninja anciennes restent conservées dans le schéma, mais ne pilotent plus les parcours, y compris après un retrait d’accès.

Le fichier personnel `.claude/settings.local.json` reste hors périmètre. Base de rendu et tests authentifiés locale : `koeki_front_test_20261004`, serveur loopback port 55432. Les fixtures sont fictives. Les tests d’intégration utilisent les bases jetables explicitement autorisées ; les vérifications de reprise créent une nouvelle base par exécution sans réinitialiser les bases existantes.

## Validation de la refonte initiale (PR #3)

- Domaine : 94 tests réussis. Web : 73 tests réussis, dont 55 PostgreSQL et 18 unitaires. Total : 167, sans test ignoré et avec `REQUIRE_TEST_DATABASE=true`.
- ESLint du dépôt, TypeScript et compilation complète de production : réussis.
- Parcours authentifiés : les 7 scénarios ont été validés sur bureau, tablette et mobile, soit 21 combinaisons, avec relances ciblées après correction des problèmes relevés. Ils vérifient les rôles, la révocation effective, les rapports et tâches, les agrégats quotidiens et de période, la pagination, la confidentialité des notes et le parcours don/rachat.
- Accessibilité : axe sur 7 routes dans les 3 formats, navigation mobile au clavier, fermeture et restitution du focus, absence de débordement à 200 % de zoom. Ces contrôles automatisés ne constituent pas un audit exhaustif.
- Démonstration sur compilation de production : 24 parcours réussis ; les 10 exclusions prévues par format restent explicites. Aucun échec de parcours, de rendu ou de CSP.

Les contrôles authentifiés utilisent de vraies sessions Auth.js et des fixtures PostgreSQL isolées. Aucune capture de démonstration n’est présentée comme une preuve d’accès authentifié. Les agents sans opération, les changements continus de rôle et les véritables interruptions de participation sont couverts par les tests du service analytique.

## Validation des corrections

La reprise `0021` possède un test PostgreSQL dédié (`pnpm test:ranking-backfill`), inclus dans la CI, qui vérifie les preuves concordantes, les cas ambigus exclus, l’immuabilité des montants et la réexécution. Les tests de navigation ouvrent désormais les équipements depuis le menu ordinateur et mobile, plutôt que directement par URL. Les parcours authentifiés couvrent le registre partagé et l’historique individuel paginé.

### Preuves visuelles authentifiées

- [Bureau agent](evidence/front-v3-agent-home-desktop.png)
- [Pilotage responsable](evidence/front-v3-team-desktop.png)
- [Pilotage mobile et cartes agents](evidence/front-v3-team-mobile.png)
- [Fiche agent](evidence/front-v3-agent-detail-desktop.png)
- [Accompagnement réservé](evidence/front-v3-agent-accompagnement-desktop.png)
- [Comptes et accès](evidence/front-v3-accounts-desktop.png)
- [Confirmation de retrait](evidence/front-v3-revoke-dialog-desktop.png)

### Commandes locales vérifiées (PowerShell)

Node 24.19.0 et pnpm 11.9.0, sans modification des fichiers `.env`. Les URL de base sont fournies uniquement au processus ; hôte loopback et noms des bases jetables sont vérifiés avant exécution.

```powershell
$env:REQUIRE_TEST_DATABASE = 'true'
# DATABASE_URL_TEST : base locale koeki_v2_integration_test, port 55432
corepack pnpm test
corepack pnpm lint
corepack pnpm --filter @koeki/web typecheck
corepack pnpm build
# DATABASE_URL_TEST : base locale koeki_front_test_20261004, port 55432
corepack pnpm test:e2e:auth
```

Sur cette machine Windows, le serveur de test a été lancé séparément et `E2E_EXTERNAL_SERVER=true` utilisé pour éviter les difficultés de cycle de vie du processus enfant. Le port 3100 a été vérifié libre avant son démarrage. La CI Linux utilise le serveur géré par Playwright et la base locale dédiée `koeki_v2_test` ; elle rejoue aussi la vérification de migration V1 → V2 déjà livrée.

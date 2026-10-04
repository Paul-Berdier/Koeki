# KŌEKI — Service économique de Suna

Application privée de gestion économique pour un univers fictif de jeu de rôle. Le dépôt est indépendant, utilise sa propre base PostgreSQL et ne contient aucune dépendance vers La Toile d’Or.

## Démarrage local

Prérequis : Node.js 22.13+ (24.19.0 vérifié), pnpm **11.9.0** via Corepack, Docker pour PostgreSQL. pnpm 11.9.0 exige Node 22.13+ ; l’ancienne indication Node 20 n’était pas compatible.

```powershell
# Seulement si aucun fichier .env n’existe déjà :
if (!(Test-Path .env)) { Copy-Item .env.example .env }
docker compose up -d postgres
corepack pnpm install --frozen-lockfile
corepack pnpm db:generate
corepack pnpm db:migrate
corepack pnpm db:seed
corepack pnpm dev
```

Le mode de démonstration (`DEMO_MODE=true`) affiche uniquement des données fictives et contourne l’authentification pour le développement local. Il ne doit jamais être activé en production. Sans cette variable, toutes les pages lisent la base PostgreSQL et toutes les opérations (invitations, paiements, dons, rachats, ajustements, fabrications, rapports, réglages) sont de vraies écritures transactionnelles avec permissions vérifiées côté serveur et audit.

## Commandes disponibles

```powershell
corepack pnpm dev
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:e2e
corepack pnpm build
corepack pnpm db:generate
corepack pnpm db:migrate
corepack pnpm db:deploy
corepack pnpm db:seed
corepack pnpm db:seed:bootstrap
corepack pnpm db:invite
corepack pnpm worker taxes:generate
corepack pnpm worker penalties:apply
corepack pnpm worker reminders:send
corepack pnpm worker inventory:check
corepack pnpm worker inventory:reconcile
corepack pnpm worker stats:refresh
corepack pnpm worker all
```

## Structure

- `apps/web` : Next.js, interface, Auth.js et routes serveur ;
- `apps/worker` : tâches idempotentes ;
- `packages/database` : Prisma, migration initiale et seed ;
- `packages/domain` : montants, temps RP, taxes, paiements, points et artisanat ;
- `packages/ui` : composants visuels partagés ;
- `packages/auth` : invitations et règles de session ;
- `packages/config` : validation des variables serveur ;
- `docs` : décisions, sécurité et exploitation.

## Protection des données

Les Ryō sont des entiers (`BigInt`). Les écritures validées sont corrigées par contre-écriture. Le navigateur ne détermine jamais un prix, un solde, une allocation ou une pénalité définitive. Les invitations sont à usage unique et seul leur hash poivré est stocké.

Consulter [l’architecture](docs/ARCHITECTURE.md), [la sécurité](docs/SECURITY.md), [l’inventaire](docs/INVENTORY.md) et [le déploiement Railway](docs/RAILWAY_DEPLOYMENT.md).

## Kōeki V2 et validation isolée

Voir [les décisions](docs/KOEKI_V2_SPEC.md), [la progression](docs/KOEKI_V2_PROGRESS.md),
[les preuves et limites](docs/KOEKI_V2_VALIDATION.md), [le guide équipe/rapports](docs/EQUIPE_RAPPORTS.md)
et [les règles du classement](docs/CLASSEMENT.md).

Les tests d’intégration refusent les hôtes distants et acceptent uniquement les
bases locales jetables explicitement nommées. `REQUIRE_TEST_DATABASE=true` et la CI
rendent toute indisponibilité de PostgreSQL bloquante. Les E2E authentifiés sont
distincts de `test:e2e`, suite historique de démonstration.

```powershell
docker compose -f docker-compose.test.yml -p koeki-v2-validation up -d
$env:DATABASE_URL_TEST = 'postgresql://koeki:koeki-local-fixture@127.0.0.1:55432/koeki_v2_integration_test?schema=public'
$env:REQUIRE_TEST_DATABASE = 'true'
corepack pnpm db:generate
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
# Base distincte pour les captures et sessions E2E :
$env:DATABASE_URL_TEST = 'postgresql://koeki:koeki-local-fixture@127.0.0.1:55432/koeki_v2_test?schema=public'
$env:DATABASE_URL = $env:DATABASE_URL_TEST
$env:DEMO_MODE = 'false'
corepack pnpm db:deploy
corepack pnpm test:upgrade
corepack pnpm build
corepack pnpm test:e2e:auth
```

Le conteneur de test utilise un stockage temporaire, sans volume de données réelles.
Ces identifiants servent exclusivement aux fixtures locales. Ne jamais utiliser
ces commandes de test ou le seed fictif sur une base utilisateur ou de production.
La suite crée directement des sessions Auth.js isolées ; elle n’ajoute aucun
contournement HTTP d’authentification. Le parcours OAuth Discord complet nécessite
les identifiants de l’application Discord et reste distinct.

Sous Windows, si l’arrêt du serveur Playwright intégré attend indéfiniment,
utiliser `E2E_EXTERNAL_SERVER=true` avec le serveur explicitement démarré :
les [commandes complètes vérifiées](docs/KOEKI_V2_VALIDATION.md#reproduire-sous-powershell)
décrivent les deux terminaux. Arrêter le serveur de développement avant un build.
Les E2E historiques de démonstration disposent de `E2E_DEMO_EXTERNAL_SERVER=true`
pour le même usage et activent désormais JavaScript sur tous leurs formats.

Sur Unix, les variables s’exportent avec `export DATABASE_URL_TEST='…'` et
`export REQUIRE_TEST_DATABASE=true` ; les commandes Corepack sont identiques.
Cette syntaxe Unix est préparée dans la CI, pas présentée comme exécutée sous Windows.

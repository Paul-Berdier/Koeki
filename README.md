# KŌEKI — Service économique de Suna

Application privée de gestion économique pour un univers fictif de jeu de rôle. Le dépôt est indépendant, utilise sa propre base PostgreSQL et ne contient aucune dépendance vers La Toile d’Or.

## Démarrage local

Prérequis : Node.js 20.18+, pnpm 10+, Docker.

```powershell
Copy-Item .env.example .env
docker compose up -d postgres
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Le mode de démonstration (`DEMO_MODE=true`) affiche uniquement des données fictives et contourne l’authentification pour le développement local. Il ne doit jamais être activé en production. Sans cette variable, toutes les pages lisent la base PostgreSQL et toutes les opérations (invitations, paiements, dons, rachats, ajustements, fabrications, rapports, réglages) sont de vraies écritures transactionnelles avec permissions vérifiées côté serveur et audit.

## Commandes vérifiées

```powershell
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm db:generate
pnpm db:migrate
pnpm db:deploy
pnpm db:seed
pnpm db:seed:bootstrap
pnpm db:invite
pnpm worker taxes:generate
pnpm worker penalties:apply
pnpm worker reminders:send
pnpm worker inventory:check
pnpm worker stats:refresh
pnpm worker all
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

Consulter [l’architecture](docs/ARCHITECTURE.md), [la sécurité](docs/SECURITY.md) et [le déploiement Railway](docs/RAILWAY_DEPLOYMENT.md).

# Architecture

## Décision

Kōeki est un monorepo pnpm TypeScript strict. `koeki-web`, `koeki-worker` et `koeki-postgres` sont trois services Railway isolés. Aucune table, migration, variable de session ou secret n’est partagé avec La Toile d’Or.

```text
apps/web ───────┬── packages/auth
                ├── packages/domain
                ├── packages/ui
                └── packages/database ── koeki-postgres
apps/worker ────┴── packages/domain + packages/database
```

## Frontières

- `domain` ne dépend ni de React ni de Prisma ; ses fonctions sont déterministes et testables.
- `database` expose le client Prisma PostgreSQL avec l’adaptateur `pg` sans moteur natif.
- `web` vérifie l’identité, les permissions et les entrées avant toute transaction.
- `worker` rejoue sans doublon grâce aux contraintes uniques, `createMany(skipDuplicates)` et index d’application.
- les données de démonstration sont fictives et isolées par `DEMO_MODE`.

## Cohérence financière

Chaque commande financière suit : validation Zod → permission serveur → transaction PostgreSQL → recalcul serveur → écriture immuable → audit. Les clés d’idempotence et versions optimistes protègent les doubles soumissions.

## Modèle principal

Identité : `User`, `Account`, `Session`, `Invitation`, `Role`, `UserRole`. Ninjas : `NinjaProfile`, `NinjaGrade`, `NinjaGradeHistory`. Fiscalité : `TaxPolicy`, `TaxPolicyGradeRate`, `TaxYear`, `TaxAssessment`, `TaxPenalty`, `TaxPayment`, `TaxPaymentAllocation`, `TaxAdjustment`, `TaxExemption`. Registres : points, ressources, prix, transactions, stocks, recettes, exécutions, rapports, notifications, audits et idempotence.

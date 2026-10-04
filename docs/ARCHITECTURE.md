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

Identité : `User`, `Account`, `Session`, `Invitation`, `Role`, `UserRole`. Ninjas : `NinjaProfile`, `NinjaGrade`, `NinjaGradeHistory`. Fiscalité : `TaxPolicy`, `TaxPolicyGradeRate`, `TaxYear`, `TaxAssessment`, `TaxPenalty`, `TaxPayment`, `TaxPaymentAllocation`, `TaxAdjustment`, `TaxExemption`. Inventaire : `ResourceCategory`, `ResourceUnit`, `Resource`, `ResourceAlias`, `InventoryMovement` (ledger, source de vérité du stock), `StocktakeSession`, `StocktakeEntry`. Registres : points, prix, transactions, recettes, exécutions, rapports, notifications, audits et idempotence.

## Cohérence des stocks

Toute écriture de stock passe par `apps/web/lib/inventory-ledger.ts` (verrou de ligne, somme du ledger, refus du négatif, ligne immuable avec avant/après, contrepartie et agent). Des triggers PostgreSQL maintiennent le cache `Resource.currentQuantity`, remplissent les instantanés pour un écrivain ancien et interdisent la modification ou la suppression d’une ligne validée. Voir `docs/INVENTORY_TRACEABILITY.md`.

## Services V2

- `account-service` centralise acteur/cible/rôles, retrait, réactivation et transfert ;
  `invitation-service` revérifie les pouvoirs du créateur à la consommation ;
  `auth-session-adapter` invalide effectivement les sessions retirées.
- `team-service` borne les lectures d’équipe, expose des DTO selon le périmètre,
  conserve participation, absences et affectations ; `report-service` calcule les
  attentes explicites. Les avis de rapport et transitions de tâche sont historisés.
- Le domaine `weekly-ranking` fixe les semaines Europe/Paris et la formule.
  `database/ranking` partage collecte et clôture entre web et worker. Les versions
  clôturées sont immuables, les corrections motivées créent une version suivante.
- `lib/navigation` utilise exclusivement la matrice centrale ; un lien masqué ne
  remplace jamais la permission du service et de l’action. React `cache` est limité
  à la requête, aucun cache global de rôles n’est ajouté.
- Les notifications d’affectation, d’avis et d’échéance restent dans PostgreSQL.
  Le worker `reminders:send` déduplique les notifications internes ; aucun canal
  externe n’est ajouté.

La navigation ne charge plus les historiques financiers de tous les ninjas.
La fiche ninja cible un identifiant ; comptes et équipe paginent côté serveur.
Voir [les mesures et leurs limites](KOEKI_V2_PERFORMANCE.md),
[les décisions V2](KOEKI_V2_SPEC.md) et [la validation](KOEKI_V2_VALIDATION.md).

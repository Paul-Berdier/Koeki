# Rollback

## Application

1. Identifier la dernière version Kōeki saine dans Railway.
2. Suspendre temporairement `koeki-worker` pour éviter des écritures pendant le diagnostic.
3. Redéployer la version précédente de `koeki-web`.
4. Vérifier `/api/health`, la connexion sur invitation et une lecture fiscale.
5. Réactiver le worker uniquement après contrôle du schéma compatible.

## Base de données

Les migrations de production sont avancées avec `pnpm db:deploy` et ne sont pas annulées automatiquement. Pour un incident de données : mettre web et worker en maintenance, restaurer `koeki-postgres` vers une nouvelle instance temporaire, valider l’intégrité, puis basculer uniquement les variables des services Kōeki.

Ne jamais restaurer vers `toile-dor-postgres` et ne jamais modifier ses sauvegardes. Avant une migration destructive, utiliser une stratégie expand/migrate/contract et conserver une fenêtre de compatibilité avec la version précédente.

## Contrôles après restauration

Comparer le nombre de taxes, paiements, allocations, mouvements de stock, points et audits ; rechercher les clés d’idempotence dupliquées ; exécuter le worker en mode ciblé ; produire un rapprochement quotidien ; consigner l’incident.

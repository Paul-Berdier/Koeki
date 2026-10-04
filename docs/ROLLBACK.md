# Rollback

## Application

La procédure ci-dessous est préparée, elle n’a pas été exécutée en production pour V2.
Après les migrations V2, ne pas redéployer aveuglément l’application V1 : elle
réintroduirait les anciens droits d’audit et ne respecterait pas les nouveaux
workflows. Préférer un correctif compatible avec le schéma étendu, en conservant
les vérifications d’accès V2. La compatibilité doit être éprouvée sur une copie
isolée avant toute bascule autorisée.

1. Identifier la dernière version Kōeki saine dans Railway.
2. Suspendre temporairement `koeki-worker` pour éviter des écritures pendant le diagnostic.
3. Redéployer la version précédente de `koeki-web`.
4. Vérifier `/api/health`, la connexion sur invitation et une lecture fiscale.
5. Réactiver le worker uniquement après contrôle du schéma compatible.

## Base de données

Les migrations de production sont avancées avec `pnpm db:deploy` et ne sont pas annulées automatiquement. Pour un incident de données : mettre web et worker en maintenance, restaurer `koeki-postgres` vers une nouvelle instance temporaire, valider l’intégrité, puis basculer uniquement les variables des services Kōeki.

Une restauration ancienne perdrait les écritures postérieures si elles ne sont
pas réconciliées. Conserver d’abord un export/snapshot de l’état courant et le
journal disponible ; identifier les paiements, allocations, contre-écritures,
points, crédits, stocks, avis et versions de classement apparus depuis le point
restauré. Rejouer uniquement les écritures manquantes avec leurs identifiants et
clés d’idempotence après rapprochement. Ne pas rouvrir les écritures tant que les
comptages **et les sommes exactes** ne sont pas expliqués. Une clé dupliquée ou une
différence de montant impose une analyse, pas une remise à zéro.

Les migrations `0017` à `0020` sont additives. Conserver ces tables, colonnes,
contraintes et triggers lors d’un correctif applicatif ; ne pas les supprimer pour
obtenir un ancien schéma. `corepack pnpm test:upgrade` vérifie localement une montée
depuis les 16 migrations initiales, avec conservation d’écritures fictives et
réexécution sans changement. Ce test ne constitue pas un exercice de restauration
Railway ni une validation d’un ancien binaire contre le nouveau schéma.

Ne jamais restaurer vers `toile-dor-postgres` et ne jamais modifier ses sauvegardes. Avant une migration destructive, utiliser une stratégie expand/migrate/contract et conserver une fenêtre de compatibilité avec la version précédente.

## Contrôles après restauration

Comparer le nombre de taxes, paiements, allocations, mouvements de stock, points et audits ; rechercher les clés d’idempotence dupliquées ; exécuter le worker en mode ciblé ; produire un rapprochement quotidien ; consigner l’incident.

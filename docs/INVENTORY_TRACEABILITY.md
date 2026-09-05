# Traçabilité de l’inventaire

## Source de vérité

`InventoryMovement` est le ledger : la vérité du stock est `SUM(quantity)` par ressource.
`Resource.currentQuantity` et `lastMovementAt` sont des caches. Un trigger PostgreSQL
(`InventoryMovement_after_insert`) les met à jour à chaque insertion, dans la même transaction,
quelle que soit la révision d’application ou le script qui écrit.

## Une ligne de mouvement

| Champ | Sens |
|---|---|
| `type` | `INITIAL_BALANCE`, `IN`, `OUT`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, `DONATION_IN`, `BUYBACK_IN`, `CRAFT_CONSUMPTION`, `CRAFT_OUTPUT`, `TRANSFER_IN`, `TRANSFER_OUT`, `LOSS`, `RETURN_IN`, `REVERSAL`, `OTHER` (+ `MANUAL_ADJUSTMENT` historique) |
| `quantity` | signée : `+` entrée, `−` sortie ; `0` seulement pour `INITIAL_BALANCE` |
| `quantityBefore` / `quantityAfter` | stock de la ressource juste avant et juste après la ligne |
| `agentId` | agent Kōeki qui a **enregistré** |
| `counterpartyType` / `counterpartyNinjaId` / `counterpartyLabel` | qui a **donné** (entrée) ou **pris** (sortie) : ninja du registre ou personne externe ; le libellé est un instantané |
| `reason` (colonne `justification`) | motif |
| `notes` | note libre |
| `sourceType` / `sourceId` | origine : `ResourceTransaction`, `CraftExecution`, `StocktakeSession`, `InventoryMovement` (correction), `null` = saisie manuelle |
| `transactionId`, `craftExecutionId` | liens forts vers le reçu ou la fabrication |
| `reversedMovementId` | ligne annulée par cette correction (unique) |
| `idempotencyKey` | protection contre la double soumission |
| `occurredAt` | date |

Contrepartie et agent sont toujours deux champs distincts : « Donné par Aoki — Enregistré par
Paul ».

## Écrivain unique

`apps/web/lib/inventory-ledger.ts → recordMovement(tx, …)` est le seul chemin d’écriture :

1. verrou `SELECT … FOR UPDATE` de la ressource (`lockResources`, ids triés — jamais d’interblocage
   entre commandes multi-ressources) ;
2. `before = SUM(mouvements)` sur état verrouillé ;
3. contrôles : ressource active, précision de l’unité, quantité non nulle, stock résultant ≥ 0
   (sauf `allowNegative`, réservé à `inventory:adjust` et audité) ;
4. résolution de la contrepartie (nom du ninja instantané) ;
5. insertion de la ligne avec `before/after`, source, clé d’idempotence ;
6. le trigger met le cache à jour ; `markCounted` passe la ressource en `COUNTED`.

Rachats, dons (trois chemins), artisanat, comptages et corrections l’utilisent tous.

## Immutabilité

Le trigger `InventoryMovement_immutable` refuse au niveau base tout `DELETE` et toute modification
de `quantity`, `resourceId`, `type`, `occurredAt`, `agentId`, `idempotencyKey`, `before/after`
d’une ligne validée (`ERRCODE 23514`). Seules les annotations (notes, libellés) restent
modifiables. En cas d’incident, un administrateur peut désactiver temporairement le trigger en
base — jamais l’application.

## Correction

Une erreur ne se supprime pas : `reverseMovement` écrit une ligne `REVERSAL` de quantité opposée,
même contrepartie, `sourceType = InventoryMovement`, `reversedMovementId` = ligne d’origine. Une
ligne ne peut être annulée qu’une fois et une correction ne se corrige pas (on enregistre un
nouveau mouvement). Le journal affiche les deux lignes liées. Annuler le mouvement de stock d’un don
ou d’un rachat n’annule pas les points ni le crédit d’exonération : ces registres ont leurs propres
contre-écritures.

## Ancien conteneur pendant un déploiement

`justification` garde son nom de colonne (`reason` côté Prisma via `@map`), `unitId` a une valeur
par défaut en base et le trigger `InventoryMovement_before_insert` remplit `before/after` et la
source pour tout écrivain qui les omettrait. Une révision précédente continue donc d’écrire sans
casser la cohérence pendant la bascule Railway.

## Réconciliation

`reconcileInventory` compare `SUM(mouvements)` et `currentQuantity` pour chaque ressource :

- page Inventaire : bandeau « Inventaire incohérent » pour les responsables, avec l’action
  explicite « Réaligner sur le ledger (audité) » (`INVENTORY_RECONCILED`) ;
- worker `inventory:reconcile` (hebdomadaire) : audit `INVENTORY_RECONCILIATION_MISMATCH` et
  notification des responsables, une fois par jour et par ressource.

Rien n’est corrigé en silence. Les tests d’intégration vérifient l’égalité ledger / cache après
chaque scénario, y compris sous concurrence (`apps/web/lib/inventory-ledger.integration.test.ts`).

## Audit administratif

`AuditLog` trace les actions (jamais le détail déjà porté par la ligne de mouvement) :
`INVENTORY_IN`, `INVENTORY_OUT`, `INVENTORY_OUT_NEGATIVE`, `INVENTORY_ADJUSTED`,
`INVENTORY_ADJUSTED_NEGATIVE`, `INVENTORY_REVERSED`, `INVENTORY_RECONCILED`,
`INVENTORY_RECONCILIATION_MISMATCH`, `INVENTORY_ALERT`, `STOCKTAKE_OPENED`, `STOCKTAKE_IMPORTED`,
`STOCKTAKE_CONFIRMED`, `STOCKTAKE_CANCELLED`, `RESOURCE_CREATED`, `RESOURCE_UPDATED`,
`RESOURCE_THRESHOLDS_UPDATED`, `RESOURCE_DEACTIVATED`, `RESOURCE_REACTIVATED`, `RESOURCE_ALIGNED`,
`CATEGORY_CREATED`, `UNIT_CREATED`. Ils apparaissent dans le registre d’audit sous le thème
« Stocks et catalogue ».

## Reconstruire l’historique d’une ressource

Trier ses lignes par `occurredAt, id` : chaque `quantityBefore` égale le `quantityAfter`
précédent et la dernière ligne donne le stock. La migration `0016_inventory_traceability` a
rempli ces colonnes pour toutes les lignes antérieures par somme cumulée.

# Audit préalable — refonte de l’inventaire (5 septembre 2026)

Ce document est l’état des lieux réalisé avant la refonte du système d’inventaire et de
traçabilité des ressources. Il fixe aussi les décisions prises pour l’implémentation.
Les documents de référence après refonte sont `INVENTORY.md`, `RESOURCES.md`,
`INVENTORY_TRACEABILITY.md` et `INVENTORY_PERMISSIONS.md`.

## 1. État actuel de la gestion des ressources

- Un catalogue `Resource` existe (code `RES-XXX-NN`, nom, catégorie, seuils bas/critique,
  demande du village, points et exonération par unité donnée, prix historisés).
- Un journal `InventoryMovement` existe déjà et **le stock est déjà la somme des mouvements**
  (`groupBy resourceId` dans `apps/web/lib/data.ts`, `apps/worker/src/index.ts`,
  `crafting/actions.ts`, `inventory/actions.ts`). Aucun cache de quantité n’est stocké.
- La page `/inventory` actuelle est un journal de 12 mouvements + un formulaire d’ajustement
  signé (quantité positive ou négative) réservé à `inventory:write`, avec override de stock
  négatif pour `settings:manage`. Aucun tableau de toutes les ressources avec leur stock,
  aucune notion de « non inventorié », aucun comptage, aucune correction par contre-écriture.
- La page `/resources` affiche le catalogue avec une colonne « Stock » (somme des mouvements)
  et un état Disponible / Stock bas / Critique.

## 2. Tables existantes concernées

`ResourceCategory`, `Resource`, `ResourcePriceHistory`, `ResourceTransaction`,
`ResourceTransactionItem`, `InventoryMovement` (types `DONATION_IN`, `BUYBACK_IN`,
`CRAFT_CONSUMPTION`, `CRAFT_OUTPUT`, `MANUAL_ADJUSTMENT`, `TRANSFER_IN`, `TRANSFER_OUT`, `LOSS`),
`CraftRecipe`, `CraftRecipeIngredient`, `CraftRecipeOutput`, `CraftExecution`, `AuditLog`,
`NinjaProfile`, `User`, `PointLedgerEntry`, `ExemptionLedgerEntry`, `AppSetting`.
La table `ResourceUnit` de la migration initiale a été **supprimée** par la migration
`0007_points_per_unit_no_units` (« tout se compte en unités »).

## 3. Fonctionnement actuel du Rachat

`resources/actions.ts → recordResourceTransaction` : validation Zod, verrou du ninja,
prix actif rechargé, prix négocié ≤ catalogue, création `ResourceTransaction` (VALIDATED ou
PENDING_APPROVAL au-dessus du seuil), puis `applyValidatedTransaction` (`lib/finance.ts`) qui
crée **déjà** un `InventoryMovement BUYBACK_IN` par ligne (quantité, coût unitaire, reçu en
justification, agent = enregistreur), attribue les points et crédite l’exonération.
L’approbation managériale (`approveTransaction`) rejoue le même chemin.

## 4. Fonctionnement actuel du Don

Trois chemins créent des dons validés :
1. agent, via `/resources/transaction` (même action que le rachat, type DONATION) ;
2. ninja, via `/dons` (`declareOwnDonation` → PENDING_APPROVAL, puis `validateDonation` par
   un agent → `applyValidatedTransaction`) ;
3. règlement mixte d’une taxe (`ninjas/actions.ts → recordPayment`) : les objets donnés créent
   une `ResourceTransaction` DONATION et des `InventoryMovement DONATION_IN` **écrits
   directement**, sans passer par `applyValidatedTransaction` (logique dupliquée).

Dans tous les cas le stock est bien crédité, mais le mouvement ne connaît le ninja donateur
que par la jointure `transactionId → ResourceTransaction.ninjaId`.

## 5. Fonctionnement actuel de l’Artisanat

`crafting/actions.ts → executeCraft` : recette active, verrou des ressources concernées
(`lockResources`, `FOR UPDATE`), vérification du stock par ingrédient (somme des mouvements),
`CraftExecution`, puis mouvements `CRAFT_CONSUMPTION` (négatifs) et `CRAFT_OUTPUT`
(positifs), audit. Le calculateur de la page utilise `simulateCraft` sans écrire.

## 6. Problèmes de traçabilité actuels

- Pas de `quantityBefore` / `quantityAfter` sur les mouvements : reconstruire un historique
  demande de rejouer toute la somme.
- Pas de contrepartie explicite (qui a donné / qui a pris) : seulement l’agent et une
  justification libre ; impossible de filtrer « tous les mouvements liés à Aoki ».
- Pas de distinction entre « stock à 0 » et « jamais compté ». Toutes les ressources importées
  de l’ancien registre affichent 0 alors qu’elles n’ont jamais été inventoriées (l’import
  historique n’a volontairement créé aucun mouvement).
- Pas de correction : un mouvement erroné ne peut être ni annulé ni corrigé de façon liée.
- Pas de comptage physique ni d’écart audité.
- Pas de référentiel d’unités (kg, Ryō…) ; pas d’alias de recherche ; pas d’export.
- Trois chemins d’écriture différents pour les dons (voir § 4).
- Le seuil de stock est interprété à trois endroits (data.ts, worker, page ressources) avec
  la même règle mais sans fonction partagée.

## 7. Données existantes à préserver

- Tous les `InventoryMovement` (dons, rachats, fabrications, ajustements) : conservés tels
  quels ; enrichis par backfill (`quantityBefore/After` recalculés par somme cumulée ordonnée
  par date, contrepartie déduite de la transaction liée, `sourceType/sourceId`).
- Toutes les `ResourceTransaction` (dont 2 279 dons historiques importés sans mouvement).
- Le catalogue importé : `Bois`, `Laine`, `Plastique`, `Cuivre`, `Fer`, `Titane`,
  `Chakra Métal`, `Jade`, `T1`…`T4`, `Ryo` (désactivé par l’import : « c’est de la monnaie »),
  `Lavande`, `Cuir`, les équipements et plans spécifiques (`Plan Bague T2`…).
- Les prix, points/exonération par unité, la demande du village, les recettes.
- Aucune table n’est supprimée, aucune colonne renommée en base, aucune donnée modifiée hors
  backfill additif et alignement du catalogue (§ 8, décision documentée).

## 8. Modèle de données proposé (migration additive `0016_inventory_traceability`)

- `ResourceUnit` (nouveau) : `code`, `label`, `decimals` (0 = entier), `sortOrder`. Unités
  initiales : unité, pièce, kg, g, m, L, lot, Ryō.
- `Resource` : `+unitId` (défaut « unité », donc compatible avec l’ancien conteneur pendant le
  déploiement progressif), `+inventoryStatus` (`NOT_INVENTORIED` | `COUNTED`),
  `+currentQuantity` (cache dérivé du ledger), `+lastMovementAt`, `+lastCountedAt`.
- `ResourceAlias` (nouveau) : alias de recherche (`Iron`, `T1`, `RES-IRON`…).
- `ResourceCategory` : `+sortOrder`.
- `InventoryMovement` : `+quantityBefore`, `+quantityAfter`, `+counterpartyType`
  (`NINJA` | `EXTERNAL`), `+counterpartyNinjaId`, `+counterpartyLabel`, `+notes`,
  `+sourceType`, `+sourceId`, `+reversedMovementId` (unique, auto-relation). Le champ
  existant `justification` devient le **motif** (`reason` côté Prisma via `@map`, sans
  changement de colonne). Nouveaux types : `INITIAL_BALANCE`, `IN`, `OUT`, `ADJUSTMENT_IN`,
  `ADJUSTMENT_OUT`, `RETURN_IN`, `REVERSAL`, `OTHER` (les types existants restent valides).
- `StocktakeSession` (`kind` INITIAL | COUNT, `status` OPEN | COMPLETED | CANCELLED,
  `startedById`, `startedAt`, `completedAt`, `notes`) et `StocktakeEntry`
  (`expectedQuantity`, `countedQuantity`, `difference`, `adjustmentMovementId`).

## 9. Stratégie stock / mouvements

`InventoryMovement` est la seule source de vérité. Toute écriture passe par une fonction
unique `recordMovement` (`apps/web/lib/inventory-ledger.ts`) : verrou `FOR UPDATE` de la
ressource, calcul de `before` par somme du ledger, refus du stock négatif (sauf override
`inventory:adjust` avec justification, audité), écriture du mouvement avec `before/after`,
mise à jour du cache `currentQuantity` / `lastMovementAt` dans la même transaction.
Une réconciliation (`pnpm worker inventory:reconcile` et bandeau responsable) compare
`SUM(mouvements)` au cache ; un écart crée une alerte et n’est jamais corrigé en silence.

## 10. Ryōs

Il n’existe **aucun registre central de trésorerie** : les paiements de taxes
(`TaxPayment`), les rachats (`ResourceTransaction.totalAmount`) et les prix d’événements sont
des écritures indépendantes sans solde de caisse. La ressource `Ryo` de l’ancien registre a
été désactivée à l’import. Décision : la ressource **Ryōs** (code `RES-RYO`, catégorie
Trésorerie, unité Ryō, entiers) est réactivée et se gère comme les autres ressources :
solde initial par comptage, entrées / sorties manuelles tracées. Elle est exclue des
formulaires de don et de rachat (donner des Ryō est un paiement, pas un don). Le
raccordement automatique des paiements et rachats à ce solde est **volontairement
non implémenté** : c’est une décision métier (périmètre exact de la caisse Kōeki) à prendre
séparément ; le point d’intégration (`recordMovement`) est prêt.

## 11. Permissions proposées

`inventory:read`, `inventory:write` (entrée / sortie, existant), `inventory:count`,
`inventory:adjust` (ajustement, correction, override négatif), `inventory:catalog`
(ressources, catégories, unités, seuils), `inventory:export`.
Agent économique : read, write, export. Responsable et super-admin : tout. Auditeur : read,
export. Ninja : rien. La création de ressource, aujourd’hui derrière `settings:manage`,
passe à `inventory:catalog` (mêmes rôles).

## 12. Nouvelle UI du tableau

Catégorie de navigation **Inventaire** : Inventaire (tableau), Mouvements (journal),
Comptages, Catalogue (page Ressources existante, prix et barèmes). Le tableau prend toute
la largeur, en-tête et première colonne collants, tri par colonne, recherche instantanée
(nom, code, alias, catégorie), filtres (catégorie, état, inventorié, faible, critique,
mouvements récents, sans mouvement), colonnes masquables et densité mémorisées dans le
navigateur, boutons `+ Entrée` / `− Sortie` sur chaque ligne, export CSV.

## 13. UX d’entrée

Tiroir compact : quantité (unité et décimales imposées par la ressource), donné par
(ninja recherché ou personne externe), motif (Don, Achat, Retour, Transfert, Production,
Correction, Autre), note. Aperçu « stock actuel → mouvement → nouveau stock », bouton
« Ajouter 25 kg ». Contrepartie facultative pour une entrée.

## 14. UX de sortie

Même tiroir : quantité, pris par (obligatoire), motif obligatoire (Fabrication, Mission,
Distribution, Transfert, Perte, Usage interne, Vente, Autre), note. Stock insuffisant refusé
avec « Disponible / Demandé » ; override réservé à `inventory:adjust` avec justification.

## 15. UX de comptage

Page « Nouveau comptage » : tableau Ressource | Stock système | Stock compté, saisie au
clavier (Entrée = ligne suivante). Enregistrer crée une session OPEN avec les écarts, la page
de revue liste « N écarts détectés », « Confirmer » recalcule sur état verrouillé puis crée un
`INITIAL_BALANCE` (ressource jamais comptée) ou un `ADJUSTMENT_IN/OUT` (ressource déjà
comptée) par écart, passe la ressource en Inventorié et archive la session. Mode
« Initialiser l’inventaire » = même écran pré-filtré sur les ressources non inventoriées.

## 16. Historique

Page ressource : stock, entrées / sorties du mois, dernier comptage, historique complet
(date, ±quantité, avant → après, donné/pris par, enregistré par, motif, source) avec
correction par contre-écriture. Journal global filtrable (ressource, catégorie, type,
sens, agent, ninja / personne, dates, motif, recherche libre) et exportable.

## 17. Intégrations

Rachat → `BUYBACK_IN` (contrepartie = ninja vendeur). Don (trois chemins unifiés) →
`DONATION_IN` (contrepartie = ninja donateur, agent = validateur). Artisanat →
`CRAFT_CONSUMPTION` / `CRAFT_OUTPUT`. Fiche ninja : onglet Ressources. Statistiques :
activité d’inventaire par agent. Worker : `inventory:check` conserve ses alertes,
`inventory:reconcile` ajouté.

## 18. Plan de migration

1. migration SQL additive (tables, colonnes nullables ou avec défaut, enum étendu) ;
2. backfill des `before/after` par somme cumulée, des contreparties depuis les
   transactions, des `source*`, du cache `currentQuantity` et de `lastMovementAt` ;
3. toutes les ressources existantes restent `NOT_INVENTORIED` (aucune n’a jamais été
   comptée ; leur somme de mouvements reste visible et étiquetée) ;
4. bootstrap idempotent (exécuté par `start:prod`) : unités, catégories Plans / Chakra /
   Métaux / Matériaux / Textiles / Trésorerie / Autre, alignement du catalogue initial par
   nom (T1 → Plan T1 avec alias, Chakra Métal → Pièces Chakra avec alias, Ryo → Ryōs),
   codes stables `RES-PLAN-T1`, `RES-IRON`… ;
5. aucune suppression, aucun `reset`, compatibilité avec le conteneur précédent pendant le
   déploiement progressif.

## 19. Plan de tests

Domaine (vitest, sans base) : états de stock, sens des types, parsing par unité, écarts de
comptage, CSV. Intégration (vitest + PostgreSQL, ignorés si la base est absente) : entrée,
sortie, stock insuffisant, override, comptage initial, ajustement, correction, rachat → stock,
don → stock, artisanat, permissions, concurrence (deux sorties simultanées). E2E Playwright
(mode démo) : tableau, recherche, tiroir, mobile, comptage.

## 20. Ordre d’implémentation

Schéma et migration → seed → domaine et ledger → permissions → page tableau →
entrée / sortie → journal → détail ressource → comptage → corrections → intégrations rachat,
don, artisanat → fiche ninja, statistiques → export → réconciliation → tests → responsive →
audit visuel → documentation.

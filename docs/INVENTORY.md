# Inventaire

Le registre économique de Suna : toutes les ressources de la Kōeki, leur stock, ce qui entre, ce qui
sort, qui a donné, qui a pris, quel agent a enregistré, pourquoi et quand. Documents liés :
`RESOURCES.md` (catalogue, unités, catégories), `INVENTORY_TRACEABILITY.md` (ledger, corrections,
réconciliation), `INVENTORY_PERMISSIONS.md` (rôles) et `INVENTORY_AUDIT.md` (état des lieux avant
refonte et décisions).

## Principe

Le stock n’est jamais édité directement. **Il est la somme des `InventoryMovement`** de la
ressource. Chaque entrée, sortie, don, rachat, fabrication, comptage ou correction écrit une ligne
immuable avec la quantité signée, le stock avant et après, l’agent, la contrepartie, le motif, la
source et la date. `Resource.currentQuantity` n’est qu’un cache maintenu par un trigger PostgreSQL
dans la même transaction (voir `INVENTORY_TRACEABILITY.md`).

## Non inventorié ≠ zéro

Une ressource reste **Non inventorié** (`inventoryStatus = NOT_INVENTORIED`) tant qu’aucun
comptage physique ne l’a fixée, même si des dons ou rachats lui ont déjà donné des mouvements. Dans
ce cas le tableau affiche la somme des mouvements connus (ou `—` s’il n’y en a aucun) avec l’état
gris « Non inventorié ». Après le premier comptage elle devient **Inventorié** (`COUNTED`) ; un stock
à `0` signifie alors « nous avons vérifié qu’il n’y en a aucun ».

Toutes les ressources reprises de l’ancien registre sont restées `NOT_INVENTORIED` à la migration :
aucune n’avait été comptée. L’initialisation se fait depuis **Comptages → Initialiser l’inventaire**.

## Pages

| Page | Rôle |
|---|---|
| `/inventory` | Tableau de toutes les ressources : stock, entrées et sorties sur 30 jours, dernier mouvement, état, actions `+ Entrée` / `− Sortie` (et `Ajuster` pour un responsable). Recherche instantanée (nom, code, alias, catégorie), filtres, tri par colonne, colonnes masquables et densité mémorisées dans le navigateur, export CSV, bouton « Nouveau mouvement » sans chercher la ligne. |
| `/inventory/[id]` | Fiche d’une ressource : stock, entrées / sorties du mois, dernier comptage, seuils, alias, historique complet paginé avec correction par contre-écriture. |
| `/inventory/movements` | Journal global filtrable (ressource, catégorie, type, sens, agent, ninja, origine, dates, motif, recherche libre) et exportable. |
| `/inventory/counts` | Comptages : initialisation, nouveau comptage, import CSV, historique des sessions. |
| `/inventory/counts/new` | Saisie rapide façon tableur (Entrée = ligne suivante) avec écart prévu en direct. |
| `/inventory/counts/[id]` | Revue des écarts d’une session, confirmation ou annulation. |
| `/resources` | Catalogue : codes, unités, prix, barèmes de points et d’exonération ; création de catégories et d’unités. |

## États

| État | Règle | Couleur (jamais seule : libellé + icône) |
|---|---|---|
| Non inventorié | jamais compté | gris |
| Normal | compté, au-dessus des seuils | vert olive |
| Faible | `0 < stock ≤ seuil bas` | ambre |
| Critique | `0 < stock ≤ seuil critique` | rouge |
| Rupture | compté et `stock ≤ 0` | rouge |

Un seuil à `0` signifie « non configuré » et ne déclenche rien. La règle est unique
(`deriveStockState` dans `packages/domain/src/inventory.ts`) et partagée par le tableau, le
catalogue et le worker `inventory:check`.

## Entrée et sortie manuelles

Depuis une ligne du tableau, la fiche d’une ressource ou « Nouveau mouvement » : un tiroir demande
la quantité (dans l’unité de la ressource, décimales limitées par l’unité), la contrepartie (ninja
recherché dans le registre ou personne externe en texte libre ; **obligatoire pour une sortie**),
le motif (liste suggérée + « Autre ») et une note facultative. L’aperçu affiche stock actuel,
mouvement et nouveau stock avant validation. Le serveur revérifie tout sous verrou : quantité,
unité, contrepartie, motif, stock disponible.

Types produits : `IN` (ou `RETURN_IN` pour le motif Retour, `TRANSFER_IN` pour Transfert),
`OUT` (ou `LOSS` pour Perte, `TRANSFER_OUT` pour Transfert).

## Stock négatif

Refusé par défaut avec le message « Stock insuffisant — disponible X, demandé Y ». Un titulaire
d’`inventory:adjust` peut cocher « Autoriser un stock négatif » dans le tiroir : justification
obligatoire dans la note, audit `INVENTORY_OUT_NEGATIVE`.

## Comptage

1. **Saisie** : les quantités comptées sont enregistrées dans une `StocktakeSession` `OPEN` avec le
   stock système au moment de la saisie (rien ne bouge).
2. **Revue** : « N écarts détectés », liste ressource par ressource.
3. **Confirmation** : sous verrou, le stock système est recalculé, puis pour chaque ligne :
   `INITIAL_BALANCE` si la ressource n’avait jamais été comptée (même à zéro), sinon
   `ADJUSTMENT_IN` / `ADJUSTMENT_OUT` en cas d’écart, rien si le compté égale le système. La
   ressource passe `COUNTED` avec `lastCountedAt`, la session `COMPLETED` est archivée.
4. **Annulation** : session `CANCELLED`, aucun mouvement.

L’import CSV (`code ou nom ; quantité`, alias acceptés, séparateur `;`, `,` ou tabulation)
crée exactement la même session à revoir : un import n’écrase jamais un stock.

## Intégrations

- **Rachat** validé → `BUYBACK_IN` par ligne, contrepartie = ninja vendeur, agent = enregistreur.
- **Don** validé (agent, auto-déclaration validée ou règlement de taxe en objets) → `DONATION_IN`,
  contrepartie = ninja donateur, agent = validateur. Les trois chemins passent par le même écrivain.
- **Artisanat** confirmé → `CRAFT_CONSUMPTION` (ingrédients) et `CRAFT_OUTPUT` (produits).
- **Fiche ninja** : onglet Ressources (dons, rachats, sorties prises, remises).
- **Statistiques** : traçabilité des stocks par agent (mouvements, entrées, sorties, comptages,
  ajustements, corrections, lignes annulées) — un indicateur d’activité, jamais une sanction.

## Ryōs

Il n’existe pas de registre de trésorerie central dans Kōeki (paiements, rachats et prix
d’événements sont des écritures indépendantes). Les **Ryōs** sont donc une ressource de la
catégorie Trésorerie (unité Ryō, entiers) tenue par comptage et mouvements manuels, exclue des
dons et rachats. Le raccordement automatique des paiements et rachats à ce solde reste une
décision métier à prendre séparément (voir `INVENTORY_AUDIT.md` § 10).

## Export

Bouton CSV du tableau (respecte recherche et filtres), du journal (respecte les filtres) et du
catalogue via `/api/inventory/export?type=inventory|movements|catalog`. Fichiers UTF-8 avec BOM,
séparateur `;` (Excel français), par exemple `inventory-2026-09-05.csv` avec `resourceCode`,
`resourceName`, `category`, `unit`, `quantity`, `status`, `state`, `in30d`, `out30d`,
`lastMovementAt`, `lastCountedAt`.

## Worker

- `pnpm worker inventory:check` : alertes seuils (ressources comptées uniquement).
- `pnpm worker inventory:reconcile` : compare `SUM(mouvements)` au cache, audite et notifie les
  responsables en cas d’écart, ne corrige rien.

## Évolutions prévues

Scanner / QR code (chaque ressource possède déjà un code stable `RES-…`), motifs administrables en
base, raccordement de la trésorerie, pagination serveur du tableau au-delà de quelques milliers de
ressources (aujourd’hui le catalogue complet est chargé et filtré instantanément côté client).

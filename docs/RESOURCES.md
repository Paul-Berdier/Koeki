# Ressources — catalogue, catégories, unités

## Ressource

`Resource` : `code` stable et unique (`RES-IRON`, `RES-PLAN-T1`…), `name`, `description`,
`categoryId`, `unitId`, `minimumStock`, `criticalStock`, `inventoryStatus`
(`NOT_INVENTORIED` | `COUNTED`), `currentQuantity` (cache du ledger), `lastMovementAt`,
`lastCountedAt`, `isActive`, plus les champs économiques historiques (`demand`, `pointsPerUnit`,
`exemptionPerUnit`, prix historisés dans `ResourcePriceHistory`).

Création (`inventory:catalog`) : nom, code (proposé depuis le nom, modifiable), catégorie, unité,
alias, description, seuils. **Aucune quantité** : le stock de départ vient toujours d’un comptage
(`INITIAL_BALANCE`). Les barèmes (prix, points, exonération, besoin du village) restent réservés à
`settings:manage`.

Modification : chaque changement est audité (`RESOURCE_UPDATED`, `RESOURCE_THRESHOLDS_UPDATED`,
`RESOURCE_DEACTIVATED`, `RESOURCE_REACTIVATED`). Un changement de code conserve l’ancien code en
alias. **L’unité se fige dès qu’un mouvement existe** (V1 : une seule unité de référence par
ressource, aucune conversion implicite) — pour changer d’unité, créer une nouvelle ressource.

Suppression : définitive uniquement sans aucun historique ; sinon désactivation.

## Alias

`ResourceAlias` : termes de recherche supplémentaires (`Iron`, `T1`, ancien code). La recherche du
tableau, du journal, du tiroir de mouvement et de l’import CSV ignore accents et casse.

## Catégories

`ResourceCategory` (`code`, `label`, `sortOrder`), administrables depuis le catalogue. Référentiel
initial de l’inventaire : Plans, Chakra, Métaux, Matériaux, Textiles, Trésorerie, Autre. Les
catégories historiques (Minerais, Bois, Plantes, Parchemins, Équipement…) sont conservées.
La catégorie `TREASURY` a un rôle particulier : ses ressources sont exclues des dons et rachats.

## Unités

`ResourceUnit` (`code`, `label`, `decimals`, `sortOrder`). Référentiel initial : unité, pièce, kg
(3 décimales), g, m (2), L (2), lot, Ryō. `decimals` borne la précision acceptée pour toute
quantité de la ressource (0 = entiers seulement). Les quantités sont stockées en `Decimal(20,4)`
et manipulées côté application en dix-millièmes entiers — jamais en flottant naïf ; les Ryō sont
des entiers.

## Catalogue initial

Créé ou aligné par `packages/database/prisma/inventory-seed.ts`, exécuté par le bootstrap de
production à chaque démarrage (`pnpm start:prod`) et par la seed de développement. Idempotent :
chaque ressource est cherchée par code, puis par nom historique, et seulement créée si rien ne
correspond. Aucune quantité n’est écrite.

| Code | Nom | Catégorie | Unité | Alias | Origine |
|---|---|---|---|---|---|
| `RES-PLAN-T1`…`T4` | Plan T1…T4 | Plans | unité | T1…T4 | ancien « T1 »…« T4 » renommés |
| `RES-CHAKRA-PART` | Pièces Chakra | Chakra | unité | Chakra Métal, Chakra | ancien « Chakra Métal » renommé |
| `RES-TITANIUM` | Titane | Métaux | kg | Titanium | existant |
| `RES-IRON` | Fer | Métaux | kg | Iron | existant |
| `RES-COPPER` | Cuivre | Métaux | kg | Copper | existant |
| `RES-JADE` | Jade | Matériaux | unité | — | existant (ex-Cristaux) |
| `RES-PLASTIC` | Plastique | Matériaux | unité | Plastic | existant (ex-Autres) |
| `RES-WOOD` | Bois | Matériaux | unité | Wood | existant (ex-Bois) |
| `RES-WOOL` | Laine | Textiles | unité | Wool | existant |
| `RES-RYO` | Ryōs | Trésorerie | Ryō | Ryo, Ryō | ancien « Ryo » désactivé, réactivé |

Chaque alignement est audité (`RESOURCE_ALIGNED`, anciennes valeurs conservées) et l’ancien code
devient un alias. Les métaux passent en kg à la demande du service : les quantités existantes ne
changent pas, seul le libellé de l’unité change.

## Codes stables et scan

Le code est l’identifiant humain pérenne d’une ressource et pourra être imprimé en QR code plus
tard ; la recherche l’accepte déjà tel quel (`RES-IRON`).

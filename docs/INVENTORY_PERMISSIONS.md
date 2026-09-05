# Permissions de l’inventaire

Définies dans `packages/domain/src/permissions.ts` et vérifiées dans chaque commande serveur
(`requireWriteAccess`) et chaque page (`requirePermission`). Le masquage d’un bouton ne remplace
jamais ce contrôle.

| Permission | Autorise |
|---|---|
| `inventory:read` | voir le tableau, les fiches, le journal, les comptages |
| `inventory:write` | entrée, sortie (tiroir et « Nouveau mouvement »), dons et rachats, fabrications |
| `inventory:count` | lancer, importer, confirmer, annuler un comptage |
| `inventory:adjust` | ajustement hors comptage, correction par contre-écriture, override de stock négatif, réalignement du cache |
| `inventory:catalog` | créer et modifier une ressource, ses seuils, ses alias, la désactiver ; créer catégories et unités |
| `inventory:export` | exports CSV |
| `settings:manage` (existant) | prix, points et exonération par unité, besoin du village |

| Rôle | read | write | count | adjust | catalog | export |
|---|---|---|---|---|---|---|
| Super-administrateur | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Responsable Kōeki | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Agent économique | ✓ | ✓ | — | — | — | ✓ |
| Auditeur | ✓ | — | — | — | — | ✓ |
| Ninja | — | — | — | — | — | — |

Un simple agent fait donc : chercher → voir le stock → `− Sortie` → quantité, personne, motif →
valider. Le système écrit le mouvement, le stock avant / après, l’audit, la date et l’agent.

Sur la fiche d’un ninja, l’onglet **Ressources** n’apparaît qu’avec `inventory:read` (un ninja qui
consulte sa propre fiche ne le voit pas).

En mode démonstration, les boutons du tableau restent visibles pour l’audit visuel et les tests,
mais le serveur refuse toute écriture.

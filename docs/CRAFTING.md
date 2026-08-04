# Artisanat

Les recettes sont versionnées par `(code, version)`. Ingrédients et sorties utilisent des relations, jamais une liste encodée dans une chaîne. Une simulation calcule le maximum fabricable, les ressources limitantes et le stock restant sans écrire en base.

Une exécution réelle est confirmée, idempotente et transactionnelle : mouvements négatifs `CRAFT_CONSUMPTION`, mouvements positifs `CRAFT_OUTPUT`, puis audit. Toute insuffisance détectée au recalcul annule la transaction.

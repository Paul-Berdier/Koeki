# Dons et rachats

Les prix actifs sont historisés dans `ResourcePriceHistory`. Une transaction mémorise le prix unitaire et le multiplicateur de qualité observés. Le serveur recharge le prix, recalcule chaque ligne, le total, les points et l’impact de stock.

Un don crédite le stock sans sortie de Ryō. Un rachat crée une dépense et peut exiger une validation au-dessus de 50 000 Ryō, seulement après activation explicite du seuil. Les reçus, contre-écritures et audits sont obligatoires.

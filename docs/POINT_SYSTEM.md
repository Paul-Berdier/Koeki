# Système de points

Chaque ressource porte son propre barème `pointsPerUnit` (feuille « Ressources » de l’ancien registre) : un don rapporte `quantité × pointsPerUnit`, en plus des éventuelles règles actives. Les rachats ne passent que par les règles.

Les règles prennent en charge `FIXED`, `PER_AMOUNT`, `PERCENTAGE`, `MULTIPLIER` et `MANUAL`, avec minimum, maximum et période d’activité. Le calcul déterministe est dans `packages/domain/src/points.ts`.

Chaque attribution crée un `PointLedgerEntry` lié à sa source. La contrainte source/type bloque une double attribution. Une correction ajoute une écriture inverse ; le solde est toujours la somme explicable du registre.

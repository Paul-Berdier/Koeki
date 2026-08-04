# Design system

## Direction retenue

Trois pistes ont été évaluées : registre parchemin, salle des comptes shinobi et console sable/bronze. La dernière a été retenue : elle conserve l’atmosphère sombre et dorée de la référence tout en améliorant la lisibilité, la densité et la navigation.

## Tokens

Les tokens sont centralisés dans `apps/web/app/globals.css` : noir brun `--ink-*`, sable `--sand-*`, parchemin `--paper-*`, or vieilli `--gold-*`, olive validé, ambre avertissement, terre cuite erreur/dette et bleu-gris administratif. Les rayons restent sobres (5–14 px), les bordures sont fines, et les ombres ne servent qu’à la profondeur structurelle.

Typographie : serif institutionnelle pour les titres et sans-serif système pour les données. Échelle : 9–14 px pour les registres, 19–48 px pour les titres et indicateurs. La grille principale est plafonnée à 1 480 px.

## Composants

`MoneyDisplay`, `PointDisplay`, `StatusBadge`, `GradeBadge`, `NinjaAvatar`, `MetricCard`, `PageHeader`, `SectionHeader`, `EmptyState`, `LoadingState` et `ErrorState` sont dans `packages/ui`. Les écrans emploient aussi des motifs partagés de tableau, filtre, état financier, navigation et carte mobile.

## Responsive et accessibilité

- 1 120 px : métriques sur deux colonnes, modules empilés ;
- 820 px : tiroir de navigation et vues cartes ;
- 560 px : actions empilées et données secondaires réduites ;
- focus visible, lien d’évitement, labels explicites, résumés textuels des graphiques ;
- aucune information ne dépend uniquement de la couleur ;
- `prefers-reduced-motion` neutralise les animations.

Les références d’audit sont `apps/web/test-results/dashboard-desktop.png` et `apps/web/test-results/ninjas-mobile.png`.

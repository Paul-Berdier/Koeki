# Design system — « Registre de Suna »

Référence unique de l'interface Kōeki. Tout est défini en tokens CSS dans
`apps/web/app/globals.css` (`:root`) ; aucune valeur arbitraire dans les composants.
Les primitives React vivent dans `packages/ui/src/primitives.tsx`.

## Direction

Trois pistes évaluées : **A. Registre de Suna** (administratif, dense, serif
institutionnelle), **B. Trésor du Kazekage** (prestigieux, or dominant),
**C. Bureau des Routes du Sable** (commercial, cartes et comptoirs). Direction
retenue : **A**, avec les dunes et l'or de B en touches — la plus crédible pour
un usage quotidien : administration économique d'un village du désert, élégante,
sobre, chaude, institutionnelle. L'or est réservé à ce qui compte (argent, action
principale, état actif) ; le bronze structure ; le fond reste une nuit de désert.
Pas de parchemin plaqué sur chaque panneau — le désert vit dans les fonds, les
traits, les états vides et les dunes de la page de connexion.

## Couleurs

| Token | Usage |
|---|---|
| `--ink-950…700` | Fonds, du plus profond (page) au plus clair (surfaces) |
| `--paper-100/50` | Texte principal, titres |
| `--sand-600/500/300` | Texte secondaire, libellés |
| `--gold-600/500/400/300` | Primaire : montants, actions, actif |
| `--bronze-500/300` | Secondaire : structure, libellés de section, points |
| `--olive-500/300` | Succès (« À jour », validations) |
| `--amber-500/300` | Avertissement (« À payer », partiel) |
| `--terracotta-500/300` | Danger (« En retard », dettes) |
| `--slate-400` | Information neutre désaturée |
| `--border`, `--border-strong`, `--border-gold`, `--hairline` | Traits |

Aucun statut n'est communiqué par la couleur seule : chaque badge porte icône + texte.

## Typographie

`--font-display` (serif Iowan/Palatino/Georgia) : titres, chiffres clés.
`--font-sans` (Inter/system) : corps. `--font-mono` : codes (reçus, RES-…).

Échelle : `--text-caption` 10 → `--text-display` 54. Niveaux : DISPLAY (connexion),
PAGE TITLE (`.page-header h1`), ZONE (`.zone-title`), SECTION (`.section-header h2`),
CARD (`.recipe-card h3`), BODY, SECONDARY, LABEL, CAPTION, NUMERIC.

**Numérique** : tout montant/compteur utilise `font-variant-numeric: tabular-nums`
(`.money`, `.points`, `.metric-value`, `td.num`…). Les Ryō s'affichent via
`MoneyDisplay` (suffixe or, tooltip du montant exact en mode compact), les points
via `PointDisplay` (bronze — jamais le même traitement que les Ryō).

## Espacement, rayons, ombres, mouvement

Échelle 4 px (`--sp-1…10`). Rayons administratifs discrets (`--radius-xs` 2 →
`--radius-lg` 11). Ombres chaudes (`--shadow-sm/md/lg`), jamais de halo froid.
Transitions `--motion-fast` 130 ms / `--motion-med` 220 ms, hover/fade/slide
uniquement ; `prefers-reduced-motion` respecté.

## Layout et navigation

AppShell : sidebar fixe 262 px (repliable à 70 px, préférence mémorisée dans
`localStorage`, tooltips natifs repliée), contenu plafonné à `--content-max`
1480. Navigation groupée : **Ninjas / Économie / Analyse / Administration**,
entrée active marquée d'un rail or, compteurs utiles (retards sur Recouvrement).
Breakpoints : 1120 (grilles à une colonne, sidebar 232), 820 (drawer mobile,
cartes ninjas, filtres empilés), 560 (densité mobile).

## Composants

- **PageHeader** : eyebrow, titre, description, `metrics` (bandeau de chiffres
  clés sous la description) et actions. Trait or sous l'en-tête.
- **MetricCard** : accent latéral par ton (`good/warn/danger`).
- **ZoneTitle** : sépare les tranches d'une page dense (trait de sable dégradé).
- **Tables** (`.table-scroll table`) : en-têtes bronze, lignes 52 px, colonnes
  numériques `th.num/td.num` alignées à droite, hover chaud, `.table-footer`
  pour la pagination.
- **Badges** (`StatusBadge`) : À JOUR olive · EN RETARD terracotta · À
  PAYER/PARTIEL ambre · EN ATTENTE slate · BROUILLON sable. Un seul style,
  toutes pages.
- **Formulaires** (`.form-grid`) : labels visibles (jamais placeholder seul),
  `legend` bronze pour les sections, `.field-help` pour l'aide, focus or,
  `.form-row` pour les paires. Lignes d'objets : `.item-row` (+ `.with-price`).
- **Filtres** (`.filter-bar` + `.search-field`) : recherche débouncée,
  autocomplétion par `datalist`, URL partageable.
- **Onglets** (`DetailTabs` + `.tabs-bar`) : contenu rendu serveur puis masqué —
  les formulaires gardent leur état en changeant d'onglet.
- **Vues table/cartes** (`NinjaViews` + `.cards-mode`) : bascule mémorisée,
  cartes forcées sous 820 px.
- **Notices** (`.notice[.error]`) : cachet latéral, messages en français métier.
- **États** : `EmptyState` (dune stylisée + phrase utile), `LoadingState`,
  `ErrorState`, `.skeleton` (shimmer sable).

## Pages hors shell

`.invite-page/.invite-card` : connexion (`/connexion`), invitation, accès refusé —
sceau Kōeki, filet or supérieur, dunes en pied de carte (`.invite-dunes`).

## Accessibilité

Focus visible or partout, skip-link, `aria-label` sur les graphiques CSS avec
synthèse textuelle (`.chart-summary`), tableaux avec `th`, statuts icône+texte,
onglets `role=tablist/tab/tabpanel`, drawer avec backdrop cliquable,
`prefers-reduced-motion` neutralise les animations.

# Design system Kōeki — Sable & encre

## Objectif

Un service économique lisible, avec une identité de Suna discrète. Les agents travaillent depuis le Bureau ; les responsables consultent le Pilotage. Les réglages, contrôles et historiques secondaires ne concurrencent pas l’action principale.

## Direction artistique

- Fond sable très clair `#f6f5f1`, panneaux blancs, texte encre `#232f2d`.
- Navigation vert encre `#1e3028`, sélection sauge `#dee7cb`, accent sable `#876022`.
- Police système Segoe UI / Inter / sans-serif ; grands titres sobres, chiffres tabulaires, pas de police externe à télécharger.
- Espaces de 8/12/16/24/32 px, panneaux arrondis de 12 px, ombres faibles, contrôles usuels de 44 px.
- Le rouge signale une action ou un blocage concret ; l’absence d’opération n’est pas une faute et ne reçoit pas automatiquement cet état.

## Organisation du CSS

`apps/web/app/globals.css` importe trois feuilles :

1. `styles/modules.css` : règles propres aux modules économiques conservés et leurs adaptations mobiles.
2. `styles/foundations.css` : tokens sémantiques, base, boutons, tables, formulaires, panneaux, métriques et états.
3. `styles/workspace.css` : navigation, bureau, pilotage, fiches agents, mise en page des parcours repensés.

Les anciens tokens `ink-*`, `paper-*`, `sand-*` servent de passerelle vers les nouvelles couleurs pour les composants métier existants. Les nouveaux composants utilisent les tokens `canvas`, `surface`, `text`, `text-secondary`, `accent` et les états sémantiques. Aucun mode sombre implicite ne reste sur les champs de date.

## Navigation et hiérarchie

Le menu principal expose les espaces, les onglets horizontaux leurs rubriques. La matrice de permissions alimente `allowedNavigation` ; `workspaceNavigation` organise seulement la présentation. Un lien masqué n’est jamais un contrôle d’accès.

Le profil et la déconnexion sont des actions distinctes. La navigation mobile utilise un dialogue Radix avec fermeture par Échap, focus contraint et retour au déclencheur. Le lien d’évitement mène au contenu principal.

## Pilotage

La synthèse montre quatre indicateurs, une courbe et les interventions actuelles. Le registre des agents permet recherche, tri et pagination. Les dossiers à attribuer ont leur propre vue. Une fiche distingue aperçu, dossiers, opérations et accompagnement pour éviter une page interminable.

Les graphiques portent sur les opérations validées, à la date réelle de validation, groupées par jour Europe/Paris. Les jours à zéro restent présents. Les légendes activables, infobulles et tableaux de valeurs rendent les courbes consultables. Les définitions précisent origine, auteur, exclusions, périmètre des dates et charge actuelle. La période est conservée quand on ouvre un agent.

## Accessibilité et mobile

Conserver les intitulés explicites, les labels de champs, le focus visible, le contenu textuel des états, les en-têtes de tableau et les régions défilantes nommées. La couleur seule ne porte aucune information. Les tableaux larges défilent dans leur propre région ; le document ne déborde pas. Les courbes fournissent les données tabulaires équivalentes.

Les préférences de réduction de mouvement sont respectées. Les actions financières conservent leurs contrôles et confirmations existants ; les modales sensibles affichent toujours l’identité et les effets de l’action.

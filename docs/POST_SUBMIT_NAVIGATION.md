# Blocages après sauvegarde — PR #8

## Échecs analysés

Exécution : https://github.com/Paul-Berdier/Koeki/actions/runs/38188967234
Commit : `00c046c1a5ad1367650bde1394d0e1a4cd96f4ec`.
Les huit échecs sont des répétitions de deux parcours (12 exécutions au total), pas huit bugs indépendants.

| Échec | Projet | Répétition (0 = première) | Observation |
| --- | --- | --- | --- |
| 1 | desktop | dossier 0 | Le titre « Modifier le dossier » ne s'affiche pas après le clic. |
| 2 | desktop | dossier 1 | L'alias est écrit en base, mais l'URL reste sur `/modifier`. |
| 3 | desktop | dossier 2 | Le titre du formulaire ne s'affiche pas. |
| 4 | desktop | équipement 2 | L'équipement est écrit en base, mais la confirmation ne s'affiche pas. |
| 5 | mobile | dossier 1 | Le titre du formulaire ne s'affiche pas. |
| 6 | mobile | dossier 2 | Le titre du formulaire ne s'affiche pas. |
| 7 | mobile | équipement 0 | Le bouton « Enregistrement… » reste présent après la mutation. |
| 8 | mobile | équipement 1 | L'équipement est écrit en base, mais la confirmation ne s'affiche pas. |

Les traces montrent des réponses RSC et des POST 303 rapides. Certains flux sont encore en attente et sont interrompus à la fin du test. L'arrivée des en-têtes ou la validation de la transaction ne prouve donc pas la fin de la transition React. Les diagnostics collectés ne signalent ni erreur JavaScript ni violation CSP.

## Correction

- Supprimer l'interception middleware qui renvoyait 204 aux GET RSC internes portant `x-action-redirect`. Cette réponse vide contourne le rendu Flight attendu ; elle ne garantit pas une navigation document, contrairement au commentaire initial. Laisser Next produire sa réponse et sa redirection normales.
- Désactiver les préchargements automatiques des menus du shell et des liens secondaires du dossier. Utiliser des liens document pour ouvrir le formulaire, revenir à la fiche et accéder au dossier depuis l’équipement. Les traces et la reproduction locale montrent des rafales RSC concurrentes ; les seules modifications du rendu dynamique et des invalidations n’éliminaient pas les blocages. La première CI du correctif a passé 23 scénarios sur 24 mais a encore bloqué une navigation mobile vers le formulaire avant toute écriture. Les liens document retirent cette dépendance au cache/aux transitions RSC pour ces parcours. Les liens secondaires du shell restent des liens Next initiés au clic. Le coût est un chargement document pour les liens du parcours d’édition, et des chargements au clic plutôt qu’en anticipation pour les autres liens concernés.
- Pour le dossier, retourner les erreurs métier au formulaire sans le démonter. Après le commit réussi, retourner un chemin relatif construit côté serveur ; le client effectue un GET document vers ce dossier. Cela abandonne l’ancien cache de routes et la transition du formulaire, sans rejouer la mutation. Les lectures restent dynamiques et voient les données PostgreSQL actuelles.
- Pour l’équipement, retourner un résultat typé après le commit plutôt que rediriger vers la même URL de confirmation à chaque sauvegarde. Une répétition avec les préchargements désactivés montrait encore la confirmation affichée mais le bouton bloqué. Le client applique les slots retournés par le serveur, recalcule les compteurs, annonce le succès et ferme l’éditeur. Une erreur métier garde le formulaire et ses valeurs utilisables : le composant `ActionForm` empêche aussi la réinitialisation automatique des champs par React après une action résolue en erreur. La page est dynamique et relit PostgreSQL lors d’une navigation ultérieure ; aucune réactualisation RSC n’est requise pour afficher le résultat de cette mutation.

Le layout conserve son rendu dynamique via `connection()` et le nonce par requête. La compression reste activée.

Les transactions, contrôles de session, permissions, validations métier, audits et protections CSRF restent en place. Aucune mutation n'est rejouée automatiquement. Aucun test n'écrit dans la base de production.

## Régressions couvertes

La suite de production répète les parcours trois fois sur ordinateur et mobile tactile : modification successive d'un dossier déjà visité, équipement sauvegardé deux fois, disparition de l'état d'attente, données affichées, navigation suivante et retour arrière. Un troisième scénario vérifie le refus d'une date de décès future, l'absence d'écriture, la fin de l’attente et une soumission corrigée réussie depuis le même formulaire. Un quatrième scénario simule un ninja devenu inactif pendant l’édition : le refus ne crée aucune écriture ni audit, et l’éditeur permet une nouvelle soumission après correction de la situation administrative. Les diagnostics CSP sont contrôlés aussi sur le dossier.

Commande CI (PostgreSQL local jetable requis) :

```sh
corepack pnpm db:generate
corepack pnpm db:deploy
corepack pnpm build
corepack pnpm --filter @koeki/web exec playwright test --config playwright.production.config.ts
```

Le garde-fou de configuration refuse toute base autre que `koeki_v2_test` sur `localhost` ou `127.0.0.1`. La CI utilise PostgreSQL 17 et Chromium fourni par Playwright ; les vérifications locales utilisent un PostgreSQL 18 jetable et Chromium 153. La suite utilise les vrais cookies `__Secure-koeki.session-token`, JavaScript actif et la CSP de production.

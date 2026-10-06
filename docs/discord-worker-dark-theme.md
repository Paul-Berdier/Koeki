# Correctif Discord, runtime du worker et thème sombre

## Authentification

Le provider Discord configure explicitement `issuer: "https://discord.com"`, l'émetteur publié par Discord dans `https://discord.com/.well-known/openid-configuration`. Sans cet émetteur, Auth.js utilise son émetteur de repli et refuse le paramètre `iss` de la réponse Discord avant les contrôles d'accès de Kōeki.

Le correctif conserve les endpoints du provider, ses vérifications OAuth par défaut, le scope `identify guilds`, les sessions privées, la consommation transactionnelle des invitations et les contrôles de révocation. Aucun secret ni identifiant utilisateur n'est ajouté au code.

La page `/access-denied` distingue maintenant un refus applicatif `AccessDenied` d'une erreur technique telle que `Configuration` ou `CallbackRouteError`. Elle ne reproduit jamais les paramètres arbitraires fournis dans l'URL.

## Worker et scripts historiques

`@koeki/worker` est un package ESM, mais `@koeki/database` ne déclarait pas son type de module. Le re-export de `closeCompletedRankings` pouvait alors ne pas être exposé comme export nommé lors du chargement réel par Node/tsx, même lorsque TypeScript validait les types.

La bibliothèque database est explicitement ESM, comme domain et worker. `pnpm --filter @koeki/worker test` charge les exports avec le même runtime que le worker, sans lancer de job ni écrire dans une base.

Le sous-dossier `packages/database/scripts` conserve explicitement son mode CommonJS précédent : le script historique d'import utilise notamment `__dirname`. Son smoke test vérifie les globals CommonJS et l'interopérabilité avec la bibliothèque database désormais ESM. Il ne lance jamais la commande d'import destructive. Les deux smoke tests entrent dans la commande existante `pnpm test` et donc dans la CI. Le cron existant et les règles économiques ne sont pas modifiés.

## Thème sombre

Le thème permanent « Encre, forêt et or » est rendu côté serveur : aucun stockage navigateur, script de bascule ou flash de thème clair n'est nécessaire. `dark.css`, importé après les styles de structure, définit les surfaces, textes, contrôles natifs, états, navigation et dialogs. Les aliases de couleurs couvrent aussi les modules historiques. Le viewport mobile est synchronisé avec le fond.

Le composant `apps/web/components/team-charts.tsx` reste inchangé dans cette PR : sa modification a été bloquée par le contrôle de sécurité de l'outil. Les courbes et infobulles gardent leurs couleurs internes ; les tokens de graphiques sont réservés mais leur adoption reste à compléter.

Les tests de contraste vérifient les principaux couples de tokens (4,5:1 pour le texte, 3:1 pour les bordures de saisie). Cela ne remplace pas un audit exhaustif de chaque écran. Les tests Playwright vérifient les pages de connexion/erreur, les surfaces du bureau et des rapports, et produisent des captures desktop et mobile dans les artefacts de CI.

## Validation et mise en production

Exécuter le workflow existant : génération Prisma, migrations sur base de test, lint, typecheck, tests, vérification de migration V2, build et deux suites Playwright. Les nouveaux tests n'ont pas besoin des identifiants Discord réels.

Après fusion et déploiement Railway, relancer une connexion Discord réelle depuis `/connexion` (compte existant) ou depuis une invitation encore valide. Vérifier la disparition de l'erreur d'émetteur dans les journaux. Une nouvelle vérification manuelle doit confirmer l'ouverture effective de la session ; une compilation réussie n'en constitue pas la preuve.

Aucune modification de la base de production, de ses utilisateurs, de ses secrets ou du planning fiscal n'est nécessaire pour ce correctif.

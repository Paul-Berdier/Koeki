# Invitations individuelles et première connexion

## Usage

Créer un lien différent pour chaque personne. Le destinataire doit ouvrir le lien complet `/invite/<jeton>` puis cliquer sur **Continuer avec Discord** dans le même navigateur. La connexion doit être terminée dans les dix minutes ; au-delà, rouvrir le lien tant que l’invitation reste valable. Ce délai du cookie est distinct de l’expiration du lien.

Une invitation utilisée ne peut pas accueillir un autre compte. Son bénéficiaire se reconnecte ensuite par `/connexion` avec son compte Discord habituel. Un compte révoqué nécessite une décision d’un responsable, jamais une réactivation automatique par invitation.

## Vérifications

La page vérifie le lien en lecture seule, sans frontière de streaming qui bloquerait son affichage sans JavaScript. Les GET de prévisualisation, notamment Discordbot, ne consomment aucun accès. La soumission native POST `/api/connexion/discord` recontrôle le lien avant de poser le cookie HttpOnly, SameSite=Lax, Secure en production, Path=/ et Max-Age=600. L’acceptation recontrôle l’invitation au retour OAuth puis en transaction SQL sous verrou : expiration, statut, droits actuels du créateur, disponibilité du dossier, droits du bénéficiaire.

Le point d’entrée POST exige un Origin strictement égal à l’origine de AUTH_URL, rejette un Fetch Metadata contradictoire, les requêtes sans origine, les corps non URL-encodés, les champs ambigus et les corps de plus de 2048 octets. AUTH_URL doit être HTTPS en production ; HTTP n’est autorisé qu’en développement sur loopback. Il n’accepte aucune cible de redirection provenant du formulaire. Auth.js génère normalement ses cookies et contrôles OAuth ; sa destination d’autorisation doit appartenir au seul domaine canonique Discord.

La réponse est une véritable redirection HTTP 303. Elle évite la requête RSC prématurée vers Discord que le routeur client pouvait produire depuis une Server Action. La CSP garde `connect-src 'self'`. Les seules pages `/connexion` et `/invite/*` autorisent `https://discord.com` dans `form-action` pour la redirection native. Les autres directives CSP, les contrôles OAuth et les permissions métier restent actifs.

Les messages différencient le contexte d’invitation manquant, le lien invalide, utilisé, expiré, révoqué, les conditions d’attribution modifiées, l’appartenance Discord absente, une panne Discord et un compte désactivé. Les URL de refus ne contiennent que des codes constants. Aucun jeton, hash, identité du bénéficiaire ou exception de base n’est affiché. Les invitations ne sont pas indexables ni mises en cache ; la politique de référent évite de propager leur chemin lors de la navigation. Les chemins restent visibles à l’hébergeur dans les journaux HTTP : ces journaux doivent rester privés.

Le nettoyage du cookie intervient après une connexion réussie. Un échec de nettoyage ne révoque pas un utilisateur dont l’invitation a déjà été consommée. Les nouveaux comptes sans invitation consommée restent refusés par l’adaptateur de session.

## Tests

- `pnpm test` : classification des états, correspondance avec la règle d’usage unique, cookie de production, messages, protection des origines et des formulaires ; tests PostgreSQL de prévalidation en lecture seule, expiration, droits du créateur et concurrence entre deux destinataires.
- `pnpm test:e2e:auth` : parcours navigateur sans session injectée de la page d’invitation jusqu’au véritable callback OAuth puis à une session Auth.js/Prisma. Usage unique, reconnexion, absence/perte du cookie, invalidation après affichage, appartenance et panne Discord, refus d’un PKCE manquant, JavaScript désactivé, gardes HTTP et captures sur trois tailles d’écran.

Seuls les services externes Discord sont simulés. Le preload `e2e-auth/discord-fetch-fixture.mjs` est chargé explicitement par le processus de test, jamais par l’application. Il refuse le mode production et exige une base jetable locale autorisée. Il vérifie le challenge PKCE, signe ses jetons de simulation et ne transmet aucun identifiant simulé à Discord. Il n’existe aucun fournisseur de test ni interrupteur de contournement dans le code applicatif.

Les tests ne remplacent pas la confirmation finale d’une vraie personne invitée avec son compte Discord réel. Aucune invitation de production n’est créée, consommée ou réactivée pendant la validation.

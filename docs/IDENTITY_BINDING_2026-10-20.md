# Identité Discord et fiche ninja — 20 octobre 2026

## Périmètre

Une capture montre une identité RP différente de celle attendue par la personne connectée. Elle ne prouve ni quel compte Discord est présent dans le navigateur, ni le rattachement SQL de cette personne. L'accès direct aux enregistrements de production n'a pas été obtenu pendant cette intervention. Aucun compte réel, aucune fiche, aucun rôle et aucun historique financier n'a été réattribué.

Ce lot corrige des chemins susceptibles de produire ou masquer une confusion d'identité. Ce n'est pas une attestation que le cas individuel a été réparé dans la base.

## Protections

- Une nouvelle connexion Discord termine la session Kōeki du navigateur courant après contrôle d'origine et validation du formulaire. Elle ne supprime pas les sessions des autres appareils et ne fusionne pas les comptes.
- `auth-session-adapter.ts` vérifie l'unicité logique du lien Discord par utilisateur. L'Account et `User.discordId` sont écrits dans la même transaction sous le verrou des comptes. Une autre identité ne remplace jamais silencieusement la précédente.
- Les lectures OAuth et de sessions refusent un utilisateur dont plusieurs comptes Discord sont liés ou dont l'identifiant canonique contredit le lien OAuth. Aucun compte n'est choisi ou supprimé pour résoudre arbitrairement ce conflit. Une ligne legacy unique sans identifiant canonique reste compatible ; les comptes techniques non liés ne deviennent pas des identités OAuth pour autant.
- Une connexion ordinaire efface l'invitation résiduelle. Seule une nouvelle action explicite sur un lien d'invitation validé la transmet au parcours OAuth.
- Une invitation ciblée affiche le nom et le code du personnage réservé. La confirmation de ce personnage est obligatoire avant le départ vers Discord et contrôlée côté serveur. Cela évite une acceptation involontaire ; l'invitation reste un lien personnel porteur de droits à ne pas partager.
- Le choix libre par première correspondance d'un prénom n'existe plus. Le nouveau formulaire utilise un nom complet et un code exacts, sans valeur par défaut, puis une confirmation remise à zéro lorsqu'on change le choix. Le serveur vérifie encore le libellé, le code, la disponibilité, la réservation et le compte actif après acquisition du verrou.
- Une première liaison ne peut pas remplacer une fiche déjà rattachée au compte ni prendre une fiche appartenant à quelqu'un d'autre. Les anciennes actions de sélection floue n'effectuent plus d'écriture. La confirmation est une protection contre les erreurs de sélection, pas une preuve externe que la personne possède le personnage : le périmètre métier du premier rattachement libre reste celui de l'application existante.
- La soumission du nouveau formulaire affiche son état d'attente et son erreur ; le redirect de réussite reste hors du bloc catch et l'identité de la navigation est revalidée.

## Vérification par la personne

Le nom en bas de la barre latérale ouvre `/profil?identite=1`. Cette page privée n'accepte aucun identifiant d'un autre utilisateur : elle lit exclusivement le compte de la session et sa fiche. Le pseudo du compte de connexion est affiché uniquement à son propre utilisateur, jamais utilisé pour choisir la fiche RP. Il peut légitimement différer du nom RP.

Si le personnage n'est pas le bon, ne pas enregistrer d'opération, ne pas le renommer et ne pas recréer le personnage. Terminer la déconnexion, vérifier le compte choisi dans Discord et se reconnecter. Si la discordance persiste, le rattachement doit être vérifié avec l'identifiant Discord réellement contrôlé par la personne et les preuves disponibles. Les prénoms, les noms ou une capture ne permettent pas de réattribuer un compte avec certitude.

Aucune nouvelle commande de réattribution administrative ni script de mutation de production n'est fourni par ce lot. Une correction ultérieure doit conserver les identifiants des personnages, taxes, points et auteurs des opérations, être auditée et invalider les sessions concernées ; elle doit refuser toute cible déjà occupée sans traitement explicite du conflit. Les rôles ne sont pas déduits du nom RP.

## Validation reproductible

Les suites existantes refusent les bases distantes pour les tests. Utiliser exclusivement les commandes et bases locales jetables documentées dans le README, avec `REQUIRE_TEST_DATABASE=true` en CI.

```sh
corepack pnpm db:generate
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:upgrade
corepack pnpm build
corepack pnpm test:e2e
corepack pnpm test:e2e:auth
```

`identity-policy.test.ts` couvre les mappings contradictoires, références exactes et champs de confirmation. `identity-binding.integration.test.ts` couvre le lien OAuth transactionnel, les conflits, sessions, réservations, concurrence, idempotence et la conservation des rôles et paiements. `identity-binding.spec.ts` couvre le changement de compte dans le même navigateur, l'invitation résiduelle, l'invitation ciblée et la confirmation exacte du personnage. Les requêtes Discord externes sont simulées uniquement par le dispositif E2E local déjà utilisé ; application, callbacks, cookies, contrôles PKCE et effets PostgreSQL sont réels.

Les résultats effectivement exécutés et le commit validé sont consignés dans la PR. Pas de migration ni de backfill automatique : un mapping incohérent préexistant reste bloqué en attente de contrôle, sans conversion arbitraire.

# Sécurité

## Accès

Il n’existe aucune inscription publique. Une invitation contient 32 octets aléatoires ; seul `SHA-256(pepper:token)` est conservé. Elle expire, est révocable, à usage unique et consommée atomiquement. Discord OAuth demande `identify guilds` et vérifie `DISCORD_GUILD_ID` avant attribution du rôle.

Les sessions sont en base, HttpOnly, Secure en production, SameSite=Lax, limitées à 12 heures. L’adaptateur Auth.js de `apps/web/lib/auth-session-adapter.ts` vérifie effectivement `sessionVersion` et `revokedAt` lors de chaque lecture de session. La création d’une session vérifie sous verrou que le compte est actif et possède des rôles. Le cookie se nomme `__Secure-koeki.session-token` en production et `koeki.session-token` en développement HTTP. `DEMO_MODE=true` est strictement local.

## Autorisations

Les rôles sont `SUPER_ADMIN`, `KOEKI_MANAGER`, `ECONOMIC_AGENT`, `NINJA`, `AUDITOR`. Les permissions sont définies dans `packages/domain/src/permissions.ts` et doivent être vérifiées dans chaque commande serveur. Le masquage d’une action dans l’interface ne remplace jamais ce contrôle.

La V2 calcule l’union de tous les rôles, lus en base à chaque requête authentifiée. `audit:read` est exclusivement accordé aux responsables et super-administrateurs. Un agent ou un auditeur seul n’a plus accès à l’audit complet. L’auditeur conserve ses lectures métier via `business:read`, `statistics:read`, `inventory:read`, `inventory:export` et `reports:read-all`. Il ne reçoit pas les capacités `team:read`, `team:notes`, `users:read` ni `ranking:read`.

Les capacités `users:read`, `users:revoke`, `users:reactivate` et `users:roles` sont distinctes de `users:manage`, qui reste réservée à `SUPER_ADMIN`. Les responsables ne peuvent modifier aucun compte ayant le rôle `KOEKI_MANAGER` ou `SUPER_ADMIN`, même multirôle. Seul `users:leadership` (super-administrateur) autorise une attribution de rôle dirigeant ou une invitation dirigeante. Cela retire aux responsables la possibilité antérieure d’inviter ou promouvoir un autre responsable.

Le pilotage d’équipe distingue `team:read`, `team:assign` et `team:notes`. Le classement distingue `ranking:read` (agents et dirigeants) et `ranking:manage` (dirigeants). `tasks:read` autorise le travail attribué ; `tasks:manage` réserve création, priorité et réaffectation aux dirigeants. Les services doivent encore vérifier le périmètre de la cible : une permission générale ne donne pas accès aux tâches privées d’un collègue.

## Gestion des comptes

`/admin/comptes` recherche les identités RP, filtre rôle et état d’accès et pagine les comptes côté serveur. La vue désactivée est distincte. Les dialogues présentent identité, rôles, dossiers et tâches ouvertes avant confirmation. Le motif est obligatoire pour retirer un accès, réactiver un compte ou modifier ses rôles. Les notes, motifs et historiques de gestion restent réservés aux dirigeants.

Une désactivation conserve compte, fiche ninja, obligations fiscales, écritures et identité des auteurs. Elle supprime toutes les sessions en base, incrémente la version, clôt la participation et transfère les dossiers/tâches ouvertes vers un autre agent actif ou « À attribuer ». Une nouvelle soumission identique ne crée pas une seconde révocation utile. Retirer seulement le rôle d’agent préserve les autres rôles ; s’il s’agit du dernier rôle, il faut en conserver un ou utiliser la désactivation explicite.

La réactivation motivée supprime également les anciennes sessions : elle requiert une nouvelle connexion et ne restaure aucune ancienne affectation. Les rôles dirigeants restent soumis aux mêmes restrictions. La consommation d’invitation revalide l’état de la cible et l’autorité actuelle du créateur : elle ne peut réactiver implicitement un compte révoqué ni consommer un ancien privilège d’un créateur rétrogradé.

Les mutations de comptes, invitations, création de sessions et affectations partagent le verrou transactionnel PostgreSQL `621714424`, pris avant les verrous de dossiers. L’acteur, ses rôles, la cible et le nombre de super-administrateurs actifs sont relus après acquisition. Un accès super-administrateur compte seulement si le compte possède un lien OAuth Discord ou une session non expirée dont la version correspond. Le compte technique de bootstrap sans connexion ne permet donc pas de supprimer le dernier véritable accès. Toute auto-révocation est refusée ; les révocations et rétrogradations concurrentes ne peuvent retirer le dernier accès super-administrateur actif. L’état, les réaffectations, la suppression des sessions et l’audit sont atomiques. Cette protection concerne les commandes applicatives ; une intervention SQL privilégiée nécessite ses propres contrôles.

La modification des barèmes (`settings:manage` : points et exonération par ressource, prix du catalogue, taux de taxe, pénalités, événements, recettes, administration) est réservée aux responsables Kōeki et super-administrateurs. Les agents économiques conservent uniquement les opérations quotidiennes : transactions, paiements, dossiers ninjas, stocks et rapports.

L’inventaire est découpé en `inventory:read`, `inventory:write`, `inventory:count`, `inventory:adjust`, `inventory:catalog` et `inventory:export` (voir `INVENTORY_PERMISSIONS.md`). Un agent économique enregistre des entrées et sorties ; comptages, ajustements, corrections, override de stock négatif et catalogue relèvent des responsables. Les lignes du ledger de stock sont immuables au niveau de la base (trigger) : une erreur se corrige par contre-écriture liée.

## Défense en profondeur

- CSP, anti-framing, `nosniff`, politique de référent et permissions navigateur ;
- `robots.txt` et `X-Robots-Tag: noindex, nofollow, noarchive` ;
- validation d’entrée, requêtes Prisma paramétrées, transactions et contraintes ;
- aucune valeur financière finale acceptée depuis le navigateur ;
- secrets uniquement dans Railway ; aucun jeton brut, cookie ou secret dans les audits ;
- limitation de débit à ajouter au proxy ou middleware avant ouverture production ;
- images via stockage objet privé et URL signée, jamais en base64 dans PostgreSQL.

## Checklist production

Vérifier que `DEMO_MODE` est absent, générer des secrets distincts, restreindre Discord, tester la révocation, activer les sauvegardes, configurer les alertes et effectuer un test de restauration avant ouverture.

## Dépendances — vérification du 4 octobre 2026

Le lockfile initial utilisait Next.js et `eslint-config-next` 15.5.22. Les deux paquets ont été installés et verrouillés en 15.5.27, dans la même branche de maintenance, selon la [publication officielle du 30 septembre 2026](https://nextjs.org/blog/september-2026-security-release). Ce lot traite notamment des problèmes de SSRF, caches et divulgation selon les fonctionnalités activées ; tous ne concernent pas nécessairement Kōeki.

Le point particulièrement pertinent pour le développement Windows est [GHSA-p293-qw3h-jr36](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36) : versions 13.4 à 15.5.23 concernées, correctif 15.5.24. La [publication du 22 septembre](https://nextjs.org/blog/nextjs-security-update-september-22-2026) précise que le RCE `next/og` de cet avis distinct concerne Next.js 16.2–16.3.5 : la branche 15.5.26 reçoit du durcissement mais n’est pas affectée par ce RCE. Ne pas confondre les deux avis.

React et React DOM sont verrouillés en 19.2.8 ; la [release officielle 19.2.8](https://github.com/react/react/releases/tag/v19.2.8) et l’[avis React Server Functions GHSA-wx67-qw84-cm4g](https://github.com/react/react/security/advisories/GHSA-wx67-qw84-cm4g) ont été consultés. Cet avis nomme les paquets `react-server-dom-*` et leur correctif 19.2.8 ; la version du paquet React seule ne prouve pas la correction d’un composant serveur embarqué par un framework. La mise à jour Next.js couvre son code embarqué. Aucun changement majeur de React/Next.js n’est introduit.

`corepack pnpm audit --prod --audit-level=moderate` a d’abord signalé cinq avis (trois élevés, deux modérés). Next.js conservait une dépendance exacte à PostCSS 8.4.31. Une substitution limitée à `next@15.5.27>postcss: 8.5.25` dans `pnpm-workspace.yaml` élimine les quatre avis PostCSS, dont les [lectures de fichiers par sourceMappingURL](https://github.com/postcss/postcss/security/advisories/GHSA-6g55-p6wh-862q) et la [traversée de chemins de source maps](https://github.com/postcss/postcss/security/advisories/GHSA-r28c-9q8g-f849). Kōeki ne propose pas de traitement de CSS envoyé par un utilisateur ; le correctif durcit aussi la chaîne de compilation.

Après substitution, le même audit termine avec **un avis élevé restant**, [GHSA-ggr8-5vv4-36mx](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx), sur `deepmerge-ts` 7.1.5 via `prisma > @prisma/config`. Le correctif annoncé est 8.0.0 (changement majeur). Le code installé charge cette bibliothèque dans la fusion de configuration Prisma ; aucun parcours HTTP métier Kōeki ne lui fournit de graphes d’objets cycliques externes. C’est une analyse de portée, pas une preuve d’inexploitabilité. Cet avis reste documenté, sans masquer le code d’échec de l’audit et sans imposer une substitution majeure non validée.

Cette revue de sources officielles et de versions verrouillées ne constitue ni un audit exhaustif des dépendances ni une certification de sécurité. Le déploiement reste distinct de la préparation locale du correctif.

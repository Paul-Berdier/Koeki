# Sécurité

## Accès

Il n’existe aucune inscription publique. Une invitation contient 32 octets aléatoires ; seul `SHA-256(pepper:token)` est conservé. Elle expire, est révocable, à usage unique et consommée atomiquement. Discord OAuth demande `identify guilds` et vérifie `DISCORD_GUILD_ID` avant attribution du rôle.

Les sessions sont en base, HttpOnly, Secure en production, SameSite=Lax, limitées à 12 heures. `sessionVersion` permet la révocation globale et `revokedAt` bloque immédiatement l’utilisateur. `DEMO_MODE=true` est strictement local.

## Autorisations

Les rôles sont `SUPER_ADMIN`, `KOEKI_MANAGER`, `ECONOMIC_AGENT`, `NINJA`, `AUDITOR`. Les permissions sont définies dans `packages/domain/src/permissions.ts` et doivent être vérifiées dans chaque commande serveur. Le masquage d’une action dans l’interface ne remplace jamais ce contrôle.

La modification des barèmes (`settings:manage` : points et exonération par ressource, prix du catalogue, taux de taxe, pénalités, événements, recettes, administration) est réservée aux responsables Kōeki et super-administrateurs. Les agents économiques conservent uniquement les opérations quotidiennes : transactions, paiements, dossiers ninjas, stocks et rapports.

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

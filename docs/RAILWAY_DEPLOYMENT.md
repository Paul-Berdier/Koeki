# Déploiement Railway

Le déploiement n’est jamais exécuté automatiquement par Codex. Ces étapes concernent uniquement les nouveaux services Kōeki dans le projet Railway **Naruto RP**. Ne modifier, relier ou redémarrer aucun service `toile-dor-*`.

## 1. Repository

Le repository est `https://github.com/Paul-Berdier/Koeki.git`, branche `main`. Avant le premier push :

```powershell
git status
git diff --stat
pnpm install
pnpm db:generate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git add .
git commit -m "feat: create Koeki economic management platform"
git push -u origin main
```

## 2. Base dédiée

Dans le projet Railway **Naruto RP**, ajouter un nouveau PostgreSQL et le nommer `koeki-postgres`. Activer sauvegardes et rétention selon l’offre. Ne jamais réutiliser `toile-dor-postgres`.

## 3. Service web

Créer `koeki-web` depuis le repository Koeki, branche `main`, racine `/`, Dockerfile `Dockerfile`. Variables :

```text
DATABASE_URL=${{koeki-postgres.DATABASE_URL}}
AUTH_SECRET=<secret aléatoire distinct de La Toile d'Or>
APP_URL=https://<domaine-koeki>
AUTH_URL=https://<domaine-koeki>
AUTH_TRUST_HOST=true
DISCORD_CLIENT_ID=<application Discord Kōeki>
DISCORD_CLIENT_SECRET=<secret Discord Kōeki>
DISCORD_GUILD_ID=<serveur autorisé>
INVITE_TOKEN_PEPPER=<secret aléatoire distinct>
INTERNAL_CRON_SECRET=<secret aléatoire distinct>
STORAGE_PROVIDER=s3
STORAGE_BUCKET=<bucket privé Kōeki>
STORAGE_ENDPOINT=<endpoint stockage>
STORAGE_ACCESS_KEY=<clé Kōeki>
STORAGE_SECRET_KEY=<secret Kōeki>
```

`DEMO_MODE` doit être absent. Health check : `/api/health` (répond `database: "ok"` quand PostgreSQL est joignable). La commande `pnpm start:prod` applique les migrations, vérifie les référentiels Railway et démarre le site. Aucun import, aucune synchronisation externe et aucune invitation contenant un jeton brut ne sont exécutés au démarrage.

## 4. Amorçage de la base

Pour une production vierge, ouvrir une commande ponctuelle sur `koeki-web` :

```text
pnpm db:seed:bootstrap
```

Ce bootstrap crée uniquement les référentiels : rôles, grades, barème initial, catégories de ressources, réglages (`latePenalty` désactivé, `rpTime`, seuil d’approbation non validé, application du crédit d’exonération à `0 %`), règles de points inactives et un utilisateur système `systeme@koeki.local` (SUPER_ADMIN, non connectable — il sert d’auteur aux invitations générées par script). Aucun ninja fictif, aucune taxe, aucun stock.

`pnpm db:seed` reste réservé au développement local : il crée les données fictives de démonstration.

## 4 ter. Inventaire (migration `0016_inventory_traceability`)

Le premier `pnpm start:prod` après cette version applique une migration **additive** (unités, alias, colonnes de traçabilité, sessions de comptage, triggers) et remplit les instantanés avant / après de tous les mouvements existants, puis le bootstrap aligne le catalogue initial de l’inventaire par nom (`T1` → `Plan T1`, `Chakra Métal` → `Pièces Chakra`, `Ryo` → `Ryōs`, anciens noms et codes conservés en alias, audit `RESOURCE_ALIGNED`). Aucune quantité n’est modifiée : toutes les ressources restent « Non inventorié » jusqu’au premier comptage réalisé depuis **Inventaire → Comptages → Initialiser l’inventaire**. Vérifications après déploiement : `/inventory` s’ouvre, `pnpm worker inventory:reconcile` ne signale aucun écart, le registre d’audit contient les lignes `RESOURCE_ALIGNED`.

## 4 bis. Première invitation

Toujours dans une commande ponctuelle sur `koeki-web` :

```text
pnpm db:invite
```

Le script affiche une URL `APP_URL/invite/<jeton>` (rôle `SUPER_ADMIN` par défaut, 7 jours). Variables optionnelles : `INVITE_ROLE` (`KOEKI_MANAGER`, `ECONOMIC_AGENT`, `NINJA`, `AUDITOR`) et `INVITE_EXPIRES_DAYS`. Les invitations suivantes se génèrent depuis la page Administration de l’application.

## 5. Discord

Dans le portail Discord de l’application Kōeki, ajouter exactement :

```text
https://<domaine-koeki>/api/auth/callback/discord
```

Scopes : `identify`, `guilds`. Tester : invitation valide, invitation expirée, compte hors serveur, consommation unique et révocation de session.

## 6. Worker

Créer un second service depuis le même repository, nommé `koeki-worker`. Copier seulement les variables Kōeki nécessaires, notamment la référence à `koeki-postgres`. Commande par défaut :

```text
pnpm worker all
```

Pour Railway Cron, utiliser des exécutions séparées selon la fréquence choisie :

```text
pnpm worker taxes:generate
pnpm worker penalties:apply
pnpm worker reminders:send
pnpm worker inventory:check
pnpm worker inventory:reconcile
pnpm worker stats:refresh
```

Le taux de majoration restant non configuré, `penalties:apply` doit retourner `disabled: true`.

## 7. Domaine, logs et vérifications

Associer un domaine exclusivement à `koeki-web`, mettre `APP_URL` et `AUTH_URL` à jour, puis vérifier HTTPS, cookies Secure, noindex, invitation Discord, migration, worker, reçus, audit et sauvegarde. Configurer des alertes sur erreurs 5xx, échecs de cron, connexions PostgreSQL et stockage critique.

## 8. Interdictions

Ne jamais définir `DATABASE_URL=${{toile-dor-postgres.DATABASE_URL}}`. Ne partager ni `AUTH_SECRET`, ni pepper, ni cookie, ni bucket. Ne renommer ou modifier les services de La Toile d’Or depuis ce déploiement.

## V2 — déploiement préparé, non exécuté

Appliquer les migrations additives 0017 à 0020 après revue et sauvegarde vérifiée.
Aucune commande distante n’a été lancée dans la mission V2. Déployer web et worker
avec les mêmes versions de code ; les anciennes écritures restent conservées et
les écritures non instrumentées d’une version ancienne restent exclues du
classement officiel. Exécuter d’abord `scripts/verify-v2-upgrade.cjs` sur une base
jetable locale. Ce script préserve et compare les références et montants BigInt.

Avant publication autorisée : vérifier hôte/base, absence de DEMO_MODE, sommes des
paiements/points/crédits et stocks, nombre de fiches et rapports, sessions expirées,
matrice de permissions et santé. La commande worker `ranking:close` complète les commandes existantes ;
`reminders:send` inclut les rappels de tâches et de rapports configurés. Aucun message
Discord ni email automatique n’est ajouté.

Le retour arrière recommandé est une correction en avant. Conserver les nouvelles
tables/colonnes et toutes les versions publiées ; ne pas exécuter une migration
inverse destructive ou restaurer un dump ancien sur les écritures récentes.
Un retour au binaire V1 réouvrirait les anciens droits d’audit : il n’est donc pas
un retour arrière de sécurité acceptable. Toute restauration de secours exige une
réconciliation des écritures postérieures (reçus, idempotence, ledger), sous arrêt
contrôlé des écrivains, avant réouverture.

La CI locale préparée valide migrations, permissions, concurrence, finance,
compilation et sessions navigateur. Son exécution sur GitHub n’est pas démontrée
avant push, qui reste hors autorisation de cette mission.

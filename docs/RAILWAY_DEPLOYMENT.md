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

`DEMO_MODE` doit être absent. Health check : `/api/health`. Commande de démarrage : `pnpm --filter @koeki/web start`.

## 4. Migrations et seed

Après la première construction, ouvrir une commande ponctuelle sur `koeki-web` :

```text
pnpm db:generate
pnpm db:deploy
pnpm db:seed
```

Le seed crée uniquement des données fictives. Pour une production vierge, exécuter le seed une fois puis supprimer les profils de démonstration avant ouverture, ou remplacer le seed par une commande de bootstrap administrateur contrôlée.

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
pnpm worker stats:refresh
```

Le taux de majoration restant non configuré, `penalties:apply` doit retourner `disabled: true`.

## 7. Domaine, logs et vérifications

Associer un domaine exclusivement à `koeki-web`, mettre `APP_URL` et `AUTH_URL` à jour, puis vérifier HTTPS, cookies Secure, noindex, invitation Discord, migration, worker, reçus, audit et sauvegarde. Configurer des alertes sur erreurs 5xx, échecs de cron, connexions PostgreSQL et stockage critique.

## 8. Interdictions

Ne jamais définir `DATABASE_URL=${{toile-dor-postgres.DATABASE_URL}}`. Ne partager ni `AUTH_SECRET`, ni pepper, ni cookie, ni bucket. Ne renommer ou modifier les services de La Toile d’Or depuis ce déploiement.

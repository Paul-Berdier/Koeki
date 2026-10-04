# Kōeki V2 — validation locale du 4 octobre 2026

Cette preuve concerne la branche locale `codex/koeki-v2`, depuis
`948750737a0944170772c9fbe83044e2904e90b7`, sous Windows PowerShell, Node 24.19.0 et
pnpm 11.9.0 via Corepack. Ces résultats ont été obtenus avant la publication GitHub
autorisée dans la demande de suivi. Aucun déploiement ni accès en écriture à la
production pendant cette validation. Le fichier utilisateur `.claude/settings.local.json` est conservé.

## Isolation et référence

Docker Desktop était installé mais arrêté. Un PostgreSQL 17 temporaire a été
démarré sur **127.0.0.1:55432**, sans volume persistant, avec le nom
`koeki-v2-test-20261004`. Seules des données fictives de test y sont écrites.
Les hôtes et noms de base sont vérifiés par les scripts avant migration.

- `koeki_v2_test` : fixtures navigateur, hors DEMO_MODE, vraies sessions Auth.js.
- `koeki_v2_integration_test` : tests de services et transactions PostgreSQL.
- `koeki_v2_upgrade_<timestamp>` : nouvelle base créée pour chaque preuve de montée
  depuis les 16 migrations initiales, sans remise à zéro d’une base existante.

Les fichiers `.env` n’ont pas été modifiés. Les secrets de session et cookies E2E
sont aléatoires et ne sont pas conservés dans les sources ni les captures. Les
traces Playwright locales sont ignorées par Git.

Référence avant changement : lint et typecheck réussis, 68 tests domaine réussis,
9 tests web réussis et 23 intégrations ignorées faute de PostgreSQL. Le chargeur
Vitest/esbuild initial échouait sur une permission Windows avant les tests ; le
chargeur `runner`, maintenant dans le script web, résout ce problème. Ces tests
ignorés initiaux ne sont pas comptés comme une réussite d’intégration.

## Vérifications

Les résultats de la passe finale sont consignés à la fin de ce document. Les
tests d’intégration de cette passe utilisent `REQUIRE_TEST_DATABASE=true` : aucun
test requis n’est silencieusement ignoré si la base manque.

| Domaine | Preuve exécutée |
|---|---|
| Autorisations | Matrice centrale, union des rôles, navigation filtrée ; refus URL directe de l’audit pour agent/ninja/auditeur et de la fiche détaillée d’équipe. |
| Comptes | Services acteur/cible/rôles falsifiés, invitations périmées par changement de pouvoir, auto-révocation refusée, dernier accès super-admin connectable protégé en concurrence. |
| Sessions | Adaptateur et E2E : cookie refusé après retrait et toujours refusé après réactivation ; fiche ninja conservée. |
| Affectations | Transfert ou file non attribuée, historique conservé, compte technique exclu comme remplaçant ; périodes de rôle historisées. |
| Rapports | Brouillons privés, retour obligatoire, décision/version obsolète refusée, resoumission gardant avis et instantané examiné. |
| Tâches | Périmètre agent, transitions, blocage motivé, conservation des champs lors erreur, historique des auteurs et versions. |
| Attentes | Configuration explicite, population historique, absences/participation et déduplication des rappels internes. |
| Classement | Première validation et auteur immuables ; paiement/don/rachat distincts ; imports, corrections et stocks automatiques exclus ; agents à zéro et ex æquo. |
| Temps | Bornes lundi inclus/suivant exclu, semaines ISO et changements d’année/heure ; aucune modification du calendrier fiscal RP. |
| Clôture | Publication simultanée sans doublon, semaine ouverte refusée, correction tardive publiée dans une nouvelle version. |
| Économie | Après migrations : paiements supérieurs à 2^53, allocations fiscales, crédits/plafonds, points, quantités décimales, immuabilité stock, contre-écritures et rollback atomique. |
| Migration historique | Ancien schéma réellement peuplé, puis 0017–0020 appliquées : paiement 9007199254740993 exact, auteur, ninja, points, crédit et rapport approuvé conservés ; dates inconnues préservées ; deuxième déploiement identique. |
| Interface | Actions authentifiées avec JavaScript, filtres dans URL, dialogues de comptes, menu mobile, erreurs et focus aux largeurs 1440, 768 et 390 pixels. |
| Accessibilité | Axe sur accueil, équipe, fiche agent, classement, comptes, tâches et rapports ; Échap/retour de focus, défilements au clavier, absence de débordement global et zoom CSS 200 %. |

Le scan Axe vise les règles applicables marquées WCAG 2 A/AA, 2.1 AA et 2.2 AA.
Le zoom CSS agrandit réellement texte et contrôles fixes, contrairement à un simple
changement de la police racine ; il complète le test de reflow aux trois largeurs.
Il ne remplace pas un audit manuel exhaustif du zoom natif de chaque navigateur,
des lecteurs d’écran ou de tous les critères WCAG. Aucune certification n’est revendiquée.

## Captures relues

Les captures `baseline-demo-*` sont uniquement la référence de **démonstration**.
Toutes les autres captures ci-dessous proviennent du navigateur Chromium avec
JavaScript et sessions réelles en base, `DEMO_MODE=false`. Les identités et reçus
sont fictifs. Les suffixes aléatoires distinguent les fixtures de chaque exécution.

| Écran | Desktop 1440 | Mobile 390 | Tablette 768 |
|---|---|---|---|
| Mon activité | [Capture](evidence/agent-home-desktop.png) | [Capture](evidence/agent-home-mobile.png) | [Capture](evidence/agent-home-tablet.png) |
| Pilotage responsable | [Capture](evidence/manager-home-desktop.png) | [Capture](evidence/manager-home-mobile.png) | [Capture](evidence/manager-home-tablet.png) |
| Équipe | [Capture](evidence/team-desktop.png) | [Capture](evidence/team-mobile.png) | [Capture](evidence/team-tablet.png) |
| Fiche agent | [Capture](evidence/agent-detail-desktop.png) | [Capture](evidence/agent-detail-mobile.png) | [Capture](evidence/agent-detail-tablet.png) |
| Classement | [Capture](evidence/ranking-desktop.png) | [Capture](evidence/ranking-mobile.png) | [Capture](evidence/ranking-tablet.png) |
| Comptes | [Capture](evidence/accounts-desktop.png) | [Capture](evidence/accounts-mobile.png) | [Capture](evidence/accounts-tablet.png) |
| Dialogue de retrait | [Capture](evidence/revoke-dialog-desktop.png) | [Capture](evidence/revoke-dialog-mobile.png) | [Capture](evidence/revoke-dialog-tablet.png) |

Les vérifications ont conduit à corriger la recherche par identité RP complète,
la lisibilité des formulaires, le contraste du bouton secondaire, la disponibilité
des dialogues après hydratation et le focus des tableaux défilants. Les tests
surveillent aussi les erreurs JavaScript et d’hydratation. La désactivation du
caret dans une capture Playwright modifiait temporairement les attributs avant
hydratation ; les captures gardent désormais le caret initial, sans masquer les
erreurs de l’application.

## Reproduire sous PowerShell

Le conteneur démarré pour cette mission occupe déjà le port 55432. Sur une machine
où il n’existe pas, `docker compose -f docker-compose.test.yml -p koeki-v2-validation up -d`
prépare le service équivalent. Ne pas démarrer un second serveur sur le même port.

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm db:generate
$env:DATABASE_URL_TEST = 'postgresql://koeki:koeki-local-fixture@127.0.0.1:55432/koeki_v2_integration_test?schema=public'
$env:REQUIRE_TEST_DATABASE = 'true'
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test

$env:DATABASE_URL_TEST = 'postgresql://koeki:koeki-local-fixture@127.0.0.1:55432/koeki_v2_test?schema=public'
$env:DATABASE_URL = $env:DATABASE_URL_TEST
$env:DEMO_MODE = 'false'
corepack pnpm db:deploy
corepack pnpm test:upgrade
corepack pnpm build
```

Arrêter le serveur `next dev` avant le build : les deux utilisent `.next`.
Pour l’E2E authentifié, `corepack pnpm test:e2e:auth` gère normalement son serveur.
Dans cet environnement Windows, son arrêt automatique a parfois attendu sans
terminer après les assertions. La passe finale utilise donc le serveur externe
explicitement lancé ci-dessous, puis l’exécution séparée des tests.

Terminal 1, depuis la racine, pour lancer le serveur local :

```powershell
$env:DATABASE_URL = 'postgresql://koeki:koeki-local-fixture@127.0.0.1:55432/koeki_v2_test?schema=public'
$env:DEMO_MODE = 'false'
$env:AUTH_SECRET = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$env:INVITE_TOKEN_PEPPER = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$env:AUTH_URL = 'http://localhost:3100'
$env:AUTH_TRUST_HOST = 'true'
Set-Location apps/web
node node_modules/next/dist/bin/next dev --port 3100
```

Terminal 2, depuis la racine :

```powershell
$env:DATABASE_URL_TEST = 'postgresql://koeki:koeki-local-fixture@127.0.0.1:55432/koeki_v2_test?schema=public'
$env:E2E_EXTERNAL_SERVER = 'true'
Set-Location apps/web
node node_modules/@playwright/test/cli.js test --config playwright.auth.config.ts
```

Les tests créent leurs sessions sans endpoint, header ni rôle de secours en
production. Le serveur local peut être arrêté par Ctrl+C. La connexion humaine
Discord utilise les variables habituelles de l’application, pas les fixtures E2E.
La CI Ubuntu prépare PostgreSQL et les dépendances Chromium ; ses commandes Unix
sont préparées mais n’ont pas été exécutées sur un runner distant dans cette mission.

## Limites réelles

- Discord OAuth complet n’a pas été testé avec des identifiants Discord réels.
- Les fixtures ne représentent pas une volumétrie de production. Les
  [mesures PostgreSQL](KOEKI_V2_PERFORMANCE.md) détaillent portée et limites.
- L’audit de dépendances conserve un avis élevé `deepmerge-ts` via Prisma/config,
  analysé dans [SECURITY.md](SECURITY.md). Il n’est pas présenté comme un audit propre.
- À la fin de la validation locale initiale, le pipeline GitHub n’avait pas encore
  été exécuté (voir le suivi ci-dessous). Railway et la restauration distante n’ont pas été exécutés.
  La [procédure de retour arrière](ROLLBACK.md) préserve les écritures et interdit
  une restauration ancienne sans rapprochement.

## Passe finale

| Commande effectivement exécutée | Résultat |
|---|---|
| `corepack pnpm lint` | Réussite. |
| `corepack pnpm typecheck` | Réussite sur les packages, web et worker. |
| `corepack pnpm test` avec la base d’intégration obligatoire | **158 réussis** : 94 domaine + 64 web, dont 49 intégrations PostgreSQL ; aucun ignoré. |
| `corepack pnpm test:upgrade` | **PASS**, conservation historique et second passage **PASS**, dernière base `koeki_v2_upgrade_1791133208697`. |
| `corepack pnpm build` avec DEMO_MODE=false | **Réussite**, domaine/auth/database/worker compilés et build Next.js 15.5.27 complet. |
| `node node_modules/@playwright/test/cli.js test --config playwright.auth.config.ts` depuis apps/web, serveur externe authentifié | **15 réussis**, 3 formats, aucune exclusion (3 min 18 s environ). |
| Même configuration avec `--grep 'authenticated screens'` après renforcement du test de focus | **3 réussis**, six tabulations restant dans chaque dialogue ; captures finales régénérées, dialogue limité au viewport. |
| `node node_modules/@playwright/test/cli.js test --workers 2` depuis apps/web, serveur externe de démonstration | **24 réussis**, 10 exclusions explicites par projet (14 s), aucune exclusion faute de base. |
| `node scripts/measure-v2-queries.cjs --write-report` | Lectures et EXPLAIN read-only exécutés, rapport conservé. |
| `corepack pnpm audit --prod --audit-level=moderate` | Échec attendu : **1 avis élevé restant** documenté, pas une réussite de sécurité. |
| `git -c safe.directory=C:/Users/Paul/Documents/Codage/Koeki -c core.whitespace=cr-at-eol diff --check` | Réussite après retrait de trois lignes vides finales ; CRLF Windows conservés. |

Les journaux Prisma « unique constraint » et « immutable » correspondent à des
refus intentionnellement provoqués par les tests. Les avertissements pg sur les
appels concurrents d’une transaction et Node sur NO_COLOR sont non bloquants ;
ils ne sont pas des erreurs cachées. Les scripts ne considèrent pas un code d’échec
comme un succès.

La suite de démonstration utilise maintenant JavaScript sur tous ses formats.
La première tentative sans JavaScript restait dans le nouvel écran de chargement
streamé par Next.js ; elle n’est pas comptée comme passée. Les assertions métier
existantes ont été conservées et rejouées avec JavaScript (CSP, recherche ninja,
inventaire, comptage, équipement, rapports et absence de présélection fiscale).

Commande exacte de cette régression locale, serveur lancé séparément :

```powershell
# Depuis apps/web, après le build, avec DATABASE_URL pointant la base jetable :
$env:DEMO_MODE = 'true'
node node_modules/next/dist/bin/next start --port 3000
# Dans un second terminal apps/web :
$env:E2E_DEMO_EXTERNAL_SERVER = 'true'
node node_modules/@playwright/test/cli.js test --workers 2
```

Le serveur de démonstration a été arrêté après cette vérification. Le build a
été relancé après la correction du lien de tâche sur l’accueil : il ouvre
directement la tâche filtrée même si elle n’est pas dans la première page.

## Suivi de publication GitHub

La [PR #2](https://github.com/Paul-Berdier/Koeki/pull/2) publie ce lot à la demande
explicite de l’utilisateur. Le premier passage Ubuntu a réussi installation,
génération, migrations, lint, typecheck et les 94 tests domaine. Il a ensuite
révélé l’expansion du glob non cité `--exclude e2e/**` par le shell Unix avant
Vitest. L’argument redondant a été retiré : `vitest.config.ts` conserve l’exclusion
et n’inclut que les fichiers `*.test.ts`. Le statut final du workflow est attaché
à la PR ; aucune fusion ne doit contourner un contrôle en échec.

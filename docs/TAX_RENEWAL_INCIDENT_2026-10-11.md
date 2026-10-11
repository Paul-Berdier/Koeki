# Renouvellement fiscal — incident du 11 octobre 2026

## Cause observée

Les logs Railway du worker montrent une génération réussie RP 56 le 13 septembre, RP 57 le 20 septembre et RP 58 le 27 septembre. Le 4 octobre, le processus s'arrête avant tout job sur un import ESM (`closeCompletedRankings` depuis `@koeki/database`). Le correctif de portée ESM déjà intégré le 8 octobre ne rejoue pas les commandes : le cron n'était déclenché qu'une fois par semaine. Le marqueur de production reste donc à RP 58. Les dossiers créés entre deux passages hebdomadaires peuvent également manquer leur première taxe.

L'incident n'est pas une disparition des paiements. « Renouveler » signifie créer la ligne de la nouvelle semaine, jamais effacer une dette ou remettre à zéro les encaissements.

## Périmètre et règles conservées

- Base Kōeki uniquement ; aucun changement des autres applications du projet Railway.
- Montants et grades historiques : recherche dans `NinjaGradeHistory` et politiques applicables à la période. Pas de rétrofacturation au grade actuel après une promotion.
- Aucune ligne existante de paiement, allocation, crédit, point, pénalité, ajustement ou transaction de ressources modifiée par `taxes:recover`.
- Aucune facture avant la création du dossier. Cas de cycle de vie ambigu ou de grade historique absent retenus pour contrôle, pas devinés.
- Les anciennes lignes réelles à zéro restent conservées. Seuls les placeholders `UNKNOWN` non réglés et sans aucune écriture associée de la semaine courante peuvent être remis au grade connu, comme avant.
- Les périodes déjà enregistrées gardent leurs dates. Pour une configuration hebdomadaire ancrée lundi à minuit local, les prochaines bornes suivent `Europe/Paris`, y compris les semaines de 167/169 heures. Les autres échelles RP conservent leur fonctionnement.
- La réparation ne change ni barème, ni majorations, ni plafond, ni politique d'exonération. Le taux d'application observé en production est de 0 % : aucun crédit n'est consommé par le rattrapage.

## Commandes

Sur une base locale jetable, utiliser la CI et les scripts existants. Le nouveau test PostgreSQL crée une base locale unique, y applique les migrations et ne supprime que cette base qu'il vient de créer. `REQUIRE_TEST_DATABASE=true` rend l'absence de base bloquante.

```sh
pnpm db:generate
pnpm lint
pnpm typecheck
pnpm test
pnpm test:upgrade
pnpm build
pnpm --filter @koeki/worker test
pnpm test:e2e
pnpm test:e2e:auth
```

En exploitation, vérifier le projet, l'environnement, le commit déployé et l'année RP avant toute commande d'écriture. Prévisualiser :

```sh
pnpm worker taxes:recover --from-rp-year=56 --expect-rp-year=59 --dry-run
```

La prévisualisation utilise une transaction PostgreSQL `READ ONLY`, ne modifie pas le marqueur et détaille chaque période, son montant et les dossiers retenus. `--expect-rp-year` empêche d'appliquer un plan relu avant un changement de semaine. La plage est bornée à treize semaines déjà ouvertes.

Après contrôle du plan, sauvegarde exploitable et autorisation d'intervention :

```sh
pnpm worker taxes:recover --from-rp-year=56 --expect-rp-year=59 --apply
pnpm worker taxes:statuses
pnpm worker stats:refresh
pnpm worker taxes:recover --from-rp-year=56 --expect-rp-year=59 --dry-run
```

Ces valeurs 56/59 décrivent cet incident, pas une commande à rejouer aveuglément dans le futur. Contrôler ensuite les montants, les empreintes des écritures protégées, l'absence de doublons et les éventuels dossiers en attente. La nouvelle action `TAX_WEEK_RECOVERED` contient les références des lignes/dossiers concernés. Une contre-écriture contrôlée, et non une suppression de paiements, est le mécanisme de correction si une anomalie métier est découverte.

## Exploitation durable

`railway.worker.json` passe à `5 * * * *` (cron UTC), soit une vérification à cinq minutes de chaque heure. Le job termine puis quitte ; `restartPolicyType=NEVER` évite une boucle permanente. La génération revisitera la dernière période et la précédente pour prendre en compte les arrivées et interruptions, avec unicité en base et verrou transactionnel. Les taxes sont normalisées en `DUE`/`OVERDUE` depuis le grand livre, indépendamment des notifications. Les rappels fiscaux sont dédupliqués par ligne, destinataire et semaine, même après lecture.

`workerHealth` stocke la fin du dernier passage et les commandes en échec. Vérifier qu'il est récent, que `success=true` et que `taxGeneration.lastRpYear` correspond à la période courante. Ce marqueur n'est pas à lui seul une alerte externe. Les erreurs d'import sont aussi testées dans le Dockerfile avec le runtime réellement déployé, pas seulement par TypeScript.

La configuration Railway héritée du service existant est conservée pour limiter le périmètre de cette réparation. La plateforme annonce la fin du support de Config as Code le 1er décembre 2026 ; prévoir séparément sa migration vers Infrastructure as Code. Les services temporaires de diagnostic/rattrapage sont configurés via les paramètres Railway, sans nouvelle dépendance à un `railway.recovery.json`, sans domaine public et sans cron. Les retirer après validation.

## Preuves d'intervention

La PR et ses journaux de validation portent les résultats effectivement obtenus. Au stade de la prévisualisation du 11 octobre à 19:13 UTC, aucune écriture fiscale n'a encore été faite : RP 56 = 40 lignes / 445 000 Ryō ; RP 57 = 36 / 390 000 ; RP 58 = 109 / 1 215 000 ; RP 59 = 790 / 11 925 000 ; un dossier RP 59 est retenu pour contrôle de son cycle de vie. Ce paragraphe décrit un aperçu, pas une preuve d'application. Voir le bilan final de la PR pour l'exécution et les vérifications de conservation.

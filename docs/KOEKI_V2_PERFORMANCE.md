# Kōeki V2 — mesures de lectures PostgreSQL

Mesure effectuée le 2026-10-04T17:11:33.641Z, sur les fixtures synthétiques locales `127.0.0.1:55432/koeki_v2_test`, PostgreSQL 17.10, Node v24.19.0. Référence inspectée : `948750737a0944170772c9fbe83044e2904e90b7`. Le script ne modifie aucune donnée métier, configuration ou migration ; il n’exécute ni ANALYZE ni VACUUM.

## Méthode et portée

Le script exécute les formes de lectures Prisma inspectées dans les sources : navigation initiale, navigation V2, graphe fiscal d’un dossier, équipe, fiche agent et classement. Il capture le nombre réel de SELECT émis par Prisma, puis exécute les mêmes SELECT et paramètres avec `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. Les deux connexions sont en transaction **READ ONLY / REPEATABLE READ** et partagent un instantané PostgreSQL exporté : les volumes, lectures et plans portent sur le même état, même si un autre test écrit ensuite des fixtures. Les paramètres, noms, notes et secrets ne sont pas publiés dans le résultat.

Chaque groupe a une passe de chauffe puis **7 répétitions**. La colonne Prisma mesure le temps médian des lectures équivalentes, sérialisation interne Prisma et aller-retours locaux compris. Les requêtes se trouvent dans une transaction dédiée, donc la concurrence du pool d’une requête HTTP réelle n’est pas reproduite. Les temps EXPLAIN sont les sommes des temps d’exécution PostgreSQL pour chaque groupe, hors planification, puis leur médiane. Les octets sont la taille JSON équivalente des objets reçus par le script, **pas une mesure des octets du protocole réseau ni du HTML**.

Il ne s’agit pas d’un benchmark des fonctions de service complètes : contrôle de session, calculs de présentation, cache React, sérialisation RSC, rendu navigateur et requêtes annexes du layout ne sont pas chronométrés. La fiche mesurée utilise une fenêtre glissante UTC de 90 jours ; le service prend minuit civil Paris à J−90. L’équipe est mesurée pour la semaine ISO complète, filtre effectivement accepté par le service, plutôt que son intervalle par défaut des sept derniers jours. Les résultats concernent cette petite base de fixtures, pas la production, une charge concurrente ou un volume représentatif.

Période : `2026-W40`, du 2026-09-27T22:00:00.000Z inclus au 2026-10-04T22:00:00.000Z exclu. Instant de référence : 2026-10-04T17:05:22.980Z. Première page équipe : 30 agents (plafond 30).

## Volumes observés

| Table | Lignes |
|---|---:|
| User | 144 |
| NinjaProfile | 144 |
| TaxAssessment | 0 |
| TaxPayment | 22 |
| TaxPaymentAllocation | 0 |
| TaxPenalty | 0 |
| TaxAdjustment | 0 |
| TaxExemption | 0 |
| PointLedgerEntry | 0 |
| ResourceTransaction | 22 |
| InventoryMovement | 0 |
| AgentParticipation | 56 |
| AgentAbsence | 0 |
| FollowUpTask | 24 |
| AgentReport | 24 |
| AgentNote | 24 |
| RankingPeriod | 0 |
| RankingVersion | 0 |

## Résultats reproductibles

| Lectures équivalentes | SELECT | Médiane Prisma (ms) | Somme EXPLAIN médiane (ms) | Lignes SQL retournées | JSON équivalent (octets) |
|---|---:|---:|---:|---:|---:|
| Navigation initiale : graphe fiscal global et identités globales | 13 | 25.866 | 0.47 | 433 | 104194 |
| Navigation V2 : calendrier et identité courante | 2 | 3.184 | 0.059 | 1 | 55 |
| Graphe fiscal V2 limité à un dossier | 11 | 20.067 | 0.413 | 2 | 611 |
| Équipe : première page de 30 agents et agrégats ciblés | 17 | 45.861 | 2.126 | 231 | 25696 |
| Fiche agent : 90 jours et historiques plafonnés | 15 | 23.561 | 1.08 | 11 | 2001 |
| Classement : preuves semaine courante, populations et versions | 10 | 24.974 | 0.74 | 197 | 33288 |

Les lignes SQL sont la somme des lignes à la racine des plans des SELECT : les lectures de relations sont comptées séparément, donc ce ne sont pas des lignes métier uniques.

## Changements structurels et invariants

- La navigation initiale chargeait tous les ninjas, leurs points, taxes, pénalités, allocations, paiements associés, ajustements, exonérations et toutes les identités pour un badge et le nom courant. La navigation V2 ne charge que le paramétrage RP et l’identité du compte. Dans cette mesure : **13 → 2 SELECT**, **104194 → 55 octets JSON équivalents**. Le badge fiscal global a été retiré de la navigation ; sa lecture exacte reste dans les parcours économiques autorisés. Ce gain correspond à un travail supprimé de la navigation, pas à une égalité artificielle entre le compteur historique et la constante interne `overdueCount: 0` désormais non affichée.
- Le graphe fiscal d’une fiche peut maintenant être limité à son ID : **0 lignes fiscales globales contre 0 pour le dossier mesuré**. Les agrégats calculés depuis le graphe ciblé et depuis le graphe global sont strictement égaux pour ce dossier.
- Vérification indépendante SQL/BigInt des agrégats de référence sur les ninjas actifs : dette **0 Ryō**, **0 dossier(s) en retard** ; égalité **PASS**. Les statuts exclus, annulations après décès, pénalités, ajustements, exonérations et seuls paiements validés sont pris en compte. **Limite : aucun appel fiscal n’existe dans cette base de fixtures. Cette égalité à zéro ne prouve donc pas la conservation de montants non nuls ni la performance d’un historique fiscal rempli.** Les tests financiers couvrent séparément de grands BigInt et les contre-écritures, sans constituer un benchmark.
- L’équipe page 30 agents et agrège paiements/transactions sur leurs IDs et la période. La fiche agent borne les opérations à 90 jours/50 paiements/50 dons-rachats, 100 dossiers, 20 rapports, 30 tâches/notes/affectations et 12 périodes publiées. Le classement lit les contributions de sa semaine et les périodes concernées, sans lire le grand livre des points ninja.
- Ces bornes limitent les lignes renvoyées ; elles ne prouvent pas que chaque requête ne parcourt que ces lignes. La fiche lit encore des instantanés complets des 12 classements puis extrait l’agent ; les versions de la semaine du classement ne sont pas paginées. Les périodes de participation/avis peuvent aussi croître. Une optimisation de ces points devra être motivée par un volume représentatif.

## Plans et limites

| Groupe | Blocs partagés en cache (dernière passe) | Blocs lus (dernière passe) | Planification médiane (ms) |
|---|---:|---:|---:|
| shell_head | 13 | 0 | 0.992 |
| shell_v2 | 3 | 0 | 0.089 |
| ninja_scoped | 11 | 0 | 0.563 |
| team_overview | 68 | 0 | 2.395 |
| agent_detail | 28 | 0 | 1.12 |
| ranking | 19 | 0 | 0.982 |

Les index de première validation, participation et tâches sont présents via les migrations. PostgreSQL peut choisir des parcours séquentiels sur ces petites tables : ce choix n’est pas un défaut démontré et ces temps ne justifient pas à eux seuls de nouveaux index. Des index complémentaires par auteur/date et l’accès aux instantanés JSON devront être évalués à plus grande échelle. Le dashboard économique et le registre global utilisent encore des agrégats étendus ; aucune accélération de ces pages n’est revendiquée ici.

Empreintes SHA-256 abrégées des sources inspectées :

- `apps/web/lib/data.ts` : `12a006f3b9fea377`
- `apps/web/lib/team-service.ts` : `b960fdafb66babb3`
- `apps/web/lib/ranking-service.ts` : `c85cb85ab73a99f0`
- `packages/database/src/ranking.ts` : `ced4311ec2a593a6`

## Rejouer

PowerShell (commande utilisée ; URL strictement locale et jetable) :

```powershell
$env:DATABASE_URL_TEST = 'postgresql://koeki:koeki-local-fixture@127.0.0.1:55432/koeki_v2_test'
$env:V2_PERF_NOW = '2026-10-04T17:05:22.980Z'
$env:V2_PERF_ITERATIONS = '7'
node scripts/measure-v2-queries.cjs --write-report
```

Sans `--write-report`, le script affiche seulement le JSON des mesures. L’URL est contrôlée avant connexion ; aucune commande destructive, seed ou migration n’est exécutée. La commande Unix équivalente (non exécutée dans cet environnement Windows) consiste à préfixer la même invocation Node avec ces trois variables d’environnement.

## Lecture complémentaire avec versions de classement

Une seconde exécution en lecture seule a été réalisée le **2026-10-04T17:11:57.216Z** sur `koeki_v2_integration_test`, avec le même instant de référence, PostgreSQL, Node et sept répétitions. Les empreintes de sources sont identiques à celles de la mesure principale. Cette base rassemble les fixtures persistantes des suites d’intégration ; les scénarios financiers détaillés utilisent un rollback et n’y laissent donc aucun appel fiscal.

Volumes : 162 utilisateurs, 41 ninjas, 15 paiements, 43 transactions de ressources, 110 mouvements de stock, 51 participations, 25 tâches, 17 rapports, 5 notes, **1 période et 15 versions de classement**. `TaxAssessment`, allocations, pénalités, ajustements, exonérations, points et absences contiennent zéro ligne.

| Lectures équivalentes | SELECT | Médiane Prisma (ms) | Somme EXPLAIN médiane (ms) | Lignes SQL retournées | JSON équivalent (octets) |
|---|---:|---:|---:|---:|---:|
| Navigation initiale | 13 | 21.524 | 0.244 | 218 | 40376 |
| Navigation V2 | 2 | 2.971 | 0.086 | 1 | 51 |
| Graphe fiscal d’un dossier | 11 | 13.150 | 0.254 | 2 | 617 |
| Équipe, 30 agents | 17 | 35.458 | 1.541 | 125 | 18420 |
| Fiche agent | 15 | 23.495 | 0.758 | 23 | 19649 |
| Classement avec versions | 11 | 25.391 | 0.731 | 179 | 181381 |

Cette seconde mesure rend visible le volume des instantanés : **181381 octets JSON équivalents** dans le groupe classement et **19649** dans la fiche agent. Elle ne permet pas d’isoler un coût par version, puisque les populations des deux bases diffèrent. La croissance des versions est donc un point concret à surveiller, sans prétendre démontrer un problème de latence. Les plans ont lu zéro bloc hors cache ; aucune conclusion sur un démarrage à froid n’en découle.

Le contrôle fiscal ciblé/global et SQL/BigInt passe également à zéro, avec la même limite d’absence d’appels fiscaux. Les six tests PostgreSQL de `apps/web/lib/finance-v2.integration.test.ts` valident séparément les paiements, dons, rachats, crédits, points, stock, contre-écritures et doublons, dont des montants supérieurs à `Number.MAX_SAFE_INTEGER` ; leur résultat ne constitue pas une mesure de performance.

Commande effectivement exécutée pour cette lecture complémentaire :

```powershell
$env:DATABASE_URL_TEST = 'postgresql://koeki:koeki-local-fixture@127.0.0.1:55432/koeki_v2_integration_test'
$env:V2_PERF_NOW = '2026-10-04T17:05:22.980Z'
$env:V2_PERF_ITERATIONS = '7'
node scripts/measure-v2-queries.cjs
```

Les suites peuvent ajouter des fixtures entre deux exécutions : les volumes et timings évolueront. Chaque exécution utilise néanmoins un instantané cohérent. `--write-report` remplace tout ce fichier par le rapport d’une seule base ; conserver cette lecture complémentaire séparément si le rapport principal est régénéré. Le pilote `pg` émet actuellement un avertissement de dépréciation lors des lectures Prisma simultanées dans une transaction ; les exécutions ont terminé avec code 0 et tous les contrôles ont passé.

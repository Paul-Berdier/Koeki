# Classement des agents — V1

## Usage

`/classement` est accessible aux agents économiques, responsables Kōeki et super-admins via `ranking:read`. Le rôle technique super-admin ne crée aucune participation. Les responsables gèrent les périodes de participation dans Équipe ; une entrée inconnue conserve `startsAt = null` et commence, pour le classement, à sa date d’observation.

Choisir la semaine avec les liens précédent / courant / suivant. Les agents voient la synthèse collective et leurs propres références de contributions ; les responsables disposent du filtre par identité, des contributions de l’équipe et des commandes de clôture/correction. Les motifs internes de correction ne sont pas transmis aux agents.

Une absence d’opération s’affiche « Aucune opération ». Ce constat ne constitue ni une sanction ni une preuve de faute. Les identités reposent sur l’ID utilisateur, distinct du dossier ninja. Une révocation ultérieure ne retire pas la participation des périodes précédentes.

## Formule et calendrier

La formule `distinct-validated-operations-v1` compte un paiement fiscal validé, un don validé ou un rachat validé comme une contribution. Chaque référence métier ne compte qu’une fois. Une entrée automatique en stock n’est pas une contribution supplémentaire ; une inversion de ligne de stock liée à une transaction exclut la transaction d’origine jusqu’à résolution explicite. Les comptages restent des indicateurs complémentaires séparés.

Les montants sont conservés en `BigInt`, puis sérialisés en chaînes dans les instantanés. Ils sont informatifs, sans pondération. Le classement ne modifie pas les points ninja, soldes, crédits ou récompenses économiques. L’ancien score relatif 60/40 n’est pas la formule du classement.

La semaine court du lundi 00:00 inclus au lundi suivant 00:00 exclu dans `Europe/Paris`, avec instants stockés en UTC. Le calcul utilise les dates civiles locales : une semaine traversant un changement d’heure peut durer 167 ou 169 heures. Le numéro de semaine suit ISO 8601, y compris aux changements d’année. Le calendrier fiscal RP n’est pas modifié.

Les ex æquo partagent le rang, par exemple 1, 1, 3. Leur ordre d’affichage est déterministe par ID utilisateur. Une comparaison n’est affichée qu’entre semaines clôturées couvertes, avec même formule, même population, participation complète de la personne et absence d’absence déclarée sur les semaines comparées. La semaine ouverte indique donc « Pas de comparaison ».

## Origine, auteur et première validation

La première validation des nouveaux enregistrements métier est datée dans PostgreSQL par un trigger, au premier passage `VALIDATED`. L’horodatage existant `validatedAt` financier n’est pas réécrit. L’origine explicite vaut `BUSINESS` ou `SELF_DECLARED` ; `IMPORT`, `TECHNICAL` et `UNKNOWN` sont exclus. Les scripts d’import existants écrivent `IMPORT`. Les brouillons, attentes, annulations et inversions sont exclus.

Le paiement crédite `recordedById`. La transaction de ressources conserve désormais `recordedById`, distinct de `agentId`, ce dernier pouvant désigner le gestionnaire qui valide une déclaration ninja. Un responsable approbateur ne reçoit donc pas l’activité de l’auteur. Une déclaration faite par un ninja sans période de participation ne fait concourir ni ce ninja ni le valideur.

La migration reprend uniquement des dates `validatedAt` corroborées par un audit métier pertinent, un auteur réel et une concordance temporelle de moins de 60 secondes. Les créations historiques de ressources sans auteur initial démontré restent inconnues. Les importations identifiées par les clés `imp-*`/`kv-*` sont exclues. Aucune date financière n’est déduite de la seule création d’un brouillon.

Le réglage `rankingCoverage.reliableFrom` mémorise le début de la couverture instrumentée. Les semaines antérieures ou à cheval sur cette date restent explicitement incomplètes même si certaines contributions sont vérifiables. Les écritures d’une ancienne version de l’application, pendant un déploiement progressif, restent `UNKNOWN` et ne sont pas certifiées. Il n’y a pas de prétention de certification rétrospective.

## Clôture, reprise et correction

Le worker `ranking:close` est inclus dans la commande `all`. Il rattrape les semaines terminées depuis le début de couverture et vérifie les périodes déjà clôturées. Une semaine ouverte est toujours refusée. Les périodes sont uniques par semaine ISO ; les versions sont uniques par période/numéro. Un verrou PostgreSQL par période sérialise les appels concurrents et les relances réutilisent la version existante.

Chaque version conserve période, formule, population et fenêtres de participation, métriques, rangs, date de calcul, identité métier, auteur, montant et date de validation des contributions. Les versions sont immuables en base. La première validation, l’auteur et le montant d’une opération validée sont également immuables ; les corrections financières utilisent les mécanismes existants de contre-écriture.

Une inversion tardive signale la période originale comme nécessitant correction. La lecture et le worker comparent aussi l’empreinte des sources pour détecter une inversion de stock, une modification de participation ou une écriture validée tardivement visible. Le worker ne republie jamais silencieusement une période fermée. Un responsable choisit « Publier une nouvelle version motivée », avec au moins 10 caractères de justification et le numéro courant pour éviter une décision obsolète. Les anciennes versions restent consultables. Un changement de nom seul ne provoque pas de correction de classement.

## Vérification locale

Sous PowerShell, avec les dépendances du dépôt installées :

```powershell
corepack pnpm --filter @koeki/domain test
$env:DATABASE_URL_TEST = 'postgresql://koeki:koeki-local-fixture@127.0.0.1:55432/koeki_v2_integration_test?schema=public'
corepack pnpm --filter @koeki/web test lib/ranking.integration.test.ts
corepack pnpm --filter @koeki/web test lib/ranking-service.integration.test.ts
corepack pnpm worker ranking:close
```

L’URL ci-dessus vise uniquement le serveur jetable local de validation. Vérifier explicitement l’hôte et la base avant utilisation. La suite de classement simule un instant futur de clôture pour la semaine de ses fixtures ; elle ne doit pas tourner sur la base des captures ou une base utilisateur. Aucune URL de production ni secret réel n’est fourni ici.

Les résultats de commandes réellement exécutées et les limites figurent dans `KOEKI_V2_VALIDATION.md`. Les migrations sont `0018_weekly_ranking` et `0019_ranking_evidence_immutability` ; elles s’ajoutent aux migrations existantes sans les modifier.

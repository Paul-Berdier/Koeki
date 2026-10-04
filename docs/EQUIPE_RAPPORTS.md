# Équipe, tâches et rapports — Kōeki V2

## Parcours quotidien

L’agent ouvre son accueil puis **Mes tâches**. Il peut passer une tâche attribuée à « En cours », signaler « Bloqué » avec une explication, puis la terminer avec une résolution. Une tâche terminée ou annulée ne se rouvre que par l’encadrement, avec justification. L’agent ne peut modifier ni référent, ni priorité, ni échéance. Les nouvelles affectations et décisions de rapport apparaissent dans **Mes notifications** ; leurs liens repassent par les contrôles de droits des pages.

Dans **Rapports**, l’agent rédige son résumé pour une période terminée avant de soumettre. Un brouillon reste privé, y compris vis-à-vis des responsables. Les périodes déjà couvertes ne peuvent pas se chevaucher. Lors d’une correction demandée, ouvrir le rapport et lire les avis, puis **Corriger mon rapport**. La nouvelle soumission conserve les avis et le contenu précédemment examiné.

## Pilotage responsable

**Équipe** (`/equipe`) est réservé aux responsables et super-administrateurs. Les filtres identité, état, dates et tri restent dans l’URL. Le registre comprend les agents sans opération ; « Aucune activité enregistrée » n’est pas une faute. La page distingue absence déclarée, entrée récente, sortie de service et compte désactivé. Les dossiers et tâches en retard décrivent la situation actuelle ; les opérations et rapports dépendent de la période choisie.

La fiche utilise l’identifiant du **compte** (`/equipe/[userId]`). Elle présente les périodes de participation, absences, dossiers, tâches, rapports attendus, sources métier et les douze dernières semaines publiées au classement. Les notes restent réservées à l’encadrement ; elles ne sont jamais copiées dans une notification. Les liens vers les dossiers utilisent les identifiants **ninja**, distincts du compte.

La section **Dossiers à attribuer** conserve `NinjaProfile.referenceAgentId` comme source d’affectation. Déplier un dossier, choisir un agent actif et préciser le motif. Une réaffectation depuis la fiche peut aussi mettre le dossier en attente, sans référent. Chaque changement est historisé. Le retrait d’accès et le retrait du rôle agent utilisent ce même historique depuis **Administration → Comptes**.

Dans **Tâches de l’équipe**, créer un objectif, préciser priorité, référent et échéance. Un dossier et un rapport peuvent être associés. Depuis un rapport, **Créer une tâche liée à ce rapport** remplit le lien source ; aucun ancien texte libre `followUps` n’est converti automatiquement. Réaffectations, annulations et réouvertures exigent un motif.

## Examen des rapports

**Examiner** ouvre le contenu, la version et les avis. **Approuver** confirme cette version ; **Demander une correction** impose un commentaire d’au moins dix caractères. L’auto-validation, la décision concurrente et une version devenue obsolète sont refusées côté serveur. Les dates historiques de soumission ou de décision inconnues restent inconnues.

Les totaux sont des instantanés recalculés lors de l’écriture d’un brouillon ou d’une soumission, puis conservés après approbation. Une inversion/correction de source est signalée sur le rapport sans réécrire les totaux approuvés. Le classement est calculé à partir des opérations, jamais par addition des rapports. Pour l’historique des transactions dont `recordedById` est inconnu, les vues d’accompagnement conservent le champ historique `agentId` ; il peut représenter le gestionnaire d’une ancienne approbation. Cette attribution n’est pas une preuve d’auteur d’origine. Le classement applique ses propres exclusions documentées.

## Attentes et rappels

Sans règle, afficher **Attente non configurée**. Les responsables peuvent configurer une cadence hebdomadaire, une population (`ECONOMIC_AGENT` ou tous les participants), une date d’effet future et un délai de zéro à trente jours après la semaine. Chaque nouvelle règle conserve la précédente. Une période commencée avant sa date d’effet ne devient jamais obligatoire. Toute absence chevauchant une semaine et toute entrée/sortie pendant celle-ci dispensent cette semaine ; il n’y a aucune sanction automatique. Un ancien rapport chevauchant la semaine est reconnu, sans générer de doublon.

`AgentParticipation.serviceRole` conserve la population lors de l’ouverture, indépendamment des rôles actuels. La migration 0020 ne reconstitue que les participations dont la provenance est étayée ; les autres restent inconnues et ne sont pas soumises à une obligation d’agent rétroactive. `startsAt = null` signifie une entrée historique inconnue ; `observedAt` donne la première observation fiable. La sortie ferme la période sans l’effacer ; la réactivation ne recrée pas les anciennes affectations.

Le worker existant `reminders:send` produit des notifications internes pour les tâches échues et les rapports attendus, avec clés uniques indépendantes de leur statut lu/non lu. Le réglage `taskReminders.enabled` désactive les rappels de tâches ; chaque règle de rapports possède son option de rappel. Aucune communication externe n’est envoyée. Les rappels de rapports parcourent au maximum douze semaines ; l’historique complet reste accessible dans les registres.

## Sécurité, performances et limites

Les mutations prennent le verrou transactionnel partagé avec les comptes, puis revalident l’acteur, ses droits et le référent actif. Les tâches utilisent une version optimiste. Les lectures des tâches sont limitées aux affectations de l’agent, et les lectures d’équipe aux dirigeants. Les formulaires d’équipe/tâches conservent les champs lors d’une erreur connue sans stocker de brouillons confidentiels dans le navigateur ; les envois en cours désactivent les contrôles.

L’équipe est paginée par trente comptes, les tâches par vingt-cinq, les notifications par cinquante. Les métriques utilisent des agrégations ciblées. La fiche borne la chronologie à quatre-vingt-dix jours et cinquante paiements plus cinquante dons/rachats ; ses listes de dossiers, tâches, notes et affectations sont également bornées. Les registres sources sont accessibles par leurs liens. La recherche accepte les mots d’une identité RP complète ; le tri privilégie le nom et prénom RP puis le nom du compte.

Migrations additives : `0017_team_reporting` (participation, absences, historique, tâches, notes, avis et attentes), `0020_participation_role_snapshot` (population historique). Aucune donnée économique ni migration préexistante n’est remplacée. Les tests unitaires `team-workflow.test.ts` et PostgreSQL `team-reports.integration.test.ts` couvrent les droits de lecture, les retours, l’historique, la concurrence, les tâches, la révocation et les rappels.

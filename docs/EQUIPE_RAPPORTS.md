# Équipe, tâches et rapports — Kōeki V2

## Parcours quotidien

L’agent ouvre **Mon bureau** puis **Mes tâches**. Il peut passer une tâche attribuée à « En cours », signaler « Bloqué » avec une explication, puis la terminer avec une résolution. Une tâche terminée ou annulée ne se rouvre que par l’encadrement, avec justification. L’agent ne peut modifier ni l’affectation, ni la priorité, ni l’échéance d’une tâche. Les nouvelles affectations de tâches et décisions de rapport apparaissent dans **Mes notifications** ; leurs liens repassent par les contrôles de droits des pages.

Les dossiers **Ninjas** sont communs au service : tous les agents peuvent travailler sur le même registre. Il n’existe ni référent de dossier, ni filtre « Mes dossiers », ni transfert de dossiers lors d’un départ. Une tâche peut être confiée à un agent et liée à un dossier sans lui en donner la propriété.

Dans **Rapports**, l’agent rédige son résumé pour une période terminée avant de soumettre. Un brouillon reste privé, y compris vis-à-vis des responsables. Les périodes déjà couvertes ne peuvent pas se chevaucher. Lors d’une correction demandée, ouvrir le rapport et lire les avis, puis **Corriger mon rapport**. La nouvelle soumission conserve les avis et le contenu précédemment examiné.

## Pilotage responsable

**Équipe** (`/equipe`) est réservé aux responsables et super-administrateurs. La période choisie reste dans l’URL ; recherche, filtre d’état et tri permettent de parcourir les agents. Le registre comprend les agents sans opération et les anciens auteurs humains encore identifiables dans les opérations, même sans rôle métier ni participation conservée. « Aucune activité enregistrée » n’est pas une faute. La page distingue absence déclarée, entrée récente, sortie de service et compte désactivé. Les tâches en retard décrivent la situation actuelle ; les opérations et rapports dépendent de la période choisie.

La fiche utilise l’identifiant du **compte** (`/equipe/[userId]`). Elle présente les périodes de participation, absences, tâches, rapports attendus, sources métier et les douze dernières semaines publiées au classement. Les notes restent réservées à l’encadrement ; elles ne sont jamais copiées dans une notification. Les liens vers les dossiers utilisent les identifiants **ninja**, distincts du compte.

Dans **Administration → Comptes**, un départ peut transférer les tâches ouvertes à un autre agent actif ou les laisser « À attribuer ». Les anciennes références ninja n’interviennent plus dans l’interface ni dans les droits ; elles restent conservées comme métadonnées historiques lors d’un départ. Les données et anciens historiques ne sont pas supprimés.

Dans **Tâches de l’équipe**, créer un objectif, préciser priorité, agent chargé de la tâche et échéance. Un dossier et un rapport peuvent être associés. Depuis un rapport, **Créer une tâche liée à ce rapport** remplit le lien source ; aucun ancien texte libre `followUps` n’est converti automatiquement. Réaffectations, annulations et réouvertures exigent un motif.

## Historique des opérations

Le journal `/classement/agents/[userId]` est accessible à chaque agent pour son propre compte, et aux responsables et super-administrateurs pour tous les comptes. `/classement/agents/moi` ouvre son historique personnel. Les droits sont revérifiés côté serveur, y compris lorsque l’identifiant est saisi directement.

Le journal réunit paiements, dons et rachats conservés, tous états et origines, à raison de vingt-cinq lignes par page. Sans filtre de dates, il n’impose aucune limite d’ancienneté. Les dates filtrent la première validation prouvée ; à défaut, la validation enregistrée, puis l’enregistrement. Chaque remplacement est indiqué et ne devient jamais une preuve de validation pour le classement.

Un ancien `agentId` sans auteur `recordedById` reste une association incertaine, visible sans contribution attribuée. Une date d’entrée inconnue reste inconnue ; une opération ancienne ne reconstitue pas une participation. Les comptes techniques sont exclus du registre d’équipe et une simple déclaration personnelle ne transforme pas un ninja en ancien agent. Consulter le journal ou une ancienne semaine ne publie ni ne clôture automatiquement un classement : les versions officielles suivent leur procédure explicite.

## Examen des rapports

**Examiner** ouvre le contenu, la version et les avis. **Approuver** confirme cette version ; **Demander une correction** impose un commentaire d’au moins dix caractères. L’auto-validation, la décision concurrente et une version devenue obsolète sont refusées côté serveur. Les dates historiques de soumission ou de décision inconnues restent inconnues.

Les totaux sont des instantanés recalculés lors de l’écriture d’un brouillon ou d’une soumission, puis conservés après approbation. Une inversion/correction de source est signalée sur le rapport sans réécrire les totaux approuvés. Le classement est calculé à partir des opérations, jamais par addition des rapports, et applique ses propres exclusions documentées.

## Attentes et rappels

Sans règle, afficher **Attente non configurée**. Les responsables peuvent configurer une cadence hebdomadaire, une population (`ECONOMIC_AGENT` ou tous les participants), une date d’effet future et un délai de zéro à trente jours après la semaine. Chaque nouvelle règle conserve la précédente. Une période commencée avant sa date d’effet ne devient jamais obligatoire. Toute absence chevauchant une semaine et toute entrée/sortie pendant celle-ci dispensent cette semaine ; il n’y a aucune sanction automatique. Un ancien rapport chevauchant la semaine est reconnu, sans générer de doublon.

`AgentParticipation.serviceRole` conserve la population lors de l’ouverture, indépendamment des rôles actuels. La migration 0020 ne reconstitue que les participations dont la provenance est étayée ; les autres restent inconnues et ne sont pas soumises à une obligation d’agent rétroactive. `startsAt = null` signifie une entrée historique inconnue ; `observedAt` donne la première observation fiable. La sortie ferme la période sans l’effacer ; la réactivation ne réattribue pas les tâches transférées.

Le worker existant `reminders:send` produit des notifications internes pour les tâches échues et les rapports attendus, avec clés uniques indépendantes de leur statut lu/non lu. Le réglage `taskReminders.enabled` désactive les rappels de tâches ; chaque règle de rapports possède son option de rappel. Aucune communication externe n’est envoyée. Les rappels de rapports parcourent au maximum douze semaines ; l’historique complet reste accessible dans les registres.

## Sécurité, performances et limites

Les mutations prennent le verrou transactionnel partagé avec les comptes, puis revalident l’acteur, ses droits et l’agent actif chargé de la tâche. Les tâches utilisent une version optimiste. Leurs lectures sont limitées aux tâches attribuées à l’agent, et les lectures d’équipe aux dirigeants. Les formulaires d’équipe/tâches conservent les champs lors d’une erreur connue sans stocker de brouillons confidentiels dans le navigateur ; les envois en cours désactivent les contrôles.

Le registre d’équipe affiche douze agents par page, les tâches vingt-cinq et les notifications cinquante. Les métriques utilisent des agrégations ciblées. Les aperçus de fiche et les listes de suivi sont bornés ; le journal paginé permet de parcourir l’historique complet. Les montants restent exacts en BigInt et les courbes comptent les opérations, sans additionner paiements et valeur des ressources.

Migrations additives : `0017_team_reporting` (participation, absences, historique, tâches, notes, avis et attentes), `0020_participation_role_snapshot` (population historique). Aucune donnée économique ni migration préexistante n’est remplacée. Les tests unitaires `team-workflow.test.ts` et PostgreSQL `team-reports.integration.test.ts` couvrent les droits de lecture, les retours, l’historique, la concurrence, les tâches, la révocation et les rappels.

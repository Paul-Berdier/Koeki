# Kōeki V2 — décisions et périmètre

Cette évolution conserve le moteur fiscal RP, les montants BigInt, les crédits,
points ninja et mouvements immuables. La base PostgreSQL reste indépendante.
Le développement et la validation ont été réalisés sur `codex/koeki-v2`.
La publication GitHub et la fusion sont autorisées dans la demande de suivi ;
le déploiement et les écritures en production restent distincts.

## Autorité et confidentialité

« Responsable » et « gérant » désignent KOEKI_MANAGER. Les capacités sont réunies
sur **tous** les rôles dans la matrice centrale `packages/domain/src/permissions.ts`.

| Capacité | Agent | Auditeur | Ninja seul | Responsable | Super-admin |
|---|---|---|---|---|---|
| Audit complet | Non | Non | Non | Oui | Oui |
| Lectures métier existantes | Oui | Oui | Personnel/catalogue autorisé | Oui | Oui |
| Classement collectif synthétique | Oui | Non | Non | Oui | Oui |
| Journal d’opérations d’un agent | Propre compte | Non | Non | Tous les comptes | Tous les comptes |
| Tâches | Attribuées | Non | Non | Équipe | Équipe |
| Notes et suivi détaillé d’équipe | Non | Non | Non | Oui | Oui |
| Retrait/réactivation de comptes ordinaires | Non | Non | Non | Oui | Oui |
| Attribution de rôles dirigeants | Non | Non | Non | Non | Oui |

`users:manage` reste exclusivement super-admin. Les autres capacités sont séparées
(lecture des comptes, rôles, révocation, réactivation, leadership, affectation,
notes, tâches et classement). Aucun rôle dirigeant ne peut être attribué par un
responsable, y compris par invitation. Cette restriction aux **deux** rôles
dirigeants est un changement explicite de politique.

Les actions d’accès rechargent l’acteur et la cible dans la transaction, sous un
verrou PostgreSQL commun aux affectations et à la création de sessions. Le dernier
accès super-admin connectable est protégé des mutations concurrentes. Les sessions
en base sont supprimées lors de la coupure et l’adaptateur Auth.js vérifie l’état
et la version à la lecture. Aucun cookie ancien n’est ressuscité à la réactivation.
Voir [Sécurité](SECURITY.md).

## Comptes et continuité

`/admin/comptes` recherche l’identité RP et filtre rôle/état avec pagination serveur.
Les trois opérations « Retirer le rôle d’agent », « Désactiver l’accès au site » et
« Réactiver l’accès » sont distinctes, motivées, auditées et confirmées dans un
dialogue. Les dossiers ninjas sont collectifs, sans référent ni transfert.
Le transfert facultatif porte uniquement sur les tâches ouvertes ; sans remplaçant,
elles passent à « À attribuer ». L’historique, les auteurs, les obligations
fiscales et les fiches restent conservés. Une réactivation exige une nouvelle
connexion et ne réattribue pas les tâches transférées. Les références ninja héritées
n’ont plus d’effet fonctionnel et restent conservées comme métadonnées historiques,
y compris lors d’un départ.

## Travail quotidien et encadrement

Le bureau agent affiche ses tâches, retours de rapports et accès au registre ninja
commun. Le bureau responsable affiche décisions, travail prioritaire et accès au
pilotage. Aucun dossier ninja n’est réservé à un agent ; une tâche liée à un dossier
reste attribuable. Les opérations conservent leurs routes et bénéficient d’un point
d’entrée `/operations`. La navigation regroupe les sous-sections par module ;
le menu mobile utilise Radix Dialog.

`/equipe` et `/equipe/[userId]` montrent également les agents sans activité. Une
participation observée lors de la migration garde sa date d’entrée inconnue ;
entrées/sorties, absences et affectations de tâches sont historisées. Les anciens
auteurs humains restent consultables même sans rôle métier ou participation
conservée, sans reconstituer de date d’entrée. Aucune surveillance
de présence, écran ou frappe. Les fiches d’équipe utilisent les identifiants
utilisateurs, les liens de dossiers les identifiants ninja.

Les tâches structurées ont cinq états, un auteur, une affectation facultative à un
agent, une échéance, une priorité, une résolution et un historique. L’agent peut faire avancer ses tâches ; les
objectifs, affectations et dates restent sous contrôle du responsable.
Les notifications sont internes, destinées à un seul compte, dédupliquées et
leurs liens sont soumis aux mêmes permissions. Aucun envoi externe n’est ajouté.

## Rapports

Les brouillons restent privés. Une décision contrôle statut, auteur et version ;
un retour impose un commentaire. Les avis conservent le contenu examiné, leur
auteur et la date, sans effacer les motifs précédents après resoumission.
Les instantanés financiers approuvés restent stables ; les corrections de sources
sont signalées. Les anciennes périodes sont préservées et ne peuvent se chevaucher.
L’attente est explicitement configurable pour les futures périodes, avec population
et échéance. En l’absence de règle : « Attente non configurée ».
Voir le [guide équipe et rapports](EQUIPE_RAPPORTS.md).

## Classement

Le score V1 est le **nombre de paiements fiscaux, dons et rachats validés distincts**.
Il ne touche jamais PointLedger et ne déclenche aucune récompense. Le calendrier
va du lundi 00:00 inclus au lundi suivant 00:00 exclu dans Europe/Paris, avec les
changements d’heure et les années ISO. Il reste indépendant du temps RP.

La première validation serveur détermine la semaine ; l’auteur métier détermine
l’attribution. Les imports, écritures techniques, brouillons, annulations et
inversions sont exclus. Un stock automatique n’ajoute aucun point. Les agents sans
opération restent présents, les ex æquo partagent leur rang. La participation
explicite évite d’inscrire automatiquement les comptes techniques dirigeants.

Les versions clôturées sont immuables, vérifiables et calculées une seule fois
sous verrou. Une correction tardive appelle une nouvelle version motivée. La
couverture historique incomplète et les comparaisons non valables sont affichées
explicitement. Voir [les règles complètes du classement](CLASSEMENT.md).

Le journal `/classement/agents/[userId]`, indépendant des versions publiées, rend
tous les paiements, dons et rachats conservés consultables par pages de vingt-cinq,
sans limite d’ancienneté par défaut. L’agent voit son compte uniquement ; les
dirigeants peuvent ouvrir tous les comptes. Les filtres de dates et la pagination
restent dans l’URL. L’auteur enregistré est distingué d’un simple ancien `agentId` ;
une validation enregistrée ou une date de création de remplacement ne prouve pas
la première validation. Les exclusions sont indiquées et les montants restent
exacts. Cette consultation ne publie ni ne clôture automatiquement d’anciennes
semaines, et ne transforme pas une association incertaine en contribution.

## Architecture, migrations et performances

Les services comptes, équipe, rapports et classement sont séparés de `lib/data.ts`.
Les nouvelles tables sont additives et indexées. Les vues paginent les comptes,
l’équipe et les tâches ; les aperçus sont bornés et le journal d’opérations est paginé.
La navigation ne charge plus l’ensemble des historiques fiscaux : elle lit le
réglage RP et la seule identité du compte. Une fiche ninja ne charge que son
propre historique. Le cache React reste limité à la requête, sans cache global
de permissions.

Les migrations nouvelles sont `0017_team_reporting`, `0018_weekly_ranking`,
`0019_ranking_evidence_immutability`, puis `0020` pour la preuve historique du rôle
de participation. Aucune migration antérieure n’est réécrite. Les vérifications
et limites réelles sont consignées dans [la validation](KOEKI_V2_VALIDATION.md).

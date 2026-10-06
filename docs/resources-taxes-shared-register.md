# Ressources, taxes par agent et registre partagé

## Règle métier
Les ninjas n’ont pas d’agent référent. Tous les agents autorisés travaillent sur le même registre. La responsabilité d’une opération correspond à son auteur enregistré, pas à une attribution de dossier ni à un approbateur.

Les liens `mesDossiers=1` n’appliquent plus de filtre. L’ancienne action `assignDossier` répond par un refus sans écrire. Les départs du service transfèrent seulement les tâches explicites ; ils ne réattribuent ni les ninjas ni les paiements historiques. Les anciennes colonnes et lignes d’audit d’affectation sont conservées pour compatibilité, sans migration destructive. Les anciens agrégats de compatibilité ne sont plus présentés comme une charge de dossiers.

## Valeurs & tarifs
Accès : Stocks & catalogue → Valeurs & tarifs, ou le raccourci du bureau responsable. Autorisation : `settings:manage`, vérifiée dans la route, l’action et de nouveau dans la transaction.

Chaque formulaire ne modifie que le prix de rachat, les points, le crédit d’exonération par unité et le besoin du village. Le motif est audité. Le prix précédent est clôturé, jamais réécrit. Une révision SHA-256 des valeurs empêche un formulaire ancien d’écraser le changement d’un autre responsable. Le verrou de ressource est commun à l’éditeur existant. Aucun stock, reçu passé ou crédit déjà gagné n’est recalculé.

Zéro désactive le rachat ; un prix encore inconnu peut rester vide. Les points et crédits peuvent être mis à zéro explicitement.

## Taxes par agent
Accès : Pilotage → Taxes par agent ; liens depuis le bureau, le recouvrement, le tableau des agents et leurs fiches. Autorisation responsable : `team:read`, y compris relecture en base des rôles et de la révocation.

Le montant est la somme exacte BigInt de `TaxPayment.amount`, par `recordedById`, pour des paiements validés dans la période et un moyen de paiement reconnu comme espèces/Ryō. Les dates choisies incluent la journée de fin en heure de Paris. Les reçus sont paginés à 25 sans tronquer les totaux. Une opération couvrant plusieurs années RP n’est comptée qu’une fois.

Les paiements métier sont séparés des anciennes origines `UNKNOWN`, `IMPORT`, `LEGACY`. Aucun historique n’est réattribué ou reclassé par supposition. Les reçus annulés, inversés, non validés, les crédits et les dates de validation inconnues ne gonflent pas les encaissements. Les anciens auteurs désactivés restent consultables et les agents sans encaissement restent visibles.

La rubrique Dossiers d’une fiche agent est désormais une liste des ninjas concernés par ses opérations validées pendant la période. Un même ninja peut apparaître chez plusieurs agents ; cela ne restreint aucun accès.

## Vérification
La CI utilise uniquement PostgreSQL jetable local pour les tests d’écriture, de concurrence et de conservation des historiques. Les tests navigateur doivent vérifier l’édition effective, l’accès refusé pour un agent, le détail des reçus et l’accès au registre partagé. Aucun test métier ne doit être lancé contre la base Railway de production.

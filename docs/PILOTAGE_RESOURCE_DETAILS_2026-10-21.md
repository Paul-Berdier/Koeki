# Pilotage : détail des dons et rachats — 21 octobre 2026

## Problème

Le journal d’un agent affichait uniquement `ResourceTransaction.totalAmount` en Ryō. Les lignes `ResourceTransactionItem` existaient, mais n’étaient pas chargées dans cette vue : impossible de distinguer un métal de chakra d’un autre objet à partir du montant.

## Correctif

- La vue d’ensemble du pilotage montre les huit dernières opérations de ressources dans la période sélectionnée.
- L’onglet **Dons & rachats** (`/equipe?vue=ressources`) présente 25 opérations par page avec recherche objet/code, reçu ou ninja et filtre don/rachat.
- Le journal de chaque agent (`/equipe/[userId]?vue=activite`) montre également toutes les lignes d’objets, pas uniquement le total.
- Quantité exacte, nom, code et unité de chaque ressource, auteur enregistré et ninja concerné sont visibles. La recherche filtre les opérations sans supprimer les autres objets d’un même reçu.
- Les valeurs enregistrées `unitPriceSnapshot`, `lineTotal` et `totalAmount` restent distinctes. Aucun recalcul à partir du tarif actuel.
- Les mouvements de stock liés, signés, et leurs contre-écritures sont consultables. Une contre-écriture présente via deux relations est affichée une seule fois. Sa date réelle est conservée, même hors période du reçu. Un lien ouvre le journal de toutes les entrées/sorties, y compris celles sans don ou rachat.
- Un historique sans ligne d’objet est signalé explicitement. Le code ne devine pas les objets depuis leur montant.

## Sens des valeurs

Un don est un apport de ressources. Son équivalent en Ryō n’est **pas un encaissement en espèces**. Un rachat est aussi une entrée de ressources, avec un coût de rachat : ce n’est pas une sortie d’objets. Les paiements fiscaux restent séparés. Les états annulé, en attente et inversé sont affichés, sans les présenter comme des mouvements validés. L’existence d’un stock réellement documenté vient du ledger, jamais d’une supposition tirée du montant.

Les quantités Decimal sont transmises comme chaînes et formatées sans conversion flottante. Les montants restent BigInt. Les noms et unités proviennent du catalogue actuel, car le schéma ne possède pas de snapshot historique de ces libellés ; les identifiants, quantités et valeurs enregistrées sont conservés.

## Autorisations et portée

Contrôle `team:read` dans chaque lecture : responsables et super-administrateurs seulement. Les agents et auditeurs seuls ne peuvent pas consulter le pilotage. Aucun rôle, mutation, migration, changement de stock, fiscalité, crédit, point, identité ou auteur historique. Pas de nouvel endpoint public. Lecture groupée des détails du journal agent, limitée à 100 identifiants ; pagination du journal global.

`recordedById` prime sur `agentId`. Un auteur historique absent n’est pas inventé : l’agent associé est identifié comme tel. Les dates suivent les jours civils Europe/Paris, avec borne de fin exclusive, notamment au changement d’heure.

## Validation prévue

Les tests ajoutés couvrent les objets multiples et à valeur nulle, les quantités décimales, les anciennes valeurs différentes du catalogue, les limites de dates, les historiques incomplets, les annulations, les contre-écritures, l’attribution à l’auteur original et le refus d’accès aux agents/auditeurs. Les tests navigateur couvrent le pilotage, la recherche conservant toutes les lignes du reçu et la fiche agent sur ordinateur/tablette/mobile, avec des fixtures locales isolées.

Les résultats réellement obtenus, le SHA fusionné et le statut de livraison sont consignés dans la PR. Aucun succès de déploiement ne doit être déduit d’une simple fusion GitHub.

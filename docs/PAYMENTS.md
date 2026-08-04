# Paiements

Un paiement passe par aperçu puis validation serveur. Le serveur recharge les dettes, trie par année RP croissante puis alloue majorations avant principal. Le navigateur ne peut imposer une allocation.

`TaxPayment` conserve le reçu, le montant, les soldes avant/après, l’agent, le moyen, la référence, le statut et la clé d’idempotence. `TaxPaymentAllocation` détaille la répartition. Une correction utilise `TaxAdjustment` ou un paiement inverse ; une ligne validée n’est jamais supprimée.

Format de reçu : `PAY-2026-000001`. Le numéro est généré dans la transaction et protégé par une contrainte unique.

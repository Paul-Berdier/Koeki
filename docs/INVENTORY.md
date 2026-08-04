# Inventaire

Le stock n’est jamais édité directement. Il est la somme des `InventoryMovement` : dons, rachats, consommations et sorties d’artisanat, ajustements, transferts et pertes.

Chaque mouvement précise ressource, quantité décimale contrôlée, coût éventuel, source, agent, justification, date et clé d’idempotence. Une commande serveur doit verrouiller ou revalider le stock dans la transaction et refuser un résultat négatif, sauf permission exceptionnelle auditée.

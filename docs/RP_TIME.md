# Temps RP

`createRpTimeService` est l’unique source des conversions. La configuration initiale associe une date UTC réelle, une année RP, 604 800 000 ms par année RP, le fuseau `Europe/Paris`, le début fiscal et le délai d’échéance.

Le service calcule l’année actuelle, les bornes, l’échéance, les années complètes de retard, la progression et un libellé RP. Toutes les dates techniques sont UTC. Modifier l’ancrage est une opération administrative auditée ; les années fiscales déjà créées conservent leurs dates instantanées.

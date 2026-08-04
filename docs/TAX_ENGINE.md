# Moteur fiscal

Le barème initial est versionné dans `TaxPolicy` et `TaxPolicyGradeRate`. Les codes de grade restent stables ; seuls les libellés et montants évoluent. Une évaluation conserve le code, le libellé, la politique et le montant observés lors de sa génération.

La contrainte unique `(ninjaId, taxYearId)` interdit deux taxes annuelles. Le worker utilise `createMany(skipDuplicates)` : une relance produit zéro doublon. Un changement de politique ou de grade n’altère jamais une évaluation existante.

Barème : 0 / 0 / 10 000 / 15 000 / 20 000 / 25 000 / 25 000 / 25 000 / 0 / 0 Ryō, dans l’ordre des grades documentés. Les montants sont des `BigInt` et les aides typées sont dans `packages/domain/src/money.ts`.

Les majorations sont des lignes `TaxPenalty`. Sans taux en points de base validé et automatisation explicitement activée, le calcul retourne `null`. Maximum initial : quatre applications ; plafond de dette par évaluation : 32 000 Ryō ; base recommandée : `ORIGINAL_TAX`.

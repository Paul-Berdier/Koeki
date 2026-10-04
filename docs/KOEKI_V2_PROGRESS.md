# Kōeki V2 — progression

## Point de départ vérifié (4 octobre 2026)

- Dépôt Paul-Berdier/Koeki, branche initiale `main`, HEAD `948750737a0944170772c9fbe83044e2904e90b7`.
- Branche de travail locale `codex/koeki-v2`. Aucun push, déploiement ou accès à une base distante.
- Fichier utilisateur préservé : `.claude/settings.local.json` (non suivi). Aucun AGENTS.md applicable trouvé.
- Windows PowerShell, Node 24.19.0 ; `corepack pnpm` fournit la version verrouillée 11.9.0. Le raccourci `pnpm` fournit 11.19.0 : utiliser Corepack pour la suite.
- Référence : lint et typecheck réussis ; domaine 68 tests réussis. Vitest web via le chargeur `runner` : 9 réussis, 23 intégration ignorés faute de PostgreSQL. Le chargeur par défaut rencontre une restriction d'accès esbuild Windows avant les tests.
- Serveur de référence lancé en mode démonstration sur le port 3000 ; captures explicitement identifiées comme démonstration, pas comme preuve authentifiée.

## Lots terminés

1. Permissions et comptes : union des rôles, audit dirigeant, révocation/réactivation motivées, invitations revalidées, sessions invalidées, comptes paginés et dialogues.
2. Équipe et rapports : participation et rôles historiques, absences, affectations, tâches, avis versionnés, attentes configurables et notifications internes.
3. Classement : semaines Europe/Paris, contributions métier, première validation immuable, versions de clôture et correction, worker idempotent.
4. Interface : accueils par rôle, navigation groupée et modale mobile, espace Opérations, administration séparée, lisibilité et formulaires préservés en erreur.
5. Consolidation : 158 tests domaine/web dont 49 PostgreSQL, 15 E2E authentifiés, migration depuis l’ancien schéma, build et documentation. Résultats détaillés dans [la validation](KOEKI_V2_VALIDATION.md).

Un propriétaire par lot a travaillé avec un responsable d’intégration. La revue croisée a aussi corrigé l’exclusion du compte technique des remplaçants, l’ordre des verrous de publication et les périodes de participation contiguës. Aucun changement des barèmes, pénalités, plafonds ni du temps fiscal RP n’a été introduit.

## Preuves et limites finales

- PostgreSQL jetable démarré sur loopback, deux bases de test distinctes ; migrations 0017–0020 appliquées.
- L’ancien schéma a été peuplé puis migré ; données conservées et second déploiement sans changement.
- Captures authentifiées desktop/tablette/mobile dans [evidence](evidence/), distinctes des deux captures initiales de démonstration.
- Mesures SQL reproductibles dans [la note de performance](KOEKI_V2_PERFORMANCE.md) ; aucun benchmark production revendiqué.
- OAuth Discord réel, CI distante et déploiement Railway non exécutés. Un avis élevé deepmerge-ts via Prisma/config reste documenté dans [SECURITY](SECURITY.md).
- Validation locale terminée sur codex/koeki-v2. Le suivi autorise maintenant commit,
  push, PR et fusion sous réserve des contrôles GitHub. Aucun déploiement manuel
  ni accès en écriture à la base de production n’est inclus.

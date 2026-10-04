/* Read-only measurements against explicit local disposable fixtures.
 * Prisma queries reproduce inspected read shapes; this is NOT a benchmark of
 * HTTP, authentication, React/RSC rendering, or the complete service functions.
 * Optional --write-report replaces docs/KOEKI_V2_PERFORMANCE.md only. */
const { Client } = require('../packages/database/node_modules/pg');
const { PrismaClient, Prisma } = require('../packages/database/node_modules/@prisma/client');
const { PrismaPg } = require('../packages/database/node_modules/@prisma/adapter-pg');
const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const baseline = '948750737a0944170772c9fbe83044e2904e90b7';
const json = (value) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const rounded = (value) => Number(value.toFixed(3));
const sums = (rows) => rows.reduce((sum, row) => sum + BigInt(row.amount), 0n);
const excluded = ['EXEMPT', 'WAIVED', 'SUSPENDED', 'CANCELLED', 'DRAFT'];
const identitySelect = { id: true, name: true, revokedAt: true, ninjaProfile: { select: { firstName: true, lastName: true } } };
const graph = { currentGrade: true, pointEntries: { select: { points: true } }, assessments: { include: { penalties: { select: { amount: true } }, adjustments: { select: { amount: true } }, exemptions: { select: { amount: true } }, allocations: { select: { amount: true, payment: { select: { status: true } } } }, taxYear: { select: { rpYear: true } } } } };

function fiscal(ninja, now) {
  const rows = ninja.assessments.map((assessment) => {
    const gross = assessment.originalAmount + sums(assessment.penalties) + sums(assessment.adjustments);
    const paid = sums(assessment.allocations.filter((entry) => entry.payment.status === 'VALIDATED'));
    const remaining = excluded.includes(assessment.status) || (ninja.diedAt && assessment.dueAt > ninja.diedAt) ? 0n : gross - paid - sums(assessment.exemptions);
    return { id: assessment.id, remaining: String(remaining > 0n ? remaining : 0n), overdue: remaining > 0n && assessment.dueAt < now };
  }).sort((a, b) => a.id.localeCompare(b.id));
  return { points: ninja.pointEntries.reduce((total, entry) => total + entry.points, 0), debt: String(rows.reduce((total, row) => total + BigInt(row.remaining), 0n)), overdue: rows.some((row) => row.overdue), assessments: rows };
}

function planStats(plan) {
  const scans = [];
  const visit = (node) => {
    if (/Scan$/.test(node['Node Type'])) scans.push({ type: node['Node Type'], relation: node['Relation Name'] ?? null, loops: node['Actual Loops'], rows: node['Actual Rows'], removed: node['Rows Removed by Filter'] ?? 0 });
    for (const child of node.Plans ?? []) visit(child);
  };
  visit(plan.Plan);
  return { executionMs: plan['Execution Time'], planningMs: plan['Planning Time'], rows: plan.Plan['Actual Rows'], hits: plan.Plan['Shared Hit Blocks'] ?? 0, reads: plan.Plan['Shared Read Blocks'] ?? 0, scans };
}

async function main() {
  const url = new URL(process.env.DATABASE_URL_TEST || 'postgresql://koeki:koeki-local-fixture@127.0.0.1:55432/koeki_v2_test');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !['koeki_v2_test', 'koeki_v2_integration_test', 'koeki_test'].includes(url.pathname.slice(1))) throw new Error('Explicit local disposable Kōeki database required');
  const iterations = Number(process.env.V2_PERF_ITERATIONS || 7);
  if (!Number.isInteger(iterations) || iterations < 3 || iterations > 30) throw new Error('V2_PERF_ITERATIONS must be between 3 and 30');
  const now = new Date(process.env.V2_PERF_NOW || Date.now());
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid V2_PERF_NOW');
  const oldSource = execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'show', `${baseline}:apps/web/lib/data.ts`], { cwd: root, encoding: 'utf8' });
  assert.match(oldSource, /getRpService\(\), loadNinjaAggregates\(\), getUserNames\(\)/);
  assert.match(readFileSync(path.join(root, 'apps/web/lib/data.ts'), 'utf8'), /prisma\.ninjaProfile\.findUnique\(\{ where: \{ userId: session\.userId \}/);
  const pg = new Client({ connectionString: url.toString(), application_name: 'koeki-v2-performance-readonly' });
  const queries = [];
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }), log: [{ emit: 'event', level: 'query' }] });
  prisma.$on('query', (event) => { if (/^\s*SELECT\b/i.test(event.query)) queries.push({ sql: event.query, params: JSON.parse(event.params) }); });
  try {
    await pg.connect();
    await pg.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = (await pg.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    if (!/^[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+$/.test(snapshot)) throw new Error('Unexpected PostgreSQL snapshot identifier');
    const identity = (await pg.query('SELECT current_database() AS database, inet_server_addr()::text AS server, version() AS version')).rows[0];
    const periods = (await pg.query(`SELECT (date_trunc('week', $1::timestamptz AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris') AS start,
      ((date_trunc('week', $1::timestamptz AT TIME ZONE 'Europe/Paris') + interval '7 days') AT TIME ZONE 'Europe/Paris') AS finish,
      to_char($1::timestamptz AT TIME ZONE 'Europe/Paris', 'IYYY-"W"IW') AS key,
      to_char(($1::timestamptz AT TIME ZONE 'Europe/Paris') - interval '7 days', 'IYYY-"W"IW') AS previous`, [now])).rows[0];
    const counts = {};
    for (const table of ['User', 'NinjaProfile', 'TaxAssessment', 'TaxPayment', 'TaxPaymentAllocation', 'TaxPenalty', 'TaxAdjustment', 'TaxExemption', 'PointLedgerEntry', 'ResourceTransaction', 'InventoryMovement', 'AgentParticipation', 'AgentAbsence', 'FollowUpTask', 'AgentReport', 'AgentNote', 'RankingPeriod', 'RankingVersion']) counts[table] = Number((await pg.query(`SELECT COUNT(*)::text AS count FROM "${table}"`)).rows[0].count);
    const user = (await pg.query(`SELECT u.id FROM "User" u WHERE EXISTS (SELECT 1 FROM "UserRole" ur JOIN "Role" r ON r.id=ur."roleId" WHERE ur."userId"=u.id AND r.code='ECONOMIC_AGENT') ORDER BY EXISTS(SELECT 1 FROM "TaxPayment" p WHERE p."recordedById"=u.id) DESC, u.id LIMIT 1`)).rows[0];
    if (!user) throw new Error('An economic-agent fixture is required');
    const ninja = (await pg.query('SELECT id FROM "NinjaProfile" ORDER BY CASE WHEN "referenceAgentId"=$1 THEN 0 ELSE 1 END, id LIMIT 1', [user.id])).rows[0];
    if (!ninja) throw new Error('A ninja fixture is required');
    const pageIds = (await pg.query(`SELECT u.id FROM "User" u LEFT JOIN "NinjaProfile" n ON n."userId"=u.id WHERE EXISTS(SELECT 1 FROM "UserRole" ur JOIN "Role" r ON r.id=ur."roleId" WHERE ur."userId"=u.id AND r.code='ECONOMIC_AGENT') OR EXISTS(SELECT 1 FROM "AgentParticipation" p WHERE p."userId"=u.id) ORDER BY n."lastName",n."firstName",u.name,u.id LIMIT 30`)).rows.map((row) => row.id);
    const from = periods.start, to = new Date(periods.finish.getTime() - 1), since = new Date(now.getTime() - 90 * 86_400_000);
    const teamWhere = { OR: [{ roles: { some: { role: { code: 'ECONOMIC_AGENT' } } } }, { participations: { some: {} } }] };
    const authors = { OR: [{ recordedById: { in: pageIds } }, { recordedById: null, agentId: { in: pageIds } }] };
    const agentAuthor = { OR: [{ recordedById: user.id }, { recordedById: null, agentId: user.id }] };
    const evidenceRange = { OR: [{ firstValidatedAt: { gte: from, lt: periods.finish } }, { firstValidatedAt: null, OR: [{ validatedAt: { gte: from, lt: periods.finish } }, { validatedAt: null, createdAt: { gte: from, lt: periods.finish } }] }] };
    const groups = [
      { key: 'shell_head', label: 'Navigation initiale : graphe fiscal global et identités globales', run: (tx) => Promise.all([
        tx.appSetting.findUnique({ where: { key: 'rpTime' } }), tx.ninjaProfile.findMany({ include: graph }), tx.user.findMany({ select: { id: true, name: true, ninjaProfile: { select: { firstName: true, lastName: true } } } })
      ]) },
      { key: 'shell_v2', label: 'Navigation V2 : calendrier et identité courante', run: (tx) => Promise.all([
        tx.appSetting.findUnique({ where: { key: 'rpTime' } }), tx.ninjaProfile.findUnique({ where: { userId: user.id }, select: { firstName: true, lastName: true } })
      ]) },
      { key: 'ninja_scoped', label: 'Graphe fiscal V2 limité à un dossier', run: (tx) => Promise.all([
        tx.appSetting.findUnique({ where: { key: 'rpTime' } }), tx.ninjaProfile.findMany({ where: { id: ninja.id }, include: graph })
      ]) },
      { key: 'team_overview', label: 'Équipe : première page de 30 agents et agrégats ciblés', run: (tx) => Promise.all([
        tx.user.count({ where: teamWhere }), tx.user.findMany({ where: teamWhere, select: { ...identitySelect, roles: { select: { role: { select: { code: true } } } }, participations: { orderBy: { observedAt: 'desc' } }, absences: { where: { startsAt: { lt: periods.finish }, endsAt: { gt: from } }, select: { startsAt: true, endsAt: true } } }, orderBy: [{ ninjaProfile: { lastName: 'asc' } }, { ninjaProfile: { firstName: 'asc' } }, { name: 'asc' }, { id: 'asc' }], take: 30 }),
        tx.taxPayment.groupBy({ by: ['recordedById'], where: { recordedById: { in: pageIds }, status: 'VALIDATED', validatedAt: { gte: from, lte: to } }, _count: true, _sum: { amount: true } }),
        tx.resourceTransaction.groupBy({ by: ['agentId', 'recordedById', 'type'], where: { ...authors, status: 'VALIDATED', validatedAt: { gte: from, lte: to } }, _count: true, _sum: { totalAmount: true } }),
        tx.ninjaProfile.groupBy({ by: ['referenceAgentId'], where: { referenceAgentId: { in: pageIds }, status: 'ACTIVE' }, _count: true }),
        tx.followUpTask.groupBy({ by: ['assigneeId'], where: { assigneeId: { in: pageIds }, status: { in: ['TODO', 'IN_PROGRESS', 'BLOCKED'] }, dueAt: { lt: now } }, _count: true }),
        tx.agentReport.groupBy({ by: ['authorId'], where: { authorId: { in: pageIds }, status: { not: 'DRAFT' }, periodStart: { lte: to }, periodEnd: { gte: from } }, _count: true }),
        tx.taxPayment.groupBy({ by: ['recordedById'], where: { recordedById: { in: pageIds }, status: 'VALIDATED' }, _max: { validatedAt: true } }),
        tx.resourceTransaction.groupBy({ by: ['agentId', 'recordedById'], where: { ...authors, status: 'VALIDATED' }, _max: { validatedAt: true } }),
        tx.ninjaProfile.count({ where: { referenceAgentId: null, status: 'ACTIVE' } }), tx.agentReport.count({ where: { status: 'SUBMITTED' } }), tx.reportExpectation.findMany({ where: { effectiveFrom: { lte: to } }, orderBy: { effectiveFrom: 'desc' } })
      ]) },
      { key: 'agent_detail', label: 'Fiche agent : 90 jours et historiques plafonnés', run: async (tx) => {
        const values = await Promise.all([
          tx.user.findUnique({ where: { id: user.id }, select: { ...identitySelect, participations: { orderBy: { observedAt: 'desc' }, take: 30 }, absences: { orderBy: { startsAt: 'desc' }, take: 30 } } }),
          tx.taxPayment.findMany({ where: { recordedById: user.id, createdAt: { gte: since } }, select: { id: true, receiptNumber: true, ninjaId: true, amount: true, status: true, validatedAt: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
          tx.resourceTransaction.findMany({ where: { ...agentAuthor, createdAt: { gte: since } }, select: { id: true, receiptNumber: true, ninjaId: true, totalAmount: true, status: true, type: true, validatedAt: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
          tx.ninjaProfile.findMany({ where: { referenceAgentId: user.id }, select: { id: true, firstName: true, lastName: true, status: true }, orderBy: { lastName: 'asc' }, take: 100 }),
          tx.agentReport.findMany({ where: { authorId: user.id, status: { not: 'DRAFT' } }, select: { id: true, periodStart: true, periodEnd: true, status: true }, orderBy: { periodStart: 'desc' }, take: 20 }),
          tx.followUpTask.findMany({ where: { assigneeId: user.id }, orderBy: { dueAt: 'asc' }, take: 30 }), tx.agentNote.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
          tx.assignmentHistory.findMany({ where: { OR: [{ previousAgentId: user.id }, { assignedAgentId: user.id }] }, orderBy: { createdAt: 'desc' }, take: 30 }),
          tx.rankingPeriod.findMany({ orderBy: { startsAt: 'desc' }, take: 12, select: { weekKey: true, correctionNeeded: true, versions: { orderBy: { version: 'desc' }, take: 1, select: { version: true, snapshot: true } } } })
        ]);
        values.push(await tx.user.findMany({ where: { id: { in: [...new Set(values[6].map((note) => note.authorId))] } }, select: identitySelect }));
        return values;
      } },
      { key: 'ranking', label: 'Classement : preuves semaine courante, populations et versions', run: (tx) => Promise.all([
        tx.agentParticipation.findMany({ where: { rankingEligible: true, AND: [{ OR: [{ startsAt: { lt: periods.finish } }, { startsAt: null, observedAt: { lt: periods.finish } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: from } }] }] }, include: { user: { select: { name: true, ninjaProfile: { select: { firstName: true, lastName: true } } } } } }),
        tx.taxPayment.findMany({ where: evidenceRange, select: { id: true, recordedById: true, amount: true, status: true, firstValidatedAt: true, validationEvidence: true, operationOrigin: true } }),
        tx.resourceTransaction.findMany({ where: evidenceRange, select: { id: true, recordedById: true, type: true, totalAmount: true, status: true, firstValidatedAt: true, validationEvidence: true, operationOrigin: true, movements: { where: { reversal: { isNot: null } }, select: { id: true }, take: 1 } } }),
        tx.appSetting.findUnique({ where: { key: 'rankingCoverage' }, select: { value: true } }), tx.agentAbsence.findMany({ where: { startsAt: { lt: periods.finish }, endsAt: { gt: from } }, select: { userId: true } }),
        tx.rankingPeriod.findUnique({ where: { weekKey: periods.key }, include: { versions: { orderBy: { version: 'desc' }, select: { id: true, version: true, snapshot: true, fingerprint: true, reason: true, createdAt: true } } } }),
        tx.rankingPeriod.findUnique({ where: { weekKey: periods.previous }, include: { versions: { orderBy: { version: 'desc' }, take: 1, select: { snapshot: true } } } })
      ]) }
    ];
    const results = [], raw = new Map();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      // Share the exact fixture state with counts/EXPLAIN despite other test runs.
      await tx.$executeRawUnsafe(`SET TRANSACTION SNAPSHOT '${snapshot}'`);
      for (const group of groups) {
        await group.run(tx); // One explicit warm-up; no cold-cache claim.
        const wall = [], emittedCounts = [];
        let captured, value;
        for (let iteration = 0; iteration < iterations; iteration++) {
          queries.length = 0;
          const started = process.hrtime.bigint();
          value = await group.run(tx);
          wall.push(Number(process.hrtime.bigint() - started) / 1_000_000);
          captured = [...queries]; emittedCounts.push(captured.length);
        }
        raw.set(group.key, value);
        assert.equal(new Set(emittedCounts).size, 1, `${group.key}: changing query count`);
        const explanationRuns = [], scanKinds = new Set();
        let rows = 0, hits = 0, reads = 0;
        for (let iteration = 0; iteration < iterations; iteration++) {
          let execution = 0, planning = 0; rows = 0; hits = 0; reads = 0;
          for (const query of captured) {
            const plan = (await pg.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.sql}`, query.params)).rows[0]['QUERY PLAN'][0];
            const stats = planStats(plan);
            execution += stats.executionMs; planning += stats.planningMs; rows += stats.rows; hits += stats.hits; reads += stats.reads;
            stats.scans.forEach((scan) => scanKinds.add(`${scan.type}: ${scan.relation ?? 'subquery'}`));
          }
          explanationRuns.push({ execution, planning });
        }
        results.push({ key: group.key, label: group.label, sqlQueries: emittedCounts[0], prismaWallMedianMs: rounded(median(wall)), explainExecutionMedianMs: rounded(median(explanationRuns.map((run) => run.execution))), explainPlanningMedianMs: rounded(median(explanationRuns.map((run) => run.planning))), rowsReturnedAcrossSql: rows, sharedHits: hits, sharedReads: reads, jsonEquivalentBytes: Buffer.byteLength(json(value)), scans: [...scanKinds].sort() });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 120_000 });

    const allNinjas = raw.get('shell_head')[1];
    const oldTarget = fiscal(allNinjas.find((row) => row.id === ninja.id), now);
    const scopedTarget = fiscal(raw.get('ninja_scoped')[1][0], now);
    assert.deepEqual(scopedTarget, oldTarget);
    const active = allNinjas.filter((row) => row.status === 'ACTIVE').map((row) => fiscal(row, now));
    const expectedDebt = active.reduce((total, row) => total + BigInt(row.debt), 0n);
    const totals = (await pg.query(`WITH amounts AS (
      SELECT n.id AS ninja, CASE WHEN a.id IS NULL OR a.status::text IN ('EXEMPT','WAIVED','SUSPENDED','CANCELLED','DRAFT') OR (n."diedAt" IS NOT NULL AND a."dueAt">n."diedAt") THEN 0 ELSE GREATEST(a."originalAmount"::numeric
      + COALESCE((SELECT SUM(p.amount) FROM "TaxPenalty" p WHERE p."assessmentId"=a.id),0)
      + COALESCE((SELECT SUM(d.amount) FROM "TaxAdjustment" d WHERE d."assessmentId"=a.id),0)
      - COALESCE((SELECT SUM(e.amount) FROM "TaxExemption" e WHERE e."assessmentId"=a.id),0)
      - COALESCE((SELECT SUM(l.amount) FROM "TaxPaymentAllocation" l JOIN "TaxPayment" p ON p.id=l."paymentId" WHERE l."assessmentId"=a.id AND p.status='VALIDATED'),0),0) END AS remaining,a."dueAt"
      FROM "NinjaProfile" n LEFT JOIN "TaxAssessment" a ON a."ninjaId"=n.id WHERE n.status='ACTIVE'
    ) SELECT COALESCE(SUM(remaining),0)::text AS debt, COUNT(DISTINCT ninja) FILTER(WHERE remaining>0 AND "dueAt"<$1)::integer AS overdue FROM amounts`, [now])).rows[0];
    assert.equal(totals.debt, expectedDebt.toString());
    assert.equal(totals.overdue, active.filter((row) => row.overdue).length);
    const sourceHashes = {};
    for (const file of ['apps/web/lib/data.ts', 'apps/web/lib/team-service.ts', 'apps/web/lib/ranking-service.ts', 'packages/database/src/ranking.ts']) sourceHashes[file] = createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex').slice(0, 16);
    const output = { measuredAt: new Date().toISOString(), asOf: now.toISOString(), baseline, environment: { host: url.hostname, port: url.port, database: identity.database, postgres: identity.version.split(' on ')[0], node: process.version }, iterations, calendar: { start: from.toISOString(), endExclusive: periods.finish.toISOString(), key: periods.key }, counts, selectedPageAgents: pageIds.length, results, invariants: { result: 'PASS', scopedNinjaEqualsGlobalReference: true, activeDebtRyo: totals.debt, activeOverdueCount: totals.overdue, allNinjaFiscalRows: allNinjas.reduce((sum, row) => sum + row.assessments.length, 0), selectedNinjaFiscalRows: oldTarget.assessments.length }, sourceHashes };
    console.log(JSON.stringify(output, null, 2));
    if (process.argv.includes('--write-report')) writeFileSync(path.join(root, 'docs/KOEKI_V2_PERFORMANCE.md'), report(output), 'utf8');
    await pg.query('ROLLBACK');
  } finally {
    await Promise.allSettled([pg.end(), prisma.$disconnect()]);
  }
}

function report(data) {
  const old = data.results.find((row) => row.key === 'shell_head'), next = data.results.find((row) => row.key === 'shell_v2');
  return `# Kōeki V2 — mesures de lectures PostgreSQL

Mesure effectuée le ${data.measuredAt}, sur les fixtures synthétiques locales \`${data.environment.host}:${data.environment.port}/${data.environment.database}\`, ${data.environment.postgres}, Node ${data.environment.node}. Référence inspectée : \`${data.baseline}\`. Le script ne modifie aucune donnée métier, configuration ou migration ; il n’exécute ni ANALYZE ni VACUUM.

## Méthode et portée

Le script exécute les formes de lectures Prisma inspectées dans les sources : navigation initiale, navigation V2, graphe fiscal d’un dossier, équipe, fiche agent et classement. Il capture le nombre réel de SELECT émis par Prisma, puis exécute les mêmes SELECT et paramètres avec \`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)\`. Les deux connexions sont en transaction **READ ONLY / REPEATABLE READ** et partagent un instantané PostgreSQL exporté : les volumes, lectures et plans portent sur le même état, même si un autre test écrit ensuite des fixtures. Les paramètres, noms, notes et secrets ne sont pas publiés dans le résultat.

Chaque groupe a une passe de chauffe puis **${data.iterations} répétitions**. La colonne Prisma mesure le temps médian des lectures équivalentes, sérialisation interne Prisma et aller-retours locaux compris. Les requêtes se trouvent dans une transaction dédiée, donc la concurrence du pool d’une requête HTTP réelle n’est pas reproduite. Les temps EXPLAIN sont les sommes des temps d’exécution PostgreSQL pour chaque groupe, hors planification, puis leur médiane. Les octets sont la taille JSON équivalente des objets reçus par le script, **pas une mesure des octets du protocole réseau ni du HTML**.

Il ne s’agit pas d’un benchmark des fonctions de service complètes : contrôle de session, calculs de présentation, cache React, sérialisation RSC, rendu navigateur et requêtes annexes du layout ne sont pas chronométrés. La fiche mesurée utilise une fenêtre glissante UTC de 90 jours ; le service prend minuit civil Paris à J−90. L’équipe est mesurée pour la semaine ISO complète, filtre effectivement accepté par le service, plutôt que son intervalle par défaut des sept derniers jours. Les résultats concernent cette petite base de fixtures, pas la production, une charge concurrente ou un volume représentatif.

Période : \`${data.calendar.key}\`, du ${data.calendar.start} inclus au ${data.calendar.endExclusive} exclu. Instant de référence : ${data.asOf}. Première page équipe : ${data.selectedPageAgents} agents (plafond 30).

## Volumes observés

| Table | Lignes |
|---|---:|
${Object.entries(data.counts).map(([table, count]) => `| ${table} | ${count} |`).join('\n')}

## Résultats reproductibles

| Lectures équivalentes | SELECT | Médiane Prisma (ms) | Somme EXPLAIN médiane (ms) | Lignes SQL retournées | JSON équivalent (octets) |
|---|---:|---:|---:|---:|---:|
${data.results.map((row) => `| ${row.label} | ${row.sqlQueries} | ${row.prismaWallMedianMs} | ${row.explainExecutionMedianMs} | ${row.rowsReturnedAcrossSql} | ${row.jsonEquivalentBytes} |`).join('\n')}

Les lignes SQL sont la somme des lignes à la racine des plans des SELECT : les lectures de relations sont comptées séparément, donc ce ne sont pas des lignes métier uniques.

## Changements structurels et invariants

- La navigation initiale chargeait tous les ninjas, leurs points, taxes, pénalités, allocations, paiements associés, ajustements, exonérations et toutes les identités pour un badge et le nom courant. La navigation V2 ne charge que le paramétrage RP et l’identité du compte. Dans cette mesure : **${old.sqlQueries} → ${next.sqlQueries} SELECT**, **${old.jsonEquivalentBytes} → ${next.jsonEquivalentBytes} octets JSON équivalents**. Le badge fiscal global a été retiré de la navigation ; sa lecture exacte reste dans les parcours économiques autorisés. Ce gain correspond à un travail supprimé de la navigation, pas à une égalité artificielle entre le compteur historique et la constante interne \`overdueCount: 0\` désormais non affichée.
- Le graphe fiscal d’une fiche peut maintenant être limité à son ID : **${data.invariants.allNinjaFiscalRows} lignes fiscales globales contre ${data.invariants.selectedNinjaFiscalRows} pour le dossier mesuré**. Les agrégats calculés depuis le graphe ciblé et depuis le graphe global sont strictement égaux pour ce dossier.
- Vérification indépendante SQL/BigInt des agrégats de référence sur les ninjas actifs : dette **${data.invariants.activeDebtRyo} Ryō**, **${data.invariants.activeOverdueCount} dossier(s) en retard** ; égalité **${data.invariants.result}**. Les statuts exclus, annulations après décès, pénalités, ajustements, exonérations et seuls paiements validés sont pris en compte. ${data.invariants.allNinjaFiscalRows === 0 ? '**Limite : aucun appel fiscal n’existe dans cette base de fixtures. Cette égalité à zéro ne prouve donc pas la conservation de montants non nuls ni la performance d’un historique fiscal rempli.** ' : ''}Les tests financiers couvrent séparément de grands BigInt et les contre-écritures, sans constituer un benchmark.
- L’équipe page 30 agents et agrège paiements/transactions sur leurs IDs et la période. La fiche agent borne les opérations à 90 jours/50 paiements/50 dons-rachats, 100 dossiers, 20 rapports, 30 tâches/notes/affectations et 12 périodes publiées. Le classement lit les contributions de sa semaine et les périodes concernées, sans lire le grand livre des points ninja.
- Ces bornes limitent les lignes renvoyées ; elles ne prouvent pas que chaque requête ne parcourt que ces lignes. La fiche lit encore des instantanés complets des 12 classements puis extrait l’agent ; les versions de la semaine du classement ne sont pas paginées. Les périodes de participation/avis peuvent aussi croître. Une optimisation de ces points devra être motivée par un volume représentatif.

## Plans et limites

| Groupe | Blocs partagés en cache (dernière passe) | Blocs lus (dernière passe) | Planification médiane (ms) |
|---|---:|---:|---:|
${data.results.map((row) => `| ${row.key} | ${row.sharedHits} | ${row.sharedReads} | ${row.explainPlanningMedianMs} |`).join('\n')}

Les index de première validation, participation et tâches sont présents via les migrations. PostgreSQL peut choisir des parcours séquentiels sur ces petites tables : ce choix n’est pas un défaut démontré et ces temps ne justifient pas à eux seuls de nouveaux index. Des index complémentaires par auteur/date et l’accès aux instantanés JSON devront être évalués à plus grande échelle. Le dashboard économique et le registre global utilisent encore des agrégats étendus ; aucune accélération de ces pages n’est revendiquée ici.

Empreintes SHA-256 abrégées des sources inspectées :

${Object.entries(data.sourceHashes).map(([file, hash]) => `- \`${file}\` : \`${hash}\``).join('\n')}

## Rejouer

PowerShell (commande utilisée ; URL strictement locale et jetable) :

\`\`\`powershell
$env:DATABASE_URL_TEST = 'postgresql://koeki:koeki-local-fixture@127.0.0.1:55432/koeki_v2_test'
$env:V2_PERF_NOW = '${data.asOf}'
$env:V2_PERF_ITERATIONS = '${data.iterations}'
node scripts/measure-v2-queries.cjs --write-report
\`\`\`

Sans \`--write-report\`, le script affiche seulement le JSON des mesures. L’URL est contrôlée avant connexion ; aucune commande destructive, seed ou migration n’est exécutée. La commande Unix équivalente (non exécutée dans cet environnement Windows) consiste à préfixer la même invocation Node avec ces trois variables d’environnement.
`;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });

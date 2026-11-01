// Real PostgreSQL upgrade test. Creates a fresh disposable database only;
// never connects to production and never drops or resets an existing database.
const { Client } = require('../packages/database/node_modules/pg');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

async function main() {
  if (!process.env.DATABASE_URL_TEST) throw new Error('DATABASE_URL_TEST must explicitly name a local disposable database');
  const url = new URL(process.env.DATABASE_URL_TEST);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !['5432', '55432'].includes(url.port)
    || !['koeki_v2_test', 'koeki_v2_integration_test', 'koeki_front_test_20261004', 'koeki_test', 'koeki_integration_test'].includes(url.pathname.slice(1))) {
    throw new Error('Only an explicitly allowlisted local fixture database on port 5432 or 55432 is supported');
  }
  const name = `koeki_receipt_backfill_${Date.now()}`;
  const adminUrl = new URL(url); adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try { await admin.query(`CREATE DATABASE "${name}"`); } finally { await admin.end(); }
  url.pathname = `/${name}`;
  const root = path.resolve(__dirname, '..');
  const migrationRoot = path.join(root, 'packages/database/prisma/migrations');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'koeki-receipt-backfill-'));
  fs.mkdirSync(path.join(stage, 'migrations'));
  const schema = path.join(stage, 'schema.prisma');
  fs.copyFileSync(path.join(root, 'packages/database/prisma/schema.prisma'), schema);
  const deploy = through => {
    for (const folder of fs.readdirSync(migrationRoot).filter(folder => /^\d{4}_/.test(folder) && Number(folder.slice(0, 4)) <= through)) {
      fs.cpSync(path.join(migrationRoot, folder), path.join(stage, 'migrations', folder), { recursive: true });
    }
    execFileSync(process.execPath, [path.join(root, 'packages/database/node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', schema], {
      env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe'
    });
  };
  deploy(16);
  const db = new Client({ connectionString: url.toString() });
  await db.connect();
  const stamp = new Date('2026-01-02T12:00:00.000Z');
  const auditStamp = new Date('2026-01-02T12:00:10.000Z');
  try {
    await db.query(`
      INSERT INTO "User" (id,name,"updatedAt") VALUES ('agent','Agent preuve',now()), ('other','Autre auteur',now());
      INSERT INTO "Role" (id,code,label) VALUES ('agent-role','ECONOMIC_AGENT','Agent');
      INSERT INTO "UserRole" ("userId","roleId") VALUES ('agent','agent-role');
      INSERT INTO "NinjaGrade" (id,code,label,"sortOrder") VALUES ('grade','BACKFILL','Fixture',99);
      INSERT INTO "NinjaProfile" (id,code,"firstName","lastName","currentGradeId","updatedAt")
        VALUES ('ninja','BACKFILL-1','Preuve','Historique','grade',now()), ('other-ninja','BACKFILL-2','Autre','Dossier','grade',now());
      INSERT INTO "PointLedgerEntry" (id,"ninjaId","eventType",points,"sourceType","sourceId") VALUES ('points','ninja','TAX_PAYMENT',17,'Fixture','preserve');
      INSERT INTO "ExemptionLedgerEntry" (id,"ninjaId",amount,"sourceType","sourceId") VALUES ('credit','ninja',777,'Fixture','preserve');
    `);
    const donation = async (id, options = {}) => {
      await db.query(`INSERT INTO "ResourceTransaction" (id,"receiptNumber",type,status,"ninjaId","agentId","totalAmount","idempotencyKey","validatedAt","createdAt")
        VALUES ($1,$2,'DONATION',$3,$4,$5,9007199254740993,$6,$7,$8)`,
      [id, `DON-${id}`, options.status ?? 'VALIDATED', options.ninja ?? 'ninja', options.agent ?? 'agent', options.key ?? `${id}:don`, options.unknownDate ? null : stamp, stamp]);
    };
    const payment = async (id, options = {}) => {
      await db.query(`INSERT INTO "TaxPayment" (id,"receiptNumber","ninjaId","recordedById",amount,method,status,"balanceBefore","balanceAfter","idempotencyKey","validatedAt","createdAt")
        VALUES ($1,$2,$3,'agent',9007199254740993,'RYO','VALIDATED',9007199254740993,0,$4,$5,$5)`,
      [id, `PAY-${id}`, options.ninja ?? 'ninja', options.key ?? id, stamp]);
    };
    const audit = async (id, entityType, entityId, options = {}) => {
      await db.query(`INSERT INTO "AuditLog" (id,"actorId",action,"entityType","entityId","newValues","requestId","createdAt")
        VALUES ($1,$2,$3,$4,$5,$6,$1,$7)`,
      [id, options.actor ?? 'agent', options.action ?? 'PAYMENT_RECORDED', entityType, entityId, JSON.stringify(options.values ?? {}), options.at ?? auditStamp]);
    };
    const directIds = ['direct', 'no-audit', 'unknown-date', 'stale', 'ambiguous', 'wrong-handler', 'contrary-author', 'reversed', 'imported'];
    for (const id of directIds) await donation(id, {
      unknownDate: id === 'unknown-date', status: id === 'reversed' ? 'REVERSED' : 'VALIDATED',
      ...(id === 'imported' ? { key: 'imp-imported:don' } : {})
    });
    for (const id of directIds.filter(id => id !== 'no-audit')) await audit(`a-${id}`, 'ResourceTransaction', `DON-${id}`, {
      ...(id === 'stale' ? { at: new Date(+stamp + 60000) } : {}),
      ...(id === 'wrong-handler' ? { actor: 'other' } : {})
    });
    await audit('a-ambiguous-other', 'ResourceTransaction', 'DON-ambiguous', { actor: 'other' });
    await audit('a-contrary', 'ResourceTransaction', 'DON-contrary-author', { actor: 'other', action: 'DONATION_DECLARED' });
    for (const id of ['mixed', 'wrong-ninja', 'wrong-key']) {
      await donation(id, { ...(id === 'wrong-key' ? { key: 'unrelated:don' } : {}) });
      await payment(`p-${id}`, { key: id, ...(id === 'wrong-ninja' ? { ninja: 'other-ninja' } : {}) });
      await audit(`a-${id}`, 'TaxPayment', `PAY-p-${id}`, { values: { receipts: [`PAY-p-${id}`, `DON-${id}`] } });
    }
    deploy(20);
    // Prove the old migration misses both known settlement audit formats.
    const missed = await db.query(`SELECT id,"operationOrigin","recordedById","firstValidatedAt" FROM "ResourceTransaction" WHERE id IN ('direct','mixed') ORDER BY id`);
    assert(missed.rows.every(row => row.operationOrigin === 'UNKNOWN' && row.recordedById === null && row.firstValidatedAt === null));
    const observed = (await db.query(`SELECT "startsAt","observedAt","dateSource" FROM "AgentParticipation" WHERE "userId"='agent'`)).rows[0];
    assert.equal(observed.startsAt, null);
    assert.equal(observed.dateSource, 'OBSERVED');
    // Old writers can still produce UNKNOWN rows during a rolling deployment.
    for (const id of ['late-payment', 'ambiguous-payment', 'wrong-author-payment']) {
      await payment(id);
      await audit(`a-${id}`, 'TaxPayment', `PAY-${id}`, { ...(id === 'wrong-author-payment' ? { actor: 'other' } : {}) });
    }
    await audit('a-ambiguous-payment-other', 'TaxPayment', 'PAY-ambiguous-payment', { actor: 'other' });
    await donation('late-import-key', { key: 'kv-late:don' });
    await audit('a-late-import-key', 'ResourceTransaction', 'DON-late-import-key');
    await donation('certified');
    await db.query(`UPDATE "ResourceTransaction" SET "operationOrigin"='BUSINESS',"recordedById"='agent' WHERE id='certified'`);
    const certified = (await db.query(`SELECT "firstValidatedAt","validationEvidence","recordedById","operationOrigin" FROM "ResourceTransaction" WHERE id='certified'`)).rows[0];
    assert.equal(certified.validationEvidence, 'SERVER');
    await db.query(`INSERT INTO "RankingPeriod" (id,"weekKey","startsAt","endsAt") VALUES ('period','2026-W01','2025-12-28T23:00:00Z','2026-01-04T23:00:00Z');
      INSERT INTO "RankingVersion" (id,"periodId",version,"formulaVersion",snapshot,fingerprint) VALUES ('version','period',1,'fixture','{"immutable":true}','fixture');`);
    const financialSnapshot = async () => {
      const data = {};
      for (const [key, sql] of Object.entries({
        payments: 'SELECT id,"receiptNumber","ninjaId","recordedById",amount::text,status,"balanceBefore"::text,"balanceAfter"::text,"validatedAt","createdAt","idempotencyKey" FROM "TaxPayment" ORDER BY id',
        donations: 'SELECT id,"receiptNumber","ninjaId","agentId","totalAmount"::text,status,"validatedAt","createdAt","idempotencyKey" FROM "ResourceTransaction" ORDER BY id',
        points: 'SELECT * FROM "PointLedgerEntry" ORDER BY id', credit: 'SELECT * FROM "ExemptionLedgerEntry" ORDER BY id',
        participation: 'SELECT * FROM "AgentParticipation" ORDER BY id', snapshots: 'SELECT * FROM "RankingVersion" ORDER BY id'
      })) data[key] = (await db.query(sql)).rows;
      return data;
    };
    const before = await financialSnapshot();
    deploy(21);
    assert.deepEqual(await financialSnapshot(), before, 'Financial data, participation and published snapshots stay byte-for-byte equivalent');
    for (const id of ['direct', 'mixed', 'reversed']) {
      const row = (await db.query(`SELECT "recordedById","firstValidatedAt","validationEvidence","operationOrigin" FROM "ResourceTransaction" WHERE id=$1`, [id])).rows[0];
      assert.deepEqual(row, { recordedById: 'agent', firstValidatedAt: stamp, validationEvidence: 'AUDIT_BACKFILL', operationOrigin: 'BUSINESS' }, id);
    }
    const repairedPayment = (await db.query(`SELECT "firstValidatedAt","validationEvidence","operationOrigin" FROM "TaxPayment" WHERE id='late-payment'`)).rows[0];
    assert.deepEqual(repairedPayment, { firstValidatedAt: stamp, validationEvidence: 'AUDIT_BACKFILL', operationOrigin: 'BUSINESS' });
    const rejected = ['no-audit', 'unknown-date', 'stale', 'ambiguous', 'wrong-handler', 'contrary-author', 'wrong-ninja', 'wrong-key', 'late-import-key'];
    for (const id of rejected) {
      const row = (await db.query(`SELECT "recordedById","firstValidatedAt","operationOrigin" FROM "ResourceTransaction" WHERE id=$1`, [id])).rows[0];
      assert.deepEqual(row, { recordedById: null, firstValidatedAt: null, operationOrigin: 'UNKNOWN' }, id);
    }
    for (const id of ['ambiguous-payment', 'wrong-author-payment']) {
      const row = (await db.query(`SELECT "firstValidatedAt","operationOrigin" FROM "TaxPayment" WHERE id=$1`, [id])).rows[0];
      assert.deepEqual(row, { firstValidatedAt: null, operationOrigin: 'UNKNOWN' }, id);
    }
    assert.equal((await db.query(`SELECT "operationOrigin" FROM "ResourceTransaction" WHERE id='imported'`)).rows[0].operationOrigin, 'IMPORT');
    assert.deepEqual((await db.query(`SELECT "firstValidatedAt","validationEvidence","recordedById","operationOrigin" FROM "ResourceTransaction" WHERE id='certified'`)).rows[0], certified);
    assert.equal((await db.query(`SELECT "correctionNeeded" FROM "RankingPeriod" WHERE id='period'`)).rows[0].correctionNeeded, true);
    const evidence = async () => (await db.query(`SELECT id,"firstValidatedAt","validationEvidence","operationOrigin","recordedById" FROM "ResourceTransaction" ORDER BY id`)).rows;
    const once = await evidence();
    await db.query(fs.readFileSync(path.join(migrationRoot, '0021_receipt_audit_backfill/migration.sql'), 'utf8'));
    assert.deepEqual(await evidence(), once, 'Direct SQL replay is idempotent');
    assert.deepEqual(await financialSnapshot(), before);
    await assert.rejects(db.query(`UPDATE "ResourceTransaction" SET "recordedById"='other' WHERE id='direct'`), /immutable/);
    await assert.rejects(db.query(`UPDATE "TaxPayment" SET "firstValidatedAt"=now() WHERE id='late-payment'`), /immutable/);
    const triggerStates = (await db.query(`SELECT tgenabled FROM pg_trigger WHERE tgname IN ('TaxPayment_ranking_evidence','ResourceTransaction_ranking_evidence')`)).rows;
    assert.equal(triggerStates.length, 2); assert(triggerStates.every(row => row.tgenabled === 'O'));
    await donation('new-after');
    await db.query(`UPDATE "ResourceTransaction" SET "operationOrigin"='BUSINESS',"recordedById"='agent' WHERE id='new-after'`);
    const fresh = (await db.query(`SELECT "firstValidatedAt","validationEvidence" FROM "ResourceTransaction" WHERE id='new-after'`)).rows[0];
    assert.equal(fresh.validationEvidence, 'SERVER'); assert(fresh.firstValidatedAt > stamp);
    console.log(JSON.stringify({ result: 'PASS', host: url.hostname, port: url.port, database: name,
      repairedDonations: 3, repairedRollingPayment: 1, rejectedAmbiguousOrUnproven: rejected.length + 2,
      preserved: ['exact BigInt amounts', 'financial dates and status', 'handler identity', 'points and credits', 'participation dates', 'published snapshots'],
      triggersRestored: true, replay: 'PASS' }, null, 2));
  } finally { await db.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

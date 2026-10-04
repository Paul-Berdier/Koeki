// Verifies an additive upgrade from the actual old migrations with preserved data.
// Creates its own local database; never drops an existing database.
const { Client } = require('../packages/database/node_modules/pg');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
async function main() {
  const url = new URL(process.env.DATABASE_URL_TEST || 'postgresql://koeki:koeki-local-fixture@127.0.0.1:55432/koeki_v2_test');
  if (!['127.0.0.1','localhost'].includes(url.hostname) || !['koeki_v2_test','koeki_test'].includes(url.pathname.slice(1))) throw new Error('Explicit local disposable test database required');
  const name = `koeki_v2_upgrade_${Date.now()}`;
  const adminUrl = new URL(url); adminUrl.pathname='/postgres';
  const admin = new Client({connectionString: adminUrl.toString()}); await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`); await admin.end(); url.pathname=`/${name}`;
  const root = path.resolve(__dirname,'..');
  const oldDir = fs.mkdtempSync(path.join(os.tmpdir(),'koeki-upgrade-'));
  fs.mkdirSync(path.join(oldDir,'migrations'));
  fs.copyFileSync(path.join(root,'packages/database/prisma/schema.prisma'),path.join(oldDir,'schema.prisma'));
  const migrations = path.join(root,'packages/database/prisma/migrations');
  for (const folder of fs.readdirSync(migrations).filter(s=>/^00(0[1-9]|1[0-6])_/.test(s))) fs.cpSync(path.join(migrations,folder),path.join(oldDir,'migrations',folder),{recursive:true});
  const cli = path.join(root,'packages/database/node_modules/prisma/build/index.js');
  const migrate = schema => execFileSync(process.execPath,[cli,'migrate','deploy','--schema',schema],{env:{...process.env,DATABASE_URL:url.toString()},stdio:'pipe'});
  migrate(path.join(oldDir,'schema.prisma'));
  const client = new Client({connectionString:url.toString()}); await client.connect();
  await client.query(`
    INSERT INTO "User" (id,name,"updatedAt") VALUES ('upgrade-agent','Agent historique',now());
    INSERT INTO "Role" (id,code,label) VALUES ('upgrade-role','ECONOMIC_AGENT','Agent');
    INSERT INTO "UserRole" ("userId","roleId") VALUES ('upgrade-agent','upgrade-role');
    INSERT INTO "NinjaGrade" (id,code,label,"sortOrder") VALUES ('upgrade-grade','UPGRADE','Test',99);
    INSERT INTO "NinjaProfile" (id,code,"firstName","lastName","currentGradeId","referenceAgentId","updatedAt") VALUES ('upgrade-ninja','UPGRADE-1','Identité','Conservée','upgrade-grade','upgrade-agent',now());
    INSERT INTO "TaxPayment" (id,"receiptNumber","ninjaId","recordedById",amount,method,status,"balanceBefore","balanceAfter","idempotencyKey","validatedAt") VALUES ('upgrade-payment','UPGRADE-PAY','upgrade-ninja','upgrade-agent',9007199254740993,'RYO','VALIDATED',9007199254740993,0,'upgrade-key','2026-01-02T12:00:00Z');
    INSERT INTO "PointLedgerEntry" (id,"ninjaId","eventType",points,"sourceType","sourceId") VALUES ('upgrade-points','upgrade-ninja','TAX_PAYMENT',17,'TaxPayment','upgrade-payment');
    INSERT INTO "ExemptionLedgerEntry" (id,"ninjaId",amount,"sourceType","sourceId") VALUES ('upgrade-credit','upgrade-ninja',777,'Upgrade','credit');
    INSERT INTO "AgentReport" (id,"authorId","periodStart","periodEnd",summary,status,"collectedAmount") VALUES ('upgrade-report','upgrade-agent','2026-01-01','2026-01-02','Rapport historique à préserver','APPROVED',9007199254740993);
  `);
  const snapshot = async()=>{
    const data={};
    for(const [label,sql] of Object.entries({payment:'SELECT id,amount::text,"ninjaId","recordedById","validatedAt" FROM "TaxPayment"',points:'SELECT id,points,"sourceId" FROM "PointLedgerEntry"',credit:'SELECT id,amount::text FROM "ExemptionLedgerEntry"',profile:'SELECT id,code,"referenceAgentId" FROM "NinjaProfile"',report:'SELECT id,summary,status,"collectedAmount"::text FROM "AgentReport"'})) data[label]=(await client.query(sql)).rows;
    return data;
  };
  const before=await snapshot();
  migrate(path.join(root,'packages/database/prisma/schema.prisma'));
  assert.deepEqual(await snapshot(),before);
  const p=(await client.query('SELECT "startsAt","dateSource" FROM "AgentParticipation" WHERE "userId"=$1',['upgrade-agent'])).rows[0];
  assert.equal(p.startsAt,null); assert.equal(p.dateSource,'OBSERVED');
  const report=(await client.query('SELECT "submittedAt","decidedAt",version FROM "AgentReport" WHERE id=$1',['upgrade-report'])).rows[0];
  assert.equal(report.submittedAt,null); assert.equal(report.decidedAt,null); assert.equal(report.version,1);
  migrate(path.join(root,'packages/database/prisma/schema.prisma')); // replay must be harmless
  assert.deepEqual(await snapshot(),before);
  console.log(JSON.stringify({result:'PASS',host:url.hostname,database:name,preserved:['exact BigInt payment','author','ninja','points','exemption credit','approved report'],historicalDates:'unknown retained',replay:'PASS'},null,2));
  await client.end();
}
main().catch(e=>{console.error(e);process.exitCode=1});

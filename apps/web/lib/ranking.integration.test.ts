import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { calculateRanking, prisma, publishRanking } from "@koeki/database";
import { rankingWeekAt, type RankingSnapshot } from "@koeki/domain";
import { createTestNinja, createTestResource, createTestUser, ensureReferential } from "./test-fixtures";
import { recordMovement, reverseMovement } from "./inventory-ledger";

describe.skipIf(!inject("dbReady"))("weekly rankings (PostgreSQL)", () => {
  let agent: { id: string }, approver: { id: string }, ninja: { id: string }, zero: { id: string };
  let ref: Awaited<ReturnType<typeof ensureReferential>>;
  const week = rankingWeekAt(new Date());
  let paymentId: string, donationId: string;
  beforeAll(async () => {
    ref = await ensureReferential();
    [agent, approver, zero] = await Promise.all([createTestUser("Classement Agent"), createTestUser("Classement Responsable"), createTestUser("Classement Sans Opération")]);
    const role = await prisma.role.upsert({ where: { code: "KOEKI_MANAGER" }, create: { code: "KOEKI_MANAGER", label: "Responsable" }, update: {} });
    await prisma.userRole.create({ data: { userId: approver.id, roleId: role.id } });
    await prisma.agentParticipation.createMany({ data: [agent, zero].map((user) => ({ userId: user.id, startsAt: week.startsAt, observedAt: week.startsAt, rankingEligible: true })) });
    ninja = await createTestNinja(ref.grade.id);
  });
  afterAll(async () => { await prisma.$disconnect(); });
  it("stamps first validation in PostgreSQL and preserves the original author across approval", async () => {
    const pending = await prisma.resourceTransaction.create({ data: { receiptNumber: `BUY-RANK-${randomUUID()}`, type: "BUYBACK", status: "PENDING_APPROVAL", ninjaId: ninja.id, agentId: agent.id, recordedById: agent.id, totalAmount: 50n, idempotencyKey: randomUUID(), operationOrigin: "BUSINESS" } });
    expect(pending.firstValidatedAt).toBeNull();
    const validated = await prisma.resourceTransaction.update({ where: { id: pending.id }, data: { status: "VALIDATED", validatedAt: new Date() } });
    expect(validated.firstValidatedAt).toBeInstanceOf(Date);
    expect(validated.validationEvidence).toBe("SERVER");
    expect(validated.recordedById).toBe(agent.id);
    await expect(prisma.resourceTransaction.update({ where: { id: pending.id }, data: { recordedById: approver.id } })).rejects.toThrow(/immutable/);
    await expect(prisma.resourceTransaction.update({ where: { id: pending.id }, data: { firstValidatedAt: new Date("2000-01-01") } })).rejects.toThrow(/immutable/);
  });
  it("counts business identities once, excludes imports and technical admins, and keeps zero agents", async () => {
    const payment = await prisma.taxPayment.create({ data: { receiptNumber: `PAY-RANK-${randomUUID()}`, ninjaId: ninja.id, recordedById: agent.id, amount: 9007199254740993n, method: "TEST", status: "VALIDATED", balanceBefore: 9007199254740993n, balanceAfter: 0n, idempotencyKey: randomUUID(), validatedAt: new Date(), operationOrigin: "BUSINESS" } });
    paymentId = payment.id;
    const donation = await prisma.resourceTransaction.create({ data: { receiptNumber: `DON-RANK-${randomUUID()}`, type: "DONATION", status: "VALIDATED", ninjaId: ninja.id, agentId: agent.id, recordedById: agent.id, totalAmount: 75n, idempotencyKey: randomUUID(), operationOrigin: "BUSINESS" } });
    donationId = donation.id;
    await prisma.resourceTransaction.create({ data: { receiptNumber: `IMPORT-RANK-${randomUUID()}`, type: "DONATION", status: "VALIDATED", ninjaId: ninja.id, agentId: agent.id, recordedById: agent.id, totalAmount: 99n, idempotencyKey: randomUUID(), operationOrigin: "IMPORT", validatedAt: new Date() } });
    await prisma.resourceTransaction.create({ data: { receiptNumber: `ADMIN-RANK-${randomUUID()}`, type: "DONATION", status: "VALIDATED", ninjaId: ninja.id, agentId: approver.id, recordedById: approver.id, totalAmount: 99n, idempotencyKey: randomUUID(), operationOrigin: "BUSINESS" } });
    const snapshot = await prisma.$transaction((tx) => calculateRanking(tx, week));
    expect(snapshot.rows.find((r) => r.userId === agent.id)).toMatchObject({ operations: 3, payments: 1, donations: 1, buybacks: 1, collected: "9007199254740993" });
    expect(snapshot.rows.find((r) => r.userId === zero.id)?.operations).toBe(0);
    expect(snapshot.rows.some((r) => r.userId === approver.id)).toBe(false);
    expect(snapshot.contributions.filter((r) => r.id === payment.id)).toHaveLength(1);
  });
  it("excludes a donation whose automatic stock line was reversed without rewarding the correction", async () => {
    const resource = await createTestResource({ categoryId: ref.category.id, unitId: ref.unite.id });
    const movement = await prisma.$transaction((tx) => recordMovement(tx, { resourceId: resource.id, type: "DONATION_IN", quantity: 3, agentId: agent.id, transactionId: donationId, reason: "Fixture classement", idempotencyKey: randomUUID() }));
    await prisma.$transaction((tx) => reverseMovement(tx, { movementId: movement.id, agentId: approver.id, reason: "Correction de fixture", idempotencyKey: randomUUID() }));
    const snapshot = await prisma.$transaction((tx) => calculateRanking(tx, week));
    expect(snapshot.rows.find((r) => r.userId === agent.id)?.operations).toBe(2);
    expect(snapshot.contributions.some((r) => r.id === donationId)).toBe(false);
  });
  it("refuses an open week and unauthorized closure actors", async () => {
    await expect(publishRanking(prisma, { weekKey: week.key, actorId: approver.id })).rejects.toThrow(/ouverte/);
    await expect(publishRanking(prisma, { weekKey: week.key, actorId: agent.id, now: week.endsAt })).rejects.toThrow("FORBIDDEN");
  });
  it("serializes concurrent closure, keeps immutable versions and publishes late reversal as a motivated correction", async () => {
    // Only this isolated integration database uses a future trusted worker clock.
    const existing = await prisma.rankingPeriod.findUnique({ where: { weekKey: week.key }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
    const latest = existing?.versions[0];
    if (latest) await publishRanking(prisma, { weekKey: week.key, actorId: approver.id, now: week.endsAt, correctionReason: "Nouvelle exécution de fixtures isolées", expectedVersion: latest.version });
    const [first, repeat] = await Promise.all([publishRanking(prisma, { weekKey: week.key, now: week.endsAt }), publishRanking(prisma, { weekKey: week.key, now: week.endsAt })]);
    expect(first.id).toBe(repeat.id);
    const original = await prisma.rankingVersion.findUniqueOrThrow({ where: { id: first.id } });
    const before = original.snapshot as unknown as RankingSnapshot;
    expect(before.rows.find((r) => r.userId === agent.id)?.payments).toBe(1);
    await expect(prisma.rankingVersion.update({ where: { id: first.id }, data: { reason: "Mutation interdite" } })).rejects.toThrow(/immutable/);
    await prisma.taxPayment.update({ where: { id: paymentId }, data: { status: "REVERSED" } });
    const check = await publishRanking(prisma, { weekKey: week.key, now: week.endsAt });
    expect(check).toMatchObject({ created: false, correctionNeeded: true });
    await expect(publishRanking(prisma, { weekKey: week.key, actorId: approver.id, now: week.endsAt, correctionReason: "court", expectedVersion: first.version })).rejects.toThrow(/motif/);
    const corrected = await publishRanking(prisma, { weekKey: week.key, actorId: approver.id, now: week.endsAt, correctionReason: "Paiement inversé après publication", expectedVersion: first.version });
    expect(corrected.version).toBe(first.version + 1);
    expect((await prisma.rankingVersion.findUniqueOrThrow({ where: { id: first.id } })).snapshot).toEqual(original.snapshot);
    const after = (await prisma.rankingVersion.findUniqueOrThrow({ where: { id: corrected.id } })).snapshot as unknown as RankingSnapshot;
    expect(after.rows.find((r) => r.userId === agent.id)?.payments).toBe(0);
    const replay = await publishRanking(prisma, { weekKey: week.key, actorId: approver.id, now: week.endsAt, correctionReason: "Paiement inversé après publication", expectedVersion: first.version });
    expect(replay.id).toBe(corrected.id);
    const buyback = after.contributions.find((source) => source.kind === "BUYBACK" && source.authorId === agent.id)!;
    await prisma.resourceTransaction.update({ where: { id: buyback.id }, data: { status: "REVERSED" } });
    await expect(publishRanking(prisma, { weekKey: week.key, actorId: approver.id, now: week.endsAt, correctionReason: "Autre correction mais version obsolète", expectedVersion: first.version })).rejects.toThrow(/changé/);
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { prisma, type PaymentStatus, type RoleCode } from "@koeki/database";
import {
  getAgentAnalytics,
  getTeamAnalytics,
  resolveTeamPeriod,
} from "./team-analytics";
import type { SessionInfo } from "./session";
import {
  createTestNinja,
  createTestResource,
  createTestUser,
  ensureReferential,
} from "./test-fixtures";
import { recordMovement, reverseMovement } from "./inventory-ledger";

describe("team analytics civil periods and access boundary", () => {
  it("uses thirty inclusive Paris days by default and permits exactly 366 days", () => {
    const period = resolveTeamPeriod({}, new Date("2026-10-04T22:30:00Z"));
    expect(period).toMatchObject({
      from: "2026-09-06",
      to: "2026-10-05",
      days: 30,
    });
    expect(
      resolveTeamPeriod({ from: "2024-01-01", to: "2024-12-31" }).days,
    ).toBe(366);
    expect(() =>
      resolveTeamPeriod({ from: "2024-01-01", to: "2025-01-01" }),
    ).toThrow(/366/);
  });
  it("keeps spring and autumn DST boundaries and rejects impossible or reversed dates", () => {
    const spring = resolveTeamPeriod({ from: "2026-03-29", to: "2026-03-29" });
    expect(spring.startsAt.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(spring.endsAtExclusive.toISOString()).toBe(
      "2026-03-29T22:00:00.000Z",
    );
    expect(spring.endsAtExclusive.getTime() - spring.startsAt.getTime()).toBe(
      23 * 3600000,
    );
    const autumn = resolveTeamPeriod({ from: "2026-10-25", to: "2026-10-25" });
    expect(autumn.endsAtExclusive.getTime() - autumn.startsAt.getTime()).toBe(
      25 * 3600000,
    );
    expect(() => resolveTeamPeriod({ from: "2026-02-30" })).toThrow(
      /Date invalide/,
    );
    expect(() =>
      resolveTeamPeriod({ from: "2026-10-05", to: "2026-10-04" }),
    ).toThrow(/période/);
  });
  it("refuses agents and auditors before issuing a database query, even for their own ID", async () => {
    const originalTransaction = prisma.$transaction;
    const transaction = vi.spyOn(prisma, "$transaction");
    try {
      for (const role of ["ECONOMIC_AGENT", "AUDITOR", "NINJA"] as const) {
        const session: SessionInfo = {
          userId: "not-looked-up",
          name: "Fixture",
          roles: [role],
        };
        await expect(getTeamAnalytics(session)).rejects.toThrow("FORBIDDEN");
        await expect(
          getAgentAnalytics(session, session.userId),
        ).rejects.toThrow("FORBIDDEN");
      }
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      transaction.mockRestore();
      prisma.$transaction = originalTransaction;
    }
  });
});

describe.skipIf(!inject("dbReady"))(
  "team analytics PostgreSQL aggregates",
  () => {
    const filters = { from: "2026-03-28", to: "2026-03-30" };
    const inPeriod = new Date("2026-03-29T09:00:00Z");
    const hugeAmount = 9007199254740993n;
    let manager: { id: string },
      agent: { id: string },
      idle: { id: string },
      former: { id: string },
      disabled: { id: string },
      technical: { id: string },
      ninja: { id: string };
    const managerSession = (): SessionInfo => ({
      userId: manager.id,
      name: "Responsable",
      roles: ["KOEKI_MANAGER"],
    });

    async function createUserWithRoles(name: string, codes: RoleCode[]) {
      const user = await createTestUser(name);
      for (const code of codes) {
        const role = await prisma.role.upsert({
          where: { code },
          create: { code, label: code },
          update: {},
        });
        await prisma.userRole.create({
          data: { userId: user.id, roleId: role.id },
        });
      }
      return user;
    }
    async function payment(
      validatedAt: Date | null,
      amount: bigint,
      status: PaymentStatus = "VALIDATED",
      origin = "BUSINESS",
    ) {
      return prisma.taxPayment.create({
        data: {
          receiptNumber: `ANALYTICS-${randomUUID()}`,
          ninjaId: ninja.id,
          recordedById: agent.id,
          amount,
          method: "FIXTURE",
          status,
          balanceBefore: amount,
          balanceAfter: 0n,
          idempotencyKey: randomUUID(),
          validatedAt,
          operationOrigin: origin,
          createdAt: inPeriod,
        },
      });
    }
    beforeAll(async () => {
      const ref = await ensureReferential();
      [manager, agent, idle, former, disabled, technical] = await Promise.all([
        createUserWithRoles("Analytique responsable", ["KOEKI_MANAGER"]),
        createUserWithRoles("Analytique auteur", ["ECONOMIC_AGENT"]),
        createUserWithRoles("Analytique sans opération", ["ECONOMIC_AGENT"]),
        createUserWithRoles("Analytique ancien agent", ["NINJA"]),
        createUserWithRoles("Analytique désactivé", ["ECONOMIC_AGENT"]),
        createUserWithRoles("Analytique super technique", ["SUPER_ADMIN"]),
      ]);
      ninja = await createTestNinja(ref.grade.id);
      await prisma.ninjaProfile.update({
        where: { id: ninja.id },
        data: { referenceAgentId: agent.id },
      });
      await prisma.user.update({
        where: { id: disabled.id },
        data: { revokedAt: new Date() },
      });
      await prisma.agentParticipation.createMany({
        data: [
          {
            userId: agent.id,
            startsAt: new Date("2026-01-01"),
            serviceRole: "ECONOMIC_AGENT",
          },
          {
            userId: idle.id,
            startsAt: null,
            dateSource: "OBSERVED",
            serviceRole: "ECONOMIC_AGENT",
          },
          {
            userId: former.id,
            startsAt: new Date("2026-01-01"),
            endsAt: new Date("2026-02-01"),
            serviceRole: "ECONOMIC_AGENT",
          },
          {
            userId: disabled.id,
            startsAt: new Date("2026-01-01"),
            endsAt: new Date(),
            serviceRole: "ECONOMIC_AGENT",
          },
        ],
      });
      await prisma.agentAbsence.createMany({
        data: [
          {
            userId: agent.id,
            startsAt: new Date(Date.now() - 86400000),
            endsAt: new Date(Date.now() + 86400000),
            reason: "Motif confidentiel actuel",
            createdById: manager.id,
          },
          {
            userId: agent.id,
            startsAt: new Date("2026-03-29T00:00:00Z"),
            endsAt: new Date("2026-03-30T00:00:00Z"),
            reason: "Motif confidentiel historique",
            createdById: manager.id,
          },
        ],
      });
      await prisma.agentNote.create({
        data: {
          userId: agent.id,
          authorId: manager.id,
          body: "NE PAS SÉRIALISER NOTE ENCADREMENT",
        },
      });
      await payment(new Date("2026-03-27T23:00:00Z"), hugeAmount);
      await payment(new Date("2026-03-28T23:00:00Z"), 7n);
      await payment(new Date("2026-03-29T22:30:00Z"), 3n);
      await payment(new Date("2026-03-30T22:00:00Z"), 1000n); // Next Paris day: excluded.
      await payment(inPeriod, 900n, "VALIDATED", "IMPORT");
      await payment(inPeriod, 800n, "PENDING");
      await payment(inPeriod, 700n, "REVERSED");
      await payment(null, 600n);
      const resourceData = {
        ninjaId: ninja.id,
        agentId: manager.id,
        recordedById: agent.id,
        totalAmount: 400n,
        status: "VALIDATED" as const,
        operationOrigin: "BUSINESS",
        validatedAt: inPeriod,
        createdAt: inPeriod,
      };
      await prisma.resourceTransaction.create({
        data: {
          ...resourceData,
          type: "DONATION",
          receiptNumber: `ANALYTICS-DON-${randomUUID()}`,
          idempotencyKey: randomUUID(),
        },
      });
      await prisma.resourceTransaction.create({
        data: {
          ...resourceData,
          type: "BUYBACK",
          receiptNumber: `ANALYTICS-BUY-${randomUUID()}`,
          idempotencyKey: randomUUID(),
        },
      });
      await prisma.resourceTransaction.create({
        data: {
          ...resourceData,
          operationOrigin: "IMPORT",
          type: "DONATION",
          receiptNumber: `ANALYTICS-IMPORT-${randomUUID()}`,
          idempotencyKey: randomUUID(),
        },
      });
      const reversed = await prisma.resourceTransaction.create({
        data: {
          ...resourceData,
          type: "DONATION",
          receiptNumber: `ANALYTICS-REV-${randomUUID()}`,
          idempotencyKey: randomUUID(),
        },
      });
      const resource = await createTestResource({
        categoryId: ref.category.id,
        unitId: ref.unite.id,
      });
      const movement = await prisma.$transaction((tx) =>
        recordMovement(tx, {
          resourceId: resource.id,
          type: "DONATION_IN",
          quantity: 2,
          agentId: agent.id,
          transactionId: reversed.id,
          reason: "Fixture analytique",
          idempotencyKey: randomUUID(),
        }),
      );
      await prisma.$transaction((tx) =>
        reverseMovement(tx, {
          movementId: movement.id,
          agentId: manager.id,
          reason: "Annulation fixture analytique",
          idempotencyKey: randomUUID(),
        }),
      );
      await prisma.followUpTask.createMany({
        data: [
          {
            title: "Analytique retard",
            description: "Fixture",
            createdById: manager.id,
            assigneeId: agent.id,
            status: "TODO",
            dueAt: new Date(Date.now() - 86400000),
          },
          {
            title: "Analytique blocage",
            description: "Fixture",
            createdById: manager.id,
            assigneeId: agent.id,
            status: "BLOCKED",
            dueAt: new Date(Date.now() + 86400000),
          },
          {
            title: "Analytique ancienne fin inconnue",
            description: "Fixture",
            createdById: manager.id,
            assigneeId: agent.id,
            status: "DONE",
          },
          {
            title: "Analytique à attribuer",
            description: "Fixture",
            createdById: manager.id,
            assigneeId: null,
            status: "TODO",
          },
        ],
      });
      await prisma.followUpTask.create({
        data: {
          title: "Analytique tâche terminée",
          description: "Fixture",
          createdById: manager.id,
          assigneeId: agent.id,
          status: "DONE",
          transitions: {
            create: [
              {
                actorId: agent.id,
                fromStatus: "TODO",
                toStatus: "DONE",
                createdAt: inPeriod,
              },
              {
                actorId: manager.id,
                fromStatus: "DONE",
                toStatus: "TODO",
                createdAt: inPeriod,
              },
              {
                actorId: agent.id,
                fromStatus: "TODO",
                toStatus: "DONE",
                createdAt: inPeriod,
              },
            ],
          },
        },
      });
      await prisma.agentReport.createMany({
        data: [
          {
            authorId: agent.id,
            periodStart: new Date("2026-03-01"),
            periodEnd: new Date("2026-03-07"),
            summary: "Rapport reçu",
            status: "SUBMITTED",
            submittedAt: inPeriod,
          },
          {
            authorId: agent.id,
            periodStart: new Date("2026-03-08"),
            periodEnd: new Date("2026-03-14"),
            summary: "Rapport approuvé",
            status: "APPROVED",
            submittedAt: inPeriod,
            decidedAt: inPeriod,
          },
          {
            authorId: agent.id,
            periodStart: new Date("2026-03-15"),
            periodEnd: new Date("2026-03-21"),
            summary: "BROUILLON PRIVÉ À NE PAS SÉRIALISER",
            status: "DRAFT",
          },
          {
            authorId: agent.id,
            periodStart: new Date("2026-01-01"),
            periodEnd: new Date("2026-01-07"),
            summary: "Ancien rapport en attente",
            status: "SUBMITTED",
            submittedAt: new Date("2026-01-08"),
          },
        ],
      });
    });
    afterAll(async () => {
      await prisma.$disconnect();
    });

    it("counts validated business identities on Paris dates, attributes the recorder, and keeps money exact", async () => {
      const analytics = await getAgentAnalytics(
        managerSession(),
        agent.id,
        filters,
      );
      expect(analytics).not.toBeNull();
      expect(analytics!.agents).toHaveLength(1);
      expect(analytics!.agents[0]).toMatchObject({
        id: agent.id,
        payments: 3,
        donations: 1,
        buybacks: 1,
        total: 5,
        collected: "9007199254741003",
        lastActivity: "2026-03-29T22:30:00.000Z",
      });
      expect(
        analytics!.daily.map((day) => [
          day.date,
          day.payments,
          day.donations,
          day.buybacks,
          day.total,
        ]),
      ).toEqual([
        ["2026-03-28", 1, 0, 0, 1],
        ["2026-03-29", 1, 1, 1, 3],
        ["2026-03-30", 1, 0, 0, 1],
      ]);
      expect(analytics!.dataQuality).toEqual({
        excludedPayments: 3,
        excludedTransactions: 2,
        unknownValidationDates: 1,
      });
      const approvingManager = await getAgentAnalytics(
        managerSession(),
        manager.id,
        filters,
      );
      expect(approvingManager!.totals.total).toBe(0);
    });
    it("separates current workload from period outcomes and never serializes confidential content", async () => {
      const analytics = await getAgentAnalytics(
        managerSession(),
        agent.id,
        filters,
      );
      expect(analytics!.agents[0]).toMatchObject({
        dossiers: 1,
        tasksOpen: 2,
        tasksOverdue: 1,
        tasksBlocked: 1,
        tasksDone: 1,
        reportsSubmitted: 1,
        reportsApproved: 1,
        absentNow: true,
        absenceDuringPeriod: true,
        state: "ABSENT",
      });
      expect(analytics!.totals).toMatchObject({
        unassignedDossiers: 0,
        unassignedTasks: 0,
        reportsToReview: 2,
      });
      expect(
        analytics!.attention.every((entry) => entry.href.includes(agent.id)),
      ).toBe(true);
      const serialized = JSON.stringify(analytics);
      expect(JSON.parse(serialized).totals.collected).toBe("9007199254741003");
      expect(serialized).not.toMatch(
        /Motif confidentiel|SÉRIALISER|contentSnapshot|reviewerId/,
      );
    });
    it("keeps zero agents, unknown entry, exits and disabled accounts distinct; excludes technical super-admins", async () => {
      const analytics = await getTeamAnalytics(managerSession(), filters);
      expect(analytics.agents.find((row) => row.id === idle.id)).toMatchObject({
        total: 0,
        entryDateKnown: false,
        state: "ACTIVE",
      });
      expect(
        analytics.agents.find((row) => row.id === former.id),
      ).toMatchObject({ total: 0, state: "LEFT" });
      expect(
        analytics.agents.find((row) => row.id === disabled.id),
      ).toMatchObject({ total: 0, state: "DISABLED" });
      expect(analytics.agents.some((row) => row.id === technical.id)).toBe(
        false,
      );
      expect(analytics.totals.total).toBe(
        analytics.agents.reduce((sum, row) => sum + row.total, 0),
      );
      expect(analytics.totals.total).toBe(
        analytics.daily.reduce((sum, day) => sum + day.total, 0),
      );
      expect(
        await getAgentAnalytics(managerSession(), technical.id, filters),
      ).toBeNull();
      const empty = await getAgentAnalytics(managerSession(), idle.id, filters);
      expect(empty!.daily).toHaveLength(3);
      expect(empty!.daily.every((day) => day.total === 0)).toBe(true);
    });
    it("excludes disabled and former agents from service absences while preserving their absence context", async () => {
      const before = await getTeamAnalytics(managerSession(), filters);
      await prisma.agentAbsence.createMany({
        data: [disabled, former].map((user) => ({
          userId: user.id,
          startsAt: new Date("2026-03-28T00:00:00Z"),
          endsAt: new Date(Date.now() + 86400000),
          createdById: manager.id,
        })),
      });
      const after = await getTeamAnalytics(managerSession(), filters);
      expect(after.agents.find((row) => row.id === disabled.id)).toMatchObject({
        state: "DISABLED",
        absentNow: true,
        absenceDuringPeriod: true,
      });
      expect(after.agents.find((row) => row.id === former.id)).toMatchObject({
        state: "LEFT",
        absentNow: true,
        absenceDuringPeriod: true,
      });
      expect(after.totals.absentAgents).toBe(before.totals.absentAgents);
      expect(
        (await getAgentAnalytics(managerSession(), disabled.id, filters))!
          .totals.absentAgents,
      ).toBe(0);
      expect(
        (await getAgentAnalytics(managerSession(), agent.id, filters))!.totals
          .absentAgents,
      ).toBe(1);
    });
    it("retains continuous service entry through role splits and overlap, without inventing unknown dates or erasing a real gap", async () => {
      const now = Date.now(),
        daysAgo = (days: number) => new Date(now - days * 86400000);
      const [promoted, observed, returning] = await Promise.all([
        createUserWithRoles("Analytique promotion continue", ["KOEKI_MANAGER"]),
        createUserWithRoles("Analytique entrée inconnue continue", [
          "ECONOMIC_AGENT",
        ]),
        createUserWithRoles("Analytique retour après interruption", [
          "ECONOMIC_AGENT",
        ]),
      ]);
      await prisma.agentParticipation.createMany({
        data: [
          {
            userId: promoted.id,
            startsAt: daysAgo(90),
            endsAt: daysAgo(40),
            observedAt: daysAgo(90),
            serviceRole: "ECONOMIC_AGENT",
          },
          {
            userId: promoted.id,
            startsAt: daysAgo(40),
            endsAt: daysAgo(2),
            observedAt: daysAgo(40),
            serviceRole: "LEADERSHIP",
          },
          {
            userId: promoted.id,
            startsAt: daysAgo(3),
            observedAt: daysAgo(3),
            serviceRole: "ECONOMIC_AGENT",
          },
          {
            userId: observed.id,
            startsAt: null,
            endsAt: daysAgo(2),
            observedAt: daysAgo(90),
            dateSource: "OBSERVED",
            serviceRole: "LEADERSHIP",
          },
          {
            userId: observed.id,
            startsAt: daysAgo(2),
            observedAt: daysAgo(2),
            serviceRole: "ECONOMIC_AGENT",
          },
          {
            userId: returning.id,
            startsAt: daysAgo(90),
            endsAt: new Date(daysAgo(2).getTime() - 1),
            observedAt: daysAgo(90),
            serviceRole: "ECONOMIC_AGENT",
          },
          {
            userId: returning.id,
            startsAt: daysAgo(2),
            observedAt: daysAgo(2),
            serviceRole: "ECONOMIC_AGENT",
          },
        ],
      });
      const analytics = await getTeamAnalytics(managerSession(), filters);
      expect(
        analytics.agents.find((row) => row.id === promoted.id),
      ).toMatchObject({
        state: "ACTIVE",
        entryDateKnown: true,
        participationStartsAt: daysAgo(90).toISOString(),
      });
      expect(
        analytics.agents.find((row) => row.id === observed.id),
      ).toMatchObject({
        state: "ACTIVE",
        entryDateKnown: false,
        participationStartsAt: null,
        participation: "Participation observée · entrée inconnue",
      });
      expect(
        analytics.agents.find((row) => row.id === returning.id),
      ).toMatchObject({
        state: "RECENT",
        entryDateKnown: true,
        participationStartsAt: daysAgo(2).toISOString(),
      });
    });
    it("revalidates live roles and revocation instead of trusting a stale privileged DTO", async () => {
      await expect(
        getTeamAnalytics(
          { userId: agent.id, name: "Rôle forgé", roles: ["KOEKI_MANAGER"] },
          filters,
        ),
      ).rejects.toThrow("FORBIDDEN");
      const revokedManager = await createUserWithRoles(
        "Analytique responsable révoqué",
        ["KOEKI_MANAGER"],
      );
      await prisma.user.update({
        where: { id: revokedManager.id },
        data: { revokedAt: new Date() },
      });
      await expect(
        getAgentAnalytics(
          {
            userId: revokedManager.id,
            name: "Ancienne session",
            roles: ["KOEKI_MANAGER"],
          },
          agent.id,
          filters,
        ),
      ).rejects.toThrow("FORBIDDEN");
      const multiRoleSession: SessionInfo = {
        ...managerSession(),
        roles: ["NINJA", "KOEKI_MANAGER"],
      };
      expect(
        (await getAgentAnalytics(multiRoleSession, idle.id, filters))?.agents[0]
          ?.id,
      ).toBe(idle.id);
    });
  },
);

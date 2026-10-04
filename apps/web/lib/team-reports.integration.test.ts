import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { prisma, sendReportReminders } from "@koeki/database";
import { adjacentRankingWeek, can, rankingWeekAt, type Permission, type Role } from "@koeki/domain";
import { createTestUser } from "./test-fixtures";

const state = { userId: "", roles: [] as Role[] };
vi.mock("@/lib/session", () => ({
  demoMode: false,
  hasPermission: (session: { roles: Role[] }, permission: Permission) => session.roles.some((role) => can(role, permission)),
  requireWriteAccess: async (permission: Permission) => { if (!state.roles.some((role) => can(role, permission))) throw new Error("FORBIDDEN"); return { ...state, name: "Fixture" }; }
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
const { reviewReport, updateReport } = await import("../app/(app)/reports/actions");
const { transitionTask } = await import("../app/(app)/taches/actions");
const { getAgentDetail, getTasks, getTeamOverview } = await import("./team-service");
const { getReportReviewData, getReportExpectations } = await import("./report-service");
const form = (values: Record<string, string>) => { const output = new FormData(); Object.entries(values).forEach(([key, value]) => output.set(key, value)); return output; };

describe.skipIf(!inject("dbReady"))("team and report workflows (PostgreSQL)", () => {
  let agent: { id: string }, other: { id: string }, manager: { id: string };
  const session = (id: string, role: Role) => ({ userId: id, name: "Fixture", roles: [role] });
  const as = (id: string, role: Role) => { state.userId = id; state.roles = [role]; };
  beforeAll(async () => {
    [agent, other, manager] = await Promise.all([createTestUser("Suivi Sans Opération"), createTestUser("Suivi Autre Agent"), createTestUser("Suivi Responsable")]);
    for (const [user, code] of [[agent, "ECONOMIC_AGENT"], [other, "ECONOMIC_AGENT"], [manager, "KOEKI_MANAGER"]] as const) {
      const role = await prisma.role.upsert({ where: { code }, create: { code, label: code }, update: {} });
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    }
    await prisma.agentParticipation.create({ data: { userId: agent.id, startsAt: null, dateSource: "OBSERVED" } });
    await prisma.agentNote.create({ data: { userId: agent.id, authorId: manager.id, body: "Note encadrement confidentielle" } });
  });
  afterAll(async () => { await prisma.$disconnect(); });
  it("keeps zero-activity users and unknown dates; denies another agent detail and private drafts", async () => {
    const team = await getTeamOverview(session(manager.id, "KOEKI_MANAGER"), { search: "Suivi Sans Opération" });
    expect(team.rows.find((row) => row.id === agent.id)).toMatchObject({ operations: 0, entryKnown: false, state: "Aucune activité enregistrée" });
    await expect(getAgentDetail(session(other.id, "ECONOMIC_AGENT"), agent.id)).rejects.toThrow("FORBIDDEN");
    const draft = await prisma.agentReport.create({ data: { authorId: agent.id, periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-01-07"), summary: "Brouillon strictement privé" } });
    expect(await getReportReviewData(session(manager.id, "KOEKI_MANAGER"), draft.id)).toBeNull();
    expect(await getReportReviewData(session(other.id, "ECONOMIC_AGENT"), draft.id)).toBeNull();
    expect((await getReportReviewData(session(agent.id, "ECONOMIC_AGENT"), draft.id))?.summary).toBe(draft.summary);
  });
  it("requires correction reason; retains reviewed content on resubmission and rejects stale/concurrent approval", async () => {
    const report = await prisma.agentReport.create({ data: { authorId: agent.id, periodStart: new Date("2026-02-01"), periodEnd: new Date("2026-02-07"), summary: "Version initiale à corriger", status: "SUBMITTED", submittedAt: new Date() } });
    as(manager.id, "KOEKI_MANAGER");
    await expect(reviewReport(form({ reportId: report.id, version: "1", intent: "return", comment: "" }))).resolves.toMatchObject({ error: expect.stringMatching(/correction/) });
    expect((await prisma.agentReport.findUniqueOrThrow({ where: { id: report.id } })).status).toBe("SUBMITTED");
    await expect(reviewReport(form({ reportId: report.id, version: "1", intent: "return", comment: "Préciser les incidents du mardi" }))).rejects.toThrow("REDIRECT:/reports");
    const returned = await prisma.agentReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(returned.decidedAt).toBeInstanceOf(Date);
    as(agent.id, "ECONOMIC_AGENT");
    await expect(updateReport(form({ reportId: report.id, version: String(returned.version), periodStart: "2026-02-01", periodEnd: "2026-02-07", summary: "Version corrigée avec les incidents", intent: "submit" }))).rejects.toThrow("REDIRECT:/reports");
    const submitted = await prisma.agentReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(submitted.status).toBe("SUBMITTED");
    const previous = await prisma.reportReview.findFirstOrThrow({ where: { reportId: report.id } });
    expect(previous.comment).toBe("Préciser les incidents du mardi");
    expect(previous.contentSnapshot).toMatchObject({ summary: "Version initiale à corriger" });
    as(manager.id, "KOEKI_MANAGER");
    await expect(reviewReport(form({ reportId: report.id, version: "1", intent: "approve" }))).resolves.toMatchObject({ error: expect.stringMatching(/obsolète/) });
    expect((await prisma.agentReport.findUniqueOrThrow({ where: { id: report.id } })).status).toBe("SUBMITTED");
    await Promise.allSettled([reviewReport(form({ reportId: report.id, version: String(submitted.version), intent: "approve" })), reviewReport(form({ reportId: report.id, version: String(submitted.version), intent: "approve" }))]);
    expect(await prisma.reportReview.count({ where: { reportId: report.id } })).toBe(2);
    expect(await prisma.notification.count({ where: { userId: agent.id, dedupeKey: { startsWith: `report:${report.id}:` } } })).toBe(2);
  });
  it("revalidates active actor and protects assigned task transitions", async () => {
    const task = await prisma.followUpTask.create({ data: { title: "Relance dossier", description: "Contacter le référent", assigneeId: agent.id, createdById: manager.id } });
    expect((await getTasks(session(other.id, "ECONOMIC_AGENT"))).tasks.some((entry) => entry.id === task.id)).toBe(false);
    as(other.id, "ECONOMIC_AGENT");
    await expect(transitionTask(form({ taskId: task.id, version: "1", status: "DONE", reason: "Résolution falsifiée" }))).resolves.toMatchObject({ error: expect.any(String) });
    expect((await prisma.followUpTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("TODO");
    as(agent.id, "ECONOMIC_AGENT");
    await expect(transitionTask(form({ taskId: task.id, version: "1", status: "BLOCKED", reason: "Réponse du ninja attendue" }))).rejects.toThrow("REDIRECT:/taches");
    expect(await prisma.taskTransition.count({ where: { taskId: task.id } })).toBe(1);
    await prisma.user.update({ where: { id: agent.id }, data: { revokedAt: new Date() } });
    await expect(transitionTask(form({ taskId: task.id, version: "2", status: "DONE", reason: "Ancienne session" }))).resolves.toMatchObject({ error: expect.any(String) });
    expect((await prisma.followUpTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("BLOCKED");
    await prisma.user.update({ where: { id: agent.id }, data: { revokedAt: null } });
  });
  it("retains past reporting population after role removal and deduplicates internal due reminders", async () => {
    const week = adjacentRankingWeek(rankingWeekAt(new Date()), -1);
    const user = await createTestUser("Rapport historique");
    const role = await prisma.role.findUniqueOrThrow({ where: { code: "ECONOMIC_AGENT" } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    await prisma.agentParticipation.create({ data: { userId: user.id, startsAt: week.startsAt, serviceRole: "ECONOMIC_AGENT", dateSource: "DECLARED" } });
    const rule = await prisma.reportExpectation.create({ data: { effectiveFrom: week.startsAt, population: "ECONOMIC_AGENT", dueAfterDays: 0, createdById: manager.id } });
    try {
      await sendReportReminders(prisma);
      await sendReportReminders(prisma);
      expect(await prisma.notification.count({ where: { userId: user.id, dedupeKey: `report-due:${user.id}:${week.key}:${rule.id}` } })).toBe(1);
      const before = await getReportExpectations(session(manager.id, "KOEKI_MANAGER"), user.id);
      expect(before.periods.some((period) => period.state === "Échéance dépassée")).toBe(true);
      await prisma.userRole.deleteMany({ where: { userId: user.id } });
      await prisma.agentParticipation.updateMany({ where: { userId: user.id, endsAt: null }, data: { endsAt: new Date() } });
      const after = await getReportExpectations(session(manager.id, "KOEKI_MANAGER"), user.id);
      expect(after.periods.some((period) => period.start === before.periods.find((period) => period.state === "Échéance dépassée")?.start && period.state === "Échéance dépassée")).toBe(true);
    } finally { await prisma.reportExpectation.delete({ where: { id: rule.id } }); }
  });
});

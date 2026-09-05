"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@koeki/database";
import { normalizeSearch, parseQuantityInput } from "@koeki/domain";
import { isUniqueViolation, writeAudit } from "@/lib/finance";
import { confirmStocktake, openStocktake, type StocktakeCount } from "@/lib/inventory-ledger";
import { requireWriteAccess } from "@/lib/session";

const text = (value: FormDataEntryValue | null) => (typeof value === "string" ? value.trim() : "");

function revalidateCounts(sessionId?: string) {
  revalidatePath("/inventory");
  revalidatePath("/inventory/counts");
  revalidatePath("/inventory/movements");
  if (sessionId) revalidatePath(`/inventory/counts/${sessionId}`);
}

function handleError(error: unknown, backTo: string): never {
  if (error instanceof Error && error.message.startsWith("VALIDATION:")) redirect(`${backTo}${backTo.includes("?") ? "&" : "?"}erreur=${encodeURIComponent(error.message.slice("VALIDATION:".length))}`);
  if (isUniqueViolation(error)) redirect(`${backTo}${backTo.includes("?") ? "&" : "?"}erreur=${encodeURIComponent("Ce comptage a déjà été enregistré")}`);
  throw error;
}

/** Step 1: the count grid posts `count_<resourceId>` fields; empty fields are ignored. */
export async function openStocktakeAction(formData: FormData) {
  const session = await requireWriteAccess("inventory:count");
  const mode = text(formData.get("mode")) === "initial" ? "initial" : "count";
  const backTo = `/inventory/counts/new?mode=${mode}`;
  const resources = await prisma.resource.findMany({ where: { isActive: true }, include: { unit: true } });
  const counts: StocktakeCount[] = [];
  for (const resource of resources) {
    const raw = text(formData.get(`count_${resource.id}`));
    if (!raw) continue;
    const parsed = parseQuantityInput(raw, resource.unit.decimals, resource.unit.label);
    if (!parsed.ok) redirect(`${backTo}&erreur=${encodeURIComponent(`${resource.name} : ${parsed.error}`)}`);
    counts.push({ resourceId: resource.id, counted: parsed.value });
  }
  if (!counts.length) redirect(`${backTo}&erreur=${encodeURIComponent("Saisissez au moins une quantité comptée")}`);
  let sessionId = "";
  try {
    sessionId = await prisma.$transaction(async (tx) => {
      const opened = await openStocktake(tx, { kind: mode === "initial" ? "INITIAL" : "COUNT", startedById: session.userId, notes: text(formData.get("notes")) || null, counts });
      await writeAudit(tx, { actorId: session.userId, action: "STOCKTAKE_OPENED", entityType: "StocktakeSession", entityId: opened.id, reason: `${mode === "initial" ? "Inventaire initial" : "Comptage"} : ${counts.length} ressource${counts.length > 1 ? "s" : ""} comptée${counts.length > 1 ? "s" : ""}, ${opened.entries.filter((entry) => !entry.difference.isZero()).length} écart(s)` });
      return opened.id;
    });
  } catch (error) { handleError(error, backTo); }
  revalidateCounts(sessionId);
  redirect(`/inventory/counts/${sessionId}`);
}

/** CSV import: "code ou nom;quantité" per line — becomes a count session to review, never a direct stock write. */
export async function importStocktakeCsv(formData: FormData) {
  const session = await requireWriteAccess("inventory:count");
  const backTo = "/inventory/counts/new?mode=import";
  const file = formData.get("file");
  const pasted = text(formData.get("csv"));
  let content = pasted;
  if (file instanceof File && file.size > 0) {
    if (file.size > 512_000) redirect(`${backTo}&erreur=${encodeURIComponent("Fichier trop volumineux (500 Ko maximum)")}`);
    content = (await file.text()).replace(/^﻿/, "");
  }
  if (!content) redirect(`${backTo}&erreur=${encodeURIComponent("Collez ou déposez un CSV « code ou nom;quantité »")}`);
  const resources = await prisma.resource.findMany({ where: { isActive: true }, include: { unit: true, aliases: true } });
  const index = new Map<string, typeof resources[number]>();
  for (const resource of resources) {
    index.set(normalizeSearch(resource.code), resource);
    index.set(normalizeSearch(resource.name), resource);
    for (const alias of resource.aliases) index.set(normalizeSearch(alias.alias), resource);
  }
  const errors: string[] = [];
  const counts = new Map<string, number>();
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  lines.forEach((line, position) => {
    const cells = line.split(/[;,\t]/).map((cell) => cell.trim().replace(/^"|"$/g, ""));
    if (position === 0 && /^(code|ressource|resource|nom|name)/i.test(cells[0] ?? "")) return;
    const [key, quantityRaw] = cells;
    if (!key || quantityRaw === undefined) { errors.push(`Ligne ${position + 1} : format attendu « code ou nom;quantité »`); return; }
    const resource = index.get(normalizeSearch(key));
    if (!resource) { errors.push(`Ligne ${position + 1} : ressource inconnue « ${key} »`); return; }
    const parsed = parseQuantityInput(quantityRaw, resource.unit.decimals, resource.unit.label);
    if (!parsed.ok) { errors.push(`Ligne ${position + 1} : ${resource.name} — ${parsed.error}`); return; }
    if (counts.has(resource.id)) { errors.push(`Ligne ${position + 1} : ${resource.name} apparaît deux fois`); return; }
    counts.set(resource.id, parsed.value);
  });
  if (errors.length) redirect(`${backTo}&erreur=${encodeURIComponent(`${errors.length} ligne(s) refusée(s) — ${errors.slice(0, 5).join(" · ")}${errors.length > 5 ? " · …" : ""}`)}`);
  if (!counts.size) redirect(`${backTo}&erreur=${encodeURIComponent("Aucune ligne exploitable dans le CSV")}`);
  let sessionId = "";
  try {
    sessionId = await prisma.$transaction(async (tx) => {
      const opened = await openStocktake(tx, { kind: "COUNT", startedById: session.userId, notes: `Import CSV (${counts.size} lignes)`, counts: [...counts.entries()].map(([resourceId, counted]) => ({ resourceId, counted })) });
      await writeAudit(tx, { actorId: session.userId, action: "STOCKTAKE_IMPORTED", entityType: "StocktakeSession", entityId: opened.id, reason: `Import CSV : ${counts.size} ressource(s), ${opened.entries.filter((entry) => !entry.difference.isZero()).length} écart(s) à confirmer` });
      return opened.id;
    });
  } catch (error) { handleError(error, backTo); }
  revalidateCounts(sessionId);
  redirect(`/inventory/counts/${sessionId}`);
}

/** Step 2: every difference becomes an audited movement; the session is archived. */
export async function confirmStocktakeAction(formData: FormData) {
  const session = await requireWriteAccess("inventory:count");
  const sessionId = text(formData.get("sessionId"));
  if (!sessionId) redirect("/inventory/counts");
  let result = { movements: 0, adjusted: 0, counted: 0 };
  try {
    result = await prisma.$transaction(async (tx) => {
      const confirmation = await confirmStocktake(tx, { sessionId, agentId: session.userId });
      await writeAudit(tx, { actorId: session.userId, action: "STOCKTAKE_CONFIRMED", entityType: "StocktakeSession", entityId: sessionId, reason: `${confirmation.counted} ressource(s) comptée(s), ${confirmation.movements} mouvement(s) dont ${confirmation.adjusted} ajustement(s)`, newValues: { ...confirmation } });
      return confirmation;
    }, { timeout: 60_000 });
  } catch (error) { handleError(error, `/inventory/counts/${sessionId}`); }
  revalidateCounts(sessionId);
  redirect(`/inventory/counts/${sessionId}?info=${encodeURIComponent(`Comptage confirmé : ${result.counted} ressource(s) inventoriée(s), ${result.movements} mouvement(s) enregistré(s)`)}`);
}

export async function cancelStocktakeAction(formData: FormData) {
  const session = await requireWriteAccess("inventory:count");
  const sessionId = text(formData.get("sessionId"));
  if (!sessionId) redirect("/inventory/counts");
  try {
    await prisma.$transaction(async (tx) => {
      const cancelled = await tx.stocktakeSession.updateMany({ where: { id: sessionId, status: "OPEN" }, data: { status: "CANCELLED", completedAt: new Date() } });
      if (cancelled.count !== 1) throw new Error("VALIDATION:Ce comptage est déjà clôturé");
      await writeAudit(tx, { actorId: session.userId, action: "STOCKTAKE_CANCELLED", entityType: "StocktakeSession", entityId: sessionId, reason: text(formData.get("reason")) || "Comptage abandonné avant confirmation" });
    });
  } catch (error) { handleError(error, `/inventory/counts/${sessionId}`); }
  revalidateCounts(sessionId);
  redirect("/inventory/counts?info=Comptage%20annul%C3%A9%20%E2%80%94%20aucun%20stock%20modifi%C3%A9");
}

"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma, prisma } from "@koeki/database";
import { isUniqueViolation, writeAudit } from "@/lib/finance";
import { requireWriteAccess } from "@/lib/session";

const executeSchema = z.object({ recipeId: z.string().min(1), quantity: z.coerce.number().int().min(1).max(999), idempotencyKey: z.string().uuid() });

export async function executeCraft(formData: FormData) {
  const session = await requireWriteAccess("inventory:write");
  const parsed = executeSchema.safeParse(Object.fromEntries(formData));
  const back = (message: string): never => redirect(`/crafting?erreur=${encodeURIComponent(message)}`);
  if (!parsed.success) back(parsed.error.issues[0]?.message ?? "Saisie invalide");
  const { recipeId, quantity, idempotencyKey } = parsed.data!;
  let receiptLabel = "";
  try {
    receiptLabel = await prisma.$transaction(async (tx) => {
      const recipe = await tx.craftRecipe.findUnique({ where: { id: recipeId }, include: { ingredients: { include: { resource: true } }, outputs: true } });
      if (!recipe || recipe.status !== "ACTIVE") throw new Error("VALIDATION:Recette inconnue ou inactive");
      if (!recipe.ingredients.length) throw new Error("VALIDATION:Cette recette n’a aucun ingrédient défini");
      for (const ingredient of recipe.ingredients) {
        const aggregate = await tx.inventoryMovement.aggregate({ where: { resourceId: ingredient.resourceId }, _sum: { quantity: true } });
        const needed = Number(ingredient.quantity) * quantity;
        if (Number(aggregate._sum.quantity ?? 0) < needed) throw new Error(`VALIDATION:Stock insuffisant de ${ingredient.resource.name} (${needed.toLocaleString("fr-FR")} requis)`);
      }
      const execution = await tx.craftExecution.create({ data: { recipeId, quantity, status: "CONFIRMED", confirmedById: session.userId, idempotencyKey } });
      for (const ingredient of recipe.ingredients) await tx.inventoryMovement.create({ data: {
        resourceId: ingredient.resourceId, type: "CRAFT_CONSUMPTION", quantity: new Prisma.Decimal(-Number(ingredient.quantity) * quantity),
        craftExecutionId: execution.id, agentId: session.userId, justification: `Fabrication ${recipe.code} ×${quantity}`, idempotencyKey: `${idempotencyKey}:in:${ingredient.resourceId}`
      } });
      for (const output of recipe.outputs) await tx.inventoryMovement.create({ data: {
        resourceId: output.resourceId, type: "CRAFT_OUTPUT", quantity: new Prisma.Decimal(Number(output.quantity) * quantity),
        craftExecutionId: execution.id, agentId: session.userId, justification: `Fabrication ${recipe.code} ×${quantity}`, idempotencyKey: `${idempotencyKey}:out:${output.resourceId}`
      } });
      await writeAudit(tx, { actorId: session.userId, action: "CRAFT_EXECUTED", entityType: "CraftExecution", entityId: execution.id, reason: `${recipe.name} ×${quantity}`, newValues: { recipeCode: recipe.code, quantity } });
      return `${recipe.code} ×${quantity}`;
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("VALIDATION:")) back(error.message.slice("VALIDATION:".length));
    if (isUniqueViolation(error)) back("Fabrication déjà confirmée (double soumission détectée)");
    throw error;
  }
  redirect(`/crafting?fabrique=${encodeURIComponent(receiptLabel)}`);
}

const recipeSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9-]{3,20}$/, "Code invalide (majuscules, chiffres, tirets)"),
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(60),
  description: z.string().trim().max(1000).optional().transform((value) => value || ""),
  difficulty: z.string().trim().min(1).max(40),
  durationRpMinutes: z.coerce.number().int().min(1).max(100_000),
  cost: z.coerce.number().int().min(0),
  minimumGradeCode: z.string().trim().optional().transform((value) => value || null)
});

export async function createRecipe(formData: FormData) {
  const session = await requireWriteAccess("settings:manage");
  const parsed = recipeSchema.safeParse(Object.fromEntries(formData));
  const back = (message: string): never => redirect(`/crafting/new?erreur=${encodeURIComponent(message)}`);
  if (!parsed.success) back(parsed.error.issues[0]?.message ?? "Saisie invalide");
  const ingredients: Array<{ resourceId: string; quantity: number }> = [];
  for (let index = 1; index <= 4; index++) {
    const resourceId = formData.get(`ingredientId_${index}`);
    const quantityRaw = formData.get(`ingredientQty_${index}`);
    if (typeof resourceId === "string" && resourceId && typeof quantityRaw === "string" && quantityRaw) {
      const quantity = Number(quantityRaw.replace(",", "."));
      if (!Number.isFinite(quantity) || quantity <= 0) back(`Quantité d’ingrédient invalide (ligne ${index})`);
      if (ingredients.some((ingredient) => ingredient.resourceId === resourceId)) back("Un ingrédient apparaît deux fois");
      ingredients.push({ resourceId, quantity });
    }
  }
  if (!ingredients.length) back("Ajoutez au moins un ingrédient");
  const outputId = formData.get("outputId");
  const outputQtyRaw = formData.get("outputQty");
  const output = typeof outputId === "string" && outputId && typeof outputQtyRaw === "string" && Number(outputQtyRaw) > 0 ? { resourceId: outputId, quantity: Number(outputQtyRaw) } : null;
  const data = parsed.data!;
  const previous = await prisma.craftRecipe.findFirst({ where: { code: data.code }, orderBy: { version: "desc" } });
  let recipeId = "";
  try {
    recipeId = await prisma.$transaction(async (tx) => {
      if (previous && previous.status === "ACTIVE") await tx.craftRecipe.update({ where: { id: previous.id }, data: { status: "INACTIVE" } });
      const recipe = await tx.craftRecipe.create({ data: {
        code: data.code, version: (previous?.version ?? 0) + 1, name: data.name, category: data.category, description: data.description,
        difficulty: data.difficulty, durationRpMinutes: data.durationRpMinutes, cost: BigInt(data.cost), minimumGradeCode: data.minimumGradeCode, status: "ACTIVE",
        ingredients: { createMany: { data: ingredients.map((ingredient) => ({ resourceId: ingredient.resourceId, quantity: new Prisma.Decimal(ingredient.quantity) })) } },
        ...(output ? { outputs: { create: { resourceId: output.resourceId, quantity: new Prisma.Decimal(output.quantity) } } } : {})
      } });
      await writeAudit(tx, { actorId: session.userId, action: previous ? "RECIPE_VERSIONED" : "RECIPE_CREATED", entityType: "CraftRecipe", entityId: recipe.id, reason: `${data.code} v${(previous?.version ?? 0) + 1}`, newValues: { name: data.name, ingredients } });
      return recipe.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) back("Cette version de recette existe déjà");
    throw error;
  }
  void recipeId;
  redirect("/crafting");
}

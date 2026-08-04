export interface Ingredient { resourceId: string; quantity: number; }
export interface Stock { resourceId: string; quantity: number; }
export function simulateCraft(ingredients: Ingredient[], stocks: Stock[]) {
  const available = new Map(stocks.map((stock) => [stock.resourceId, stock.quantity]));
  const capacities = ingredients.map((ingredient) => ({ resourceId: ingredient.resourceId, capacity: Math.floor((available.get(ingredient.resourceId) ?? 0) / ingredient.quantity) }));
  const maximum = capacities.length ? Math.min(...capacities.map((item) => item.capacity)) : 0;
  return { maximum, limitingResourceIds: capacities.filter((item) => item.capacity === maximum).map((item) => item.resourceId), remaining: stocks.map((stock) => ({ ...stock, quantity: stock.quantity - maximum * (ingredients.find((ingredient) => ingredient.resourceId === stock.resourceId)?.quantity ?? 0) })) };
}

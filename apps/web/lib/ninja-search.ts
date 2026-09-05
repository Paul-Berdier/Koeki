import { normalizeSearch } from "@koeki/domain/inventory";

/** One rule for the register search, shared by the server render (deep link `?q=`) and the
 *  browser (instant filtering): name, code or alias, accents and case ignored. */
export function matchesNinjaQuery(row: { name: string; code: string; alias: string | null }, query: string): boolean {
  const needle = normalizeSearch(query);
  if (!needle) return true;
  return normalizeSearch(`${row.name} ${row.code} ${row.alias ?? ""}`).includes(needle);
}

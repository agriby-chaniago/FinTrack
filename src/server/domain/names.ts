/** Trims, collapses inner whitespace, and lowercases so equivalent labels match. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("id-ID");
}

/** Trims and collapses inner whitespace while keeping the original casing for display. */
export function cleanDisplayName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

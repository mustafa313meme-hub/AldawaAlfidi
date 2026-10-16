export const MAX_CATEGORY_DEPTH = 5;

/** Would setting `categoryId`'s parent to `newParentId` create a cycle? `parentOf` maps id → parentId. */
export function wouldCreateCycle(parentOf: Map<string, string | null>, categoryId: string, newParentId: string | null): boolean {
  let cur: string | null = newParentId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === categoryId) return true;
    if (seen.has(cur)) return true; // pre-existing corruption: refuse
    seen.add(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return false;
}

export function depthOf(parentOf: Map<string, string | null>, id: string | null): number {
  let d = 0;
  let cur = id;
  while (cur && d <= 50) {
    d++;
    cur = parentOf.get(cur) ?? null;
  }
  return d;
}

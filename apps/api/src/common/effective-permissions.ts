export interface PermissionOverride {
  code: string;
  allowed: boolean;
}

/** Role permissions, plus user overrides: allowed=true adds, allowed=false removes. */
export function resolveEffectivePermissions(rolePermissions: string[], overrides: PermissionOverride[]): string[] {
  const set = new Set(rolePermissions);
  for (const o of overrides) {
    if (o.allowed) set.add(o.code);
    else set.delete(o.code);
  }
  return [...set].sort();
}

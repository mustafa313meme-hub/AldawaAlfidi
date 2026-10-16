import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { resolveEffectivePermissions } from './effective-permissions';
import { PermissionsGuard } from './permissions.guard';
import { ALL_PERMISSIONS, DEFAULT_ROLES, PERMISSION_GROUPS } from './permissions.constants';
import { AuthUser } from './decorators';
import { sha256 } from './tokens';

describe('resolveEffectivePermissions', () => {
  it('adds allowed overrides and removes denied ones', () => {
    const r = resolveEffectivePermissions(['a.view', 'a.edit'], [{ code: 'a.edit', allowed: false }, { code: 'b.view', allowed: true }]);
    expect(r).toEqual(['a.view', 'b.view']);
  });
  it('is a no-op without overrides', () => {
    expect(resolveEffectivePermissions(['x', 'y'], [])).toEqual(['x', 'y']);
  });
});

describe('PermissionsGuard', () => {
  const user = (over: Partial<AuthUser>): AuthUser => ({
    id: '1', username: 'u', fullName: 'U', roleName: 'viewer', isSuperAdmin: false, permissions: [], sessionId: 's', ...over,
  });
  const ctx = (u: AuthUser | undefined, required?: string[], isPublic = false) => {
    const reflector = { getAllAndOverride: (key: string) => (key === 'isPublic' ? isPublic : required) } as unknown as Reflector;
    const context = {
      getHandler: () => ({}), getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user: u }) }),
    } as unknown as ExecutionContext;
    return { guard: new PermissionsGuard(reflector), context };
  };

  it('allows public routes', () => {
    const { guard, context } = ctx(undefined, ['users.view'], true);
    expect(guard.canActivate(context)).toBe(true);
  });
  it('allows authenticated-only routes (no permission metadata)', () => {
    const { guard, context } = ctx(user({}), undefined);
    expect(guard.canActivate(context)).toBe(true);
  });
  it('rejects when a required permission is missing', () => {
    const { guard, context } = ctx(user({ permissions: ['users.view'] }), ['users.view', 'users.delete']);
    expect(() => guard.canActivate(context)).toThrow();
  });
  it('allows when all required permissions are present', () => {
    const { guard, context } = ctx(user({ permissions: ['users.view', 'users.delete'] }), ['users.view', 'users.delete']);
    expect(guard.canActivate(context)).toBe(true);
  });
  it('lets super admin through', () => {
    const { guard, context } = ctx(user({ isSuperAdmin: true }), ['roles.manage']);
    expect(guard.canActivate(context)).toBe(true);
  });
  it('rejects missing user on protected route', () => {
    const { guard, context } = ctx(undefined, ['users.view']);
    expect(() => guard.canActivate(context)).toThrow();
  });
});

describe('role definitions', () => {
  it('only reference known permissions', () => {
    const known = new Set(ALL_PERMISSIONS);
    for (const [role, def] of Object.entries(DEFAULT_ROLES)) {
      for (const p of def.permissions) expect({ role, p, known: known.has(p) }).toEqual({ role, p, known: true });
    }
  });
  it('representative cannot collect payments or touch users by default', () => {
    const rep = DEFAULT_ROLES.representative.permissions;
    expect(rep).not.toContain('payments.create');
    expect(rep.some((p) => p.startsWith('users.'))).toBe(false);
  });
  it('has no duplicate permission codes', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    expect(Object.keys(PERMISSION_GROUPS).length).toBeGreaterThan(10);
  });
});

describe('sha256', () => {
  it('is deterministic and hex', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

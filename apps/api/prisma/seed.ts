import { PrismaClient } from '@prisma/client';
import { ALL_PERMISSIONS, DEFAULT_ROLES, DEFAULT_SETTINGS, SUPER_ADMIN_ROLE } from '../src/common/permissions.constants';
import { hashPassword } from '../src/common/password';

const prisma = new PrismaClient();

async function main() {
  // Permissions
  for (const code of ALL_PERMISSIONS) {
    const [group] = code.split('.');
    await prisma.permission.upsert({ where: { code }, update: { group }, create: { code, group, name: code } });
  }
  const perms = new Map((await prisma.permission.findMany()).map((p) => [p.code, p.id]));

  // Roles: system roles are re-synced on every seed run (custom roles are untouched).
  for (const [name, def] of Object.entries(DEFAULT_ROLES)) {
    const role = await prisma.role.upsert({
      where: { name }, update: { description: def.description, isSystem: true },
      create: { name, description: def.description, isSystem: true },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: [...new Set(def.permissions)].map((code) => ({ roleId: role.id, permissionId: perms.get(code)! })),
    });
  }

  // Settings: only created if missing, never overwrites an admin's choice.
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value: value as never } });
  }

  // First Super Admin (credentials come from env, never hard-coded).
  const username = (process.env.SEED_ADMIN_USERNAME ?? '').trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? '';
  if (!username || password.length < 12) {
    console.warn('Skipped Super Admin: set SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD (min 12 chars) in .env');
    return;
  }
  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) {
    console.log(`Super Admin "${username}" already exists, left unchanged.`);
    return;
  }
  const role = await prisma.role.findUniqueOrThrow({ where: { name: SUPER_ADMIN_ROLE } });
  await prisma.user.create({
    data: {
      username, fullName: process.env.SEED_ADMIN_FULL_NAME ?? 'مدير النظام',
      passwordHash: await hashPassword(password), roleId: role.id, mustChangePassword: true,
    },
  });
  console.log(`Created Super Admin "${username}" (must change password at first login).`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

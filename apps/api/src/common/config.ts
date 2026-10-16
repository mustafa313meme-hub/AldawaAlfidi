export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  const need = ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];
  for (const k of need) if (!env[k]) throw new Error(`Missing required env var: ${k}`);
  for (const k of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
    if (String(env[k]).length < 32) throw new Error(`${k} must be at least 32 characters`);
  }
  if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must differ');
  return env;
}

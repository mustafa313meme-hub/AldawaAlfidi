import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReqCtx } from '../common/decorators';

const SECRET_KEYS = new Set(['passwordHash', 'password', 'tokenHash', 'refreshToken', 'token', 'pushToken']);

export function sanitize(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(JSON.stringify(v, (k, val) => (SECRET_KEYS.has(k) ? undefined : val)));
}

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  ctx?: ReqCtx;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  /** Pass `tx` to write inside the caller's transaction (required for financial operations). */
  log(e: AuditEntry, tx?: Prisma.TransactionClient) {
    return (tx ?? this.prisma).auditLog.create({
      data: {
        userId: e.userId ?? null,
        action: e.action,
        entity: e.entity,
        entityId: e.entityId ?? null,
        oldValues: sanitize(e.oldValues),
        newValues: sanitize(e.newValues),
        ip: e.ctx?.ip ?? null,
        device: e.ctx?.device ?? null,
      },
    });
  }
}

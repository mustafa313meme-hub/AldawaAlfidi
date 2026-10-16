import { HttpException, Injectable } from '@nestjs/common';
import { Prisma, SyncOperation } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app.exception';
import { AuthUser, ReqCtx } from '../common/decorators';
import { resolveEffectivePermissions } from '../common/effective-permissions';
import { SUPER_ADMIN_ROLE } from '../common/permissions.constants';
import { can } from '../common/perm';
import { skipTake } from '../common/pagination';
import { Paginated } from '../common/response';
import { CreateVisitDto } from '../field/visits.dto';
import { VisitsService } from '../field/visits.service';
import { CreateOrderDto, CreateReturnDto } from '../sales/sales.dto';
import { OrdersService } from '../sales/orders.service';
import { ReturnsService } from '../sales/returns.service';
import { CreatePaymentDto } from '../payments/payments.dto';
import { PaymentsService } from '../payments/payments.service';
import { classifyFailure } from './sync-logic';
import { NotificationsService } from '../notifications/notifications.service';
import { AppVersionService } from '../app-version/app-version.service';
import { ConflictsQuery, OpDto, OpType, PushDto, ResolveDto } from './sync.dto';

const PERMS: Record<OpType, string> = { visit: 'visits.create', order: 'orders.create', payment: 'payments.create', return: 'returns.create' };
const DTOS = { visit: CreateVisitDto, order: CreateOrderDto, payment: CreatePaymentDto, return: CreateReturnDto } as const;
const STALE_PENDING_MS = 120_000;

export interface OpResult {
  localId: string;
  status: 'Applied' | 'Conflict' | 'Rejected' | 'Failed' | 'Processing' | 'Discarded';
  serverId?: string | null;
  duplicate?: boolean;
  error?: { code: string; message: string; details?: unknown } | null;
}

const toResult = (r: SyncOperation, duplicate = false): OpResult => ({
  localId: r.localId, status: r.status === 'Pending' ? 'Processing' : r.status, serverId: r.serverId, duplicate: duplicate || undefined,
  error: r.errorCode ? { code: r.errorCode, message: r.errorMessage ?? '', details: r.errorDetails ?? undefined } : null,
});

@Injectable()
export class SyncService {
  constructor(
    private prisma: PrismaService, private audit: AuditService,
    private visits: VisitsService, private orders: OrdersService, private payments: PaymentsService, private returns: ReturnsService,
    private notifications: NotificationsService, private appVersion: AppVersionService,
  ) {}

  // ───────────── push ─────────────

  /**
   * Each operation is independent: one bad operation never blocks the others, and nothing is dropped.
   * Re-sending an operation is always safe (same device + localId): the stored outcome is returned,
   * and the underlying services are idempotent on the same key as a second line of defence.
   */
  async push(dto: PushDto, u: AuthUser, ctx: ReqCtx) {
    if (!ctx.device) throw new AppException('DEVICE_REQUIRED', 'أرسل x-device-id', 400);
    await this.appVersion.assertSupported(ctx.platform, ctx.appVersion);
    const dev = await this.prisma.userDevice.findUnique({ where: { userId_deviceId: { userId: u.id, deviceId: ctx.device } } });
    if (dev && !dev.isActive) throw new AppException('DEVICE_BLOCKED', 'هذا الجهاز موقوف من الإدارة', 403);
    await this.prisma.userDevice.upsert({
      where: { userId_deviceId: { userId: u.id, deviceId: ctx.device } }, update: { lastSeenAt: new Date() },
      create: { userId: u.id, deviceId: ctx.device },
    });

    const results: OpResult[] = [];
    for (const op of dto.ops) results.push(await this.processOne(op, u, ctx));

    const counts = results.reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});
    await this.audit.log({ userId: u.id, action: 'sync.push', entity: 'device', entityId: ctx.device, newValues: { total: results.length, counts }, ctx });
    return { serverTime: new Date().toISOString(), results };
  }

  private async processOne(op: OpDto, u: AuthUser, ctx: ReqCtx): Promise<OpResult> {
    const deviceId = ctx.device as string;
    const key = { deviceId_localId: { deviceId, localId: op.localId } };
    let rec = await this.prisma.syncOperation.findUnique({ where: key });

    if (rec) {
      if (rec.userId !== u.id) return { localId: op.localId, status: 'Rejected', error: { code: 'LOCAL_ID_COLLISION', message: 'المعرّف المحلي مستخدم من مستخدم آخر' } };
      if (rec.status === 'Pending' && Date.now() - rec.updatedAt.getTime() < STALE_PENDING_MS) return toResult(rec, true); // being processed right now
      if (rec.status !== 'Pending' && rec.status !== 'Failed') return toResult(rec, true); // already has a final outcome: idempotent answer
    } else {
      try {
        rec = await this.prisma.syncOperation.create({
          data: { userId: u.id, deviceId, localId: op.localId, opType: op.type, payload: op.payload as Prisma.InputJsonValue, clientCreatedAt: op.clientCreatedAt ? new Date(op.clientCreatedAt) : null },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          const again = await this.prisma.syncOperation.findUniqueOrThrow({ where: key });
          return toResult(again, true); // a parallel request just stored it
        }
        throw e;
      }
    }
    return this.execute(rec, u, ctx);
  }

  private async validatePayload(type: OpType, payload: unknown, localId: string) {
    const cls = DTOS[type];
    const inst = plainToInstance(cls, { ...(payload as object), localId }) as object;
    const errors = await validate(inst, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length) {
      const details = errors.flatMap((e) => Object.values(e.constraints ?? { [e.property]: 'invalid' }));
      throw new AppException('VALIDATION_ERROR', 'بيانات العملية غير صالحة', 400, details);
    }
    return inst;
  }

  private async run(type: OpType, dto: object, u: AuthUser, ctx: ReqCtx): Promise<{ id: string }> {
    switch (type) {
      case 'visit': return this.visits.create(dto as CreateVisitDto, u, ctx);
      case 'order': return this.orders.create(dto as CreateOrderDto, u, ctx);
      case 'payment': return this.payments.create(dto as CreatePaymentDto, u, ctx);
      case 'return': return this.returns.create(dto as CreateReturnDto, u, ctx);
      default: throw new AppException('UNKNOWN_OPERATION', 'نوع عملية غير معروف', 400);
    }
  }

  /** Run a stored operation as `actor` (the device's user, or the original user when a manager retries). */
  private async execute(rec: SyncOperation, actor: AuthUser, ctx: ReqCtx): Promise<OpResult> {
    const attempts = rec.attempts + 1;
    const type = rec.opType as OpType;
    try {
      const dto = await this.validatePayload(type, rec.payload, rec.localId);
      if (!PERMS[type] || !can(actor, PERMS[type])) throw new AppException('FORBIDDEN', 'ليست لديك صلاحية هذه العملية', 403, { required: PERMS[type] });
      const out = await this.run(type, dto, actor, { ...ctx, device: rec.deviceId });
      const done = await this.prisma.syncOperation.update({
        where: { id: rec.id },
        data: { status: 'Applied', serverId: out.id, attempts, processedAt: new Date(), errorCode: null, errorMessage: null, errorDetails: Prisma.JsonNull },
      });
      return toResult(done);
    } catch (e) {
      const status = e instanceof HttpException ? e.getStatus() : 500;
      const code = e instanceof AppException ? e.code : e instanceof HttpException ? `HTTP_${status}` : 'INTERNAL_ERROR';
      const message = e instanceof Error ? e.message : String(e);
      const { outcome, code: finalCode } = classifyFailure({ status, code }, rec.attempts);
      const details = e instanceof AppException ? e.details : undefined;
      const upd = await this.prisma.syncOperation.update({
        where: { id: rec.id },
        data: {
          status: outcome, attempts, processedAt: new Date(), errorCode: finalCode,
          errorMessage: (status >= 500 ? 'خطأ مؤقت في الخادم' : message).slice(0, 500), errorDetails: (details ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        },
      });
      if (outcome === 'Conflict') {
        await this.notifications.notifyPermission('sync.manage', {
          type: 'sync_conflict', title: 'عملية مزامنة بحاجة لمراجعة', body: `${rec.opType} — ${finalCode}`, data: { operationId: rec.id }, dedupeKey: `conflict:${rec.id}`,
        });
      }
      return toResult(upd);
    }
  }

  // ───────────── device view ─────────────

  /** What the device should show the user: operations that did not go through, and why. */
  async status(u: AuthUser, deviceId?: string) {
    const where: Prisma.SyncOperationWhereInput = { userId: u.id, deviceId };
    const [counts, problems] = await Promise.all([
      this.prisma.syncOperation.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.syncOperation.findMany({
        where: { ...where, status: { in: ['Conflict', 'Rejected', 'Failed', 'Discarded'] } }, orderBy: { updatedAt: 'desc' }, take: 100,
        select: { localId: true, opType: true, status: true, errorCode: true, errorMessage: true, resolution: true, resolutionNote: true, attempts: true, updatedAt: true },
      }),
    ]);
    return { counts: Object.fromEntries(counts.map((c) => [c.status, c._count])), problems };
  }

  // ───────────── manager: conflict queue ─────────────

  async list(q: ConflictsQuery) {
    const where: Prisma.SyncOperationWhereInput = {
      status: q.status ?? { in: ['Conflict', 'Rejected', 'Failed'] }, userId: q.userId, deviceId: q.deviceId, opType: q.type,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.syncOperation.findMany({ where, orderBy: { createdAt: q.order }, ...skipTake(q), select: { id: true, userId: true, deviceId: true, localId: true, opType: true, status: true, errorCode: true, errorMessage: true, attempts: true, clientCreatedAt: true, createdAt: true } }),
      this.prisma.syncOperation.count({ where }),
    ]);
    return new Paginated(items, { page: q.page, pageSize: q.pageSize, total });
  }

  async get(id: string) {
    const r = await this.prisma.syncOperation.findUnique({ where: { id } });
    if (!r) throw new AppException('NOT_FOUND', 'العملية غير موجودة', 404);
    const user = await this.prisma.user.findUnique({ where: { id: r.userId }, select: { id: true, username: true, fullName: true } });
    return { ...r, user };
  }

  private async authUserFor(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true, deletedAt: null },
      include: { role: { include: { permissions: { include: { permission: { select: { code: true } } } } } }, permissions: { include: { permission: { select: { code: true } } } } },
    });
    if (!user) throw new AppException('USER_INACTIVE', 'مستخدم العملية الأصلي غير فعّال', 422);
    return {
      id: user.id, username: user.username, fullName: user.fullName, roleName: user.role.name, isSuperAdmin: user.role.name === SUPER_ADMIN_ROLE, sessionId: 'sync-retry',
      permissions: resolveEffectivePermissions(user.role.permissions.map((p) => p.permission.code), user.permissions.map((p) => ({ code: p.permission.code, allowed: p.allowed }))),
    };
  }

  /**
   * retry  = run the operation again as its ORIGINAL user (after the manager fixed the cause, e.g. re-assigned the customer);
   * discard = close it with a mandatory note. The payload is kept in both cases.
   */
  async resolve(id: string, dto: ResolveDto, actor: AuthUser, ctx: ReqCtx) {
    const rec = await this.prisma.syncOperation.findUnique({ where: { id } });
    if (!rec) throw new AppException('NOT_FOUND', 'العملية غير موجودة', 404);

    if (dto.action === 'discard') {
      if (!dto.note || dto.note.trim().length < 3) throw new AppException('NOTE_REQUIRED', 'سبب التجاهل مطلوب', 400);
      const r = await this.prisma.syncOperation.updateMany({
        where: { id, status: { in: ['Conflict', 'Rejected', 'Failed'] } },
        data: { status: 'Discarded', resolvedById: actor.id, resolution: 'discarded', resolutionNote: dto.note.trim() },
      });
      if (r.count !== 1) throw new AppException('INVALID_STATE', `لا يمكن تجاهل عملية حالتها ${rec.status}`, 409);
      await this.audit.log({ userId: actor.id, action: 'sync.discard', entity: 'sync_operation', entityId: id, oldValues: { status: rec.status, errorCode: rec.errorCode }, newValues: { note: dto.note }, ctx });
      return { id, status: 'Discarded' };
    }

    if (rec.status === 'Rejected') throw new AppException('NOT_RETRYABLE', 'العملية المرفوضة (غير صالحة/غير مسموحة) لا تُعاد؛ يمكن تجاهلها فقط', 409);
    const claimed = await this.prisma.syncOperation.updateMany({ where: { id, status: { in: ['Conflict', 'Failed'] } }, data: { status: 'Pending' } });
    if (claimed.count !== 1) throw new AppException('INVALID_STATE', `لا يمكن إعادة عملية حالتها ${rec.status}`, 409);
    const fresh = await this.prisma.syncOperation.findUniqueOrThrow({ where: { id } });
    const original = await this.authUserFor(rec.userId).catch(async (e) => {
      await this.prisma.syncOperation.update({ where: { id }, data: { status: rec.status } }); // give it back to the queue untouched
      throw e;
    });
    const result = await this.execute(fresh, original, ctx);
    if (result.status === 'Applied') {
      await this.prisma.syncOperation.update({ where: { id }, data: { resolvedById: actor.id, resolution: 'retried', resolutionNote: dto.note?.trim() ?? null } });
    }
    await this.audit.log({ userId: actor.id, action: 'sync.retry', entity: 'sync_operation', entityId: id, oldValues: { status: rec.status, errorCode: rec.errorCode }, newValues: { result: result.status, serverId: result.serverId ?? null, errorCode: result.error?.code ?? null }, ctx });
    return result;
  }
}

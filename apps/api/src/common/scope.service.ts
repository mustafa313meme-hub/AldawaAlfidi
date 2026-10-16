import { Global, Injectable, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './decorators';
import { can } from './perm';

/** Row-level scope: a representative sees only customers currently assigned to them. */
@Injectable()
export class ScopeService {
  constructor(private prisma: PrismaService) {}

  repOf(u: AuthUser) {
    return this.prisma.representative.findUnique({ where: { userId: u.id } });
  }

  async customerScope(u: AuthUser): Promise<Prisma.CustomerWhereInput> {
    if (can(u, 'customers.view_all')) return {};
    const rep = await this.repOf(u);
    if (!rep) return { id: { in: [] } };
    return { representatives: { some: { representativeId: rep.id, assignedTo: null } } };
  }
}

@Global()
@Module({ providers: [ScopeService], exports: [ScopeService] })
export class ScopeModule {}

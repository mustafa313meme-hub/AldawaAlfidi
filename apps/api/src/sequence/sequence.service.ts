import { Global, Injectable, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';

@Injectable()
export class SequenceService {
  /**
   * Atomic next value for `key`. Call inside the same transaction that uses the number:
   * the row lock serialises concurrent callers, so no duplicates (SRS §47).
   */
  async next(key: string, tx: Prisma.TransactionClient): Promise<number> {
    const rows = await tx.$queryRaw<{ value: bigint }[]>`
      INSERT INTO sequences ("key", "value") VALUES (${key}, 1)
      ON CONFLICT ("key") DO UPDATE SET "value" = sequences."value" + 1
      RETURNING "value"`;
    return Number(rows[0].value);
  }
}

@Global()
@Module({ providers: [SequenceService], exports: [SequenceService] })
export class SequenceModule {}

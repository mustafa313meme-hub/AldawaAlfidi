import { createHash, randomBytes } from 'crypto';

export const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');
export const newOpaqueToken = (bytes = 48): string => randomBytes(bytes).toString('base64url');

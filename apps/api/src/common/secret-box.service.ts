import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';

/**
 * Authenticated encryption for secrets that must live in Postgres (currently
 * per-workspace PayPal client secrets). AES-256-GCM, random 96-bit IV per
 * value, key from `PAYPAL_SECRET_ENC_KEY` (32 bytes, base64).
 *
 * Legacy plaintext rows are returned unchanged so a deploy can roll out
 * before the backfill runs; callers re-encrypt them on first read.
 */
@Injectable()
export class SecretBoxService {
  private cachedKey?: Buffer;

  constructor(private readonly config: ConfigService) {}

  private key(): Buffer {
    if (this.cachedKey) return this.cachedKey;
    const raw = this.config.get<string>('PAYPAL_SECRET_ENC_KEY')?.trim();
    if (!raw) {
      throw new Error(
        'PAYPAL_SECRET_ENC_KEY is not set (32-byte base64 key required)',
      );
    }
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) {
      throw new Error('PAYPAL_SECRET_ENC_KEY must decode to exactly 32 bytes');
    }
    this.cachedKey = key;
    return key;
  }

  isEncrypted(value?: string | null): boolean {
    return typeof value === 'string' && value.startsWith(PREFIX);
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, this.key(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(plain, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
  }

  decrypt(stored: string): string {
    if (!this.isEncrypted(stored)) return stored;
    const [iv, tag, data] = stored.slice(PREFIX.length).split(':');
    if (!iv || !tag || !data) {
      throw new Error('malformed encrypted secret');
    }
    const decipher = createDecipheriv(
      ALGO,
      this.key(),
      Buffer.from(iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}

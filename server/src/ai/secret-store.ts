import crypto from 'node:crypto';

const algorithm = 'aes-256-gcm';
const keyFor = (secret: string) => crypto.createHash('sha256').update(secret).digest();

export class SecretStore {
  constructor(private readonly secret: string | undefined) {}
  private key() { if (!this.secret) throw new Error('API_TOKEN or AI_SECRETS_KEY must be configured before saving an AI provider key.'); return keyFor(this.secret); }
  encrypt(value: string) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv(algorithm, this.key(), iv); const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); const tag = cipher.getAuthTag(); return Buffer.concat([iv, tag, encrypted]).toString('base64'); }
  decrypt(value: string) { const source = Buffer.from(value, 'base64'); const iv = source.subarray(0, 12); const tag = source.subarray(12, 28); const encrypted = source.subarray(28); const decipher = crypto.createDecipheriv(algorithm, this.key(), iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'); }
}

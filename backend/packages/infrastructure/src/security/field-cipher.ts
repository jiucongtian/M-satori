import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class FieldCipher {
  private readonly key: Buffer;

  constructor(encryptionKey: string) {
    this.key = Buffer.from(encryptionKey, 'hex');
  }

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
  }

  decrypt(value: string): string {
    const [ivValue, tagValue, ciphertextValue] = value.split('.');
    if (!ivValue || !tagValue || !ciphertextValue) throw new Error('Invalid encrypted value');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}

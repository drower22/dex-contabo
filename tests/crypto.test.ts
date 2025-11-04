/**
 * @file tests/crypto.test.ts
 * @description Testes para módulo de criptografia
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { encryptToB64, decryptFromB64 } from '../api/_shared/crypto';
import { notifyTest } from '../api/_shared/discord';

describe('Crypto Module', () => {
  beforeAll(() => {
    // Gera chave de teste se não existir
    if (!process.env.ENCRYPTION_KEY) {
      const crypto = require('crypto');
      process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    }
  });

  it('should encrypt and decrypt correctly', async () => {
    const startTime = Date.now();
    const plaintext = 'test-token-123';

    try {
      const encrypted = await encryptToB64(plaintext);
      const decrypted = await decryptFromB64(encrypted);

      expect(decrypted).toBe(plaintext);
      expect(encrypted).not.toBe(plaintext);

      const duration = (Date.now() - startTime) / 1000;
      await notifyTest('Crypto: Encrypt/Decrypt', true, 'Token criptografado e descriptografado com sucesso', duration);
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      await notifyTest('Crypto: Encrypt/Decrypt', false, (error as Error).message, duration);
      throw error;
    }
  });

  it('should generate different ciphertexts for same input', async () => {
    const startTime = Date.now();
    const plaintext = 'test';

    try {
      const encrypted1 = await encryptToB64(plaintext);
      const encrypted2 = await encryptToB64(plaintext);

      expect(encrypted1).not.toBe(encrypted2);

      const decrypted1 = await decryptFromB64(encrypted1);
      const decrypted2 = await decryptFromB64(encrypted2);

      expect(decrypted1).toBe(plaintext);
      expect(decrypted2).toBe(plaintext);

      const duration = (Date.now() - startTime) / 1000;
      await notifyTest('Crypto: Unique IV', true, 'IVs únicos gerados corretamente', duration);
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      await notifyTest('Crypto: Unique IV', false, (error as Error).message, duration);
      throw error;
    }
  });

  it('should fail with wrong key', async () => {
    const startTime = Date.now();

    try {
      const encrypted = await encryptToB64('test');
      const originalKey = process.env.ENCRYPTION_KEY;

      // Muda a chave
      const crypto = require('crypto');
      process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');

      await expect(decryptFromB64(encrypted)).rejects.toThrow();

      // Restaura chave original
      process.env.ENCRYPTION_KEY = originalKey;

      const duration = (Date.now() - startTime) / 1000;
      await notifyTest('Crypto: Wrong Key', true, 'Descriptografia falhou corretamente com chave errada', duration);
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      await notifyTest('Crypto: Wrong Key', false, (error as Error).message, duration);
      throw error;
    }
  });

  it('should handle empty string', async () => {
    const startTime = Date.now();

    try {
      const encrypted = await encryptToB64('');
      const decrypted = await decryptFromB64(encrypted);

      expect(decrypted).toBe('');

      const duration = (Date.now() - startTime) / 1000;
      await notifyTest('Crypto: Empty String', true, 'String vazia tratada corretamente', duration);
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      await notifyTest('Crypto: Empty String', false, (error as Error).message, duration);
      throw error;
    }
  });

  it('should handle long strings', async () => {
    const startTime = Date.now();
    const longString = 'a'.repeat(10000);

    try {
      const encrypted = await encryptToB64(longString);
      const decrypted = await decryptFromB64(encrypted);

      expect(decrypted).toBe(longString);

      const duration = (Date.now() - startTime) / 1000;
      await notifyTest('Crypto: Long String', true, 'String longa (10k chars) criptografada com sucesso', duration);
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      await notifyTest('Crypto: Long String', false, (error as Error).message, duration);
      throw error;
    }
  });
});

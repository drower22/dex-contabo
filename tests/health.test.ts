/**
 * @file tests/health.test.ts
 * @description Testes para health check endpoint
 */
import { describe, it, expect } from 'vitest';
import { TEST_CONFIG } from './setup';
import { notifyTest } from '../api/_shared/discord';

describe('Health Check Endpoint', () => {
  it('should return healthy status', async () => {
    const startTime = Date.now();

    try {
      const response = await fetch(`${TEST_CONFIG.baseUrl}/api/ifood-auth/health`);
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.status).toBe('healthy');
      expect(data.checks).toBeDefined();
      expect(data.checks.supabase).toBe(true);
      expect(data.checks.encryption).toBe(true);

      const duration = (Date.now() - startTime) / 1000;
      await notifyTest(
        'Health Check',
        true,
        `Todos os checks passaram: ${JSON.stringify(data.checks)}`,
        duration
      );
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      await notifyTest('Health Check', false, (error as Error).message, duration);
      throw error;
    }
  }, TEST_CONFIG.timeout);

  it('should validate Supabase connection', async () => {
    const startTime = Date.now();

    try {
      const response = await fetch(`${TEST_CONFIG.baseUrl}/api/ifood-auth/health`);
      const data = await response.json();

      expect(data.checks.supabase).toBe(true);

      const duration = (Date.now() - startTime) / 1000;
      await notifyTest('Health: Supabase', true, 'Conexão com Supabase OK', duration);
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      await notifyTest('Health: Supabase', false, (error as Error).message, duration);
      throw error;
    }
  }, TEST_CONFIG.timeout);

  it('should validate encryption', async () => {
    const startTime = Date.now();

    try {
      const response = await fetch(`${TEST_CONFIG.baseUrl}/api/ifood-auth/health`);
      const data = await response.json();

      expect(data.checks.encryption).toBe(true);

      const duration = (Date.now() - startTime) / 1000;
      await notifyTest('Health: Encryption', true, 'Criptografia funcionando', duration);
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      await notifyTest('Health: Encryption', false, (error as Error).message, duration);
      throw error;
    }
  }, TEST_CONFIG.timeout);

  it('should validate iFood credentials', async () => {
    const startTime = Date.now();

    try {
      const response = await fetch(`${TEST_CONFIG.baseUrl}/api/ifood-auth/health`);
      const data = await response.json();

      expect(data.checks.ifood_reviews).toBe(true);

      const duration = (Date.now() - startTime) / 1000;
      await notifyTest('Health: iFood Credentials', true, 'Credenciais iFood válidas', duration);
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      await notifyTest('Health: iFood Credentials', false, (error as Error).message, duration);
      throw error;
    }
  }, TEST_CONFIG.timeout);
});

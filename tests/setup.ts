/**
 * @file tests/setup.ts
 * @description Configuração global dos testes
 */
import { config } from 'dotenv';

// Carrega variáveis de ambiente
config();

// Configurações globais de teste
export const TEST_CONFIG = {
  accountId: process.env.TEST_ACCOUNT_ID || '550e8400-e29b-41d4-a716-446655440000',
  merchantId: process.env.TEST_MERCHANT_ID || 'test-merchant-id',
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  timeout: 30000, // 30 segundos
};

// Mock do Discord se não configurado
if (!process.env.DISCORD_WEBHOOK_URL) {
  process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/mock';
}

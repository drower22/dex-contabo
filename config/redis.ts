import Redis from 'ioredis';

// Configuração do Redis
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;

// Criar conexão Redis
export const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  maxRetriesPerRequest: null, // Necessário para BullMQ
  enableReadyCheck: false,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

// Log de conexão
redis.on('connect', () => {
  console.log('✅ Redis conectado');
});

redis.on('error', (err: Error) => {
  console.error('❌ Erro no Redis:', err);
});

export default redis;

/**
 * Rate Limiter para controlar requisições à API do iFood
 * 
 * OBJETIVO:
 * - Evitar atingir rate limits da API do iFood
 * - Distribuir requisições ao longo do tempo
 * - Suportar 1000+ contas sem bloqueios
 * 
 * CONFIGURAÇÃO:
 * - maxConcurrent: Máximo de requisições simultâneas
 * - minDelay: Delay mínimo entre requisições (ms)
 */

export class RateLimiter {
  private queue: Array<() => Promise<void>> = [];
  private running = 0;
  private lastRequestTime = 0;

  constructor(
    private maxConcurrent: number = 20,
    private minDelayMs: number = 50 // 50ms = 20 req/s
  ) {}

  /**
   * Executa uma função respeitando rate limits
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const task = async () => {
        try {
          // Garantir delay mínimo entre requisições
          const now = Date.now();
          const timeSinceLastRequest = now - this.lastRequestTime;
          if (timeSinceLastRequest < this.minDelayMs) {
            await this.sleep(this.minDelayMs - timeSinceLastRequest);
          }

          this.lastRequestTime = Date.now();
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.running--;
          this.processQueue();
        }
      };

      this.queue.push(task);
      this.processQueue();
    });
  }

  private processQueue() {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        this.running++;
        task();
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Retorna estatísticas do rate limiter
   */
  getStats() {
    return {
      running: this.running,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      minDelayMs: this.minDelayMs,
    };
  }
}

/**
 * Rate Limiter global para workers iFood
 * 
 * CONFIGURAÇÃO PADRÃO:
 * - 20 requisições simultâneas
 * - 50ms de delay mínimo (20 req/s)
 * - Total: ~1200 req/min (dentro do limite seguro do iFood)
 */
export const ifoodRateLimiter = new RateLimiter(20, 50);

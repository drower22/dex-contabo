/**
 * @file api/_shared/discord.ts
 * @description Cliente Discord para alertas e notificações
 */

export interface DiscordField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: DiscordField[];
  footer?: {
    text: string;
  };
  timestamp?: string;
}

export interface DiscordMessage {
  content?: string;
  embeds?: DiscordEmbed[];
}

export class DiscordNotifier {
  private webhookUrl: string | undefined;
  private enabled: boolean;

  constructor(webhookUrl?: string) {
    this.webhookUrl = webhookUrl || process.env.DISCORD_WEBHOOK_URL;
    this.enabled = !!this.webhookUrl;
  }

  async sendMessage(message: DiscordMessage): Promise<boolean> {
    if (!this.enabled || !this.webhookUrl) {
      console.log('[Discord] Webhook não configurado. Mensagem não enviada.');
      return false;
    }

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });

      if (response.status === 204) {
        return true;
      } else {
        const text = await response.text();
        console.error(`[Discord] Erro ao enviar: ${response.status} - ${text}`);
        return false;
      }
    } catch (error) {
      console.error('[Discord] Exceção ao enviar:', error);
      return false;
    }
  }

  async sendError(
    error: Error | string,
    context?: Record<string, any>,
    title: string = '🚨 Erro Detectado'
  ): Promise<boolean> {
    const errorMessage = error instanceof Error ? error.message : error;
    const errorStack = error instanceof Error ? error.stack : undefined;

    const fields: DiscordField[] = [
      {
        name: 'Erro',
        value: `\`\`\`${errorMessage.substring(0, 1000)}\`\`\``,
        inline: false,
      },
    ];

    if (context) {
      for (const [key, value] of Object.entries(context)) {
        fields.push({
          name: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          value: `\`${String(value).substring(0, 100)}\``,
          inline: true,
        });
      }
    }

    if (errorStack) {
      fields.push({
        name: 'Stack Trace',
        value: `\`\`\`\n${errorStack.substring(0, 1000)}\`\`\``,
        inline: false,
      });
    }

    return this.sendMessage({
      embeds: [
        {
          title,
          color: 0xff0000, // Vermelho
          fields,
          footer: {
            text: `Ambiente: ${process.env.VERCEL_ENV || 'local'} | ${new Date().toISOString()}`,
          },
          timestamp: new Date().toISOString(),
        },
      ],
    });
  }

  async sendSuccess(
    message: string,
    context?: Record<string, any>,
    title: string = '✅ Sucesso'
  ): Promise<boolean> {
    const fields: DiscordField[] = [];

    if (context) {
      for (const [key, value] of Object.entries(context)) {
        fields.push({
          name: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          value: `\`${String(value)}\``,
          inline: true,
        });
      }
    }

    return this.sendMessage({
      embeds: [
        {
          title,
          description: message,
          color: 0x00ff00, // Verde
          fields: fields.length > 0 ? fields : undefined,
          footer: {
            text: new Date().toISOString(),
          },
          timestamp: new Date().toISOString(),
        },
      ],
    });
  }

  async sendWarning(
    message: string,
    context?: Record<string, any>,
    title: string = '⚠️ Aviso'
  ): Promise<boolean> {
    const fields: DiscordField[] = [];

    if (context) {
      for (const [key, value] of Object.entries(context)) {
        fields.push({
          name: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          value: `\`${String(value)}\``,
          inline: true,
        });
      }
    }

    return this.sendMessage({
      embeds: [
        {
          title,
          description: message,
          color: 0xffa500, // Laranja
          fields: fields.length > 0 ? fields : undefined,
          footer: {
            text: new Date().toISOString(),
          },
          timestamp: new Date().toISOString(),
        },
      ],
    });
  }

  async sendTestResult(
    testName: string,
    passed: boolean,
    details?: string,
    duration?: number
  ): Promise<boolean> {
    const status = passed ? '✅ PASSOU' : '❌ FALHOU';
    const color = passed ? 0x00ff00 : 0xff0000;

    const fields: DiscordField[] = [
      {
        name: 'Status',
        value: status,
        inline: true,
      },
    ];

    if (duration !== undefined) {
      fields.push({
        name: 'Duração',
        value: `${duration.toFixed(2)}s`,
        inline: true,
      });
    }

    if (details) {
      fields.push({
        name: 'Detalhes',
        value: `\`\`\`${details.substring(0, 1000)}\`\`\``,
        inline: false,
      });
    }

    return this.sendMessage({
      embeds: [
        {
          title: `Teste: ${testName}`,
          color,
          fields,
          footer: {
            text: `Testes Automatizados | ${new Date().toISOString()}`,
          },
          timestamp: new Date().toISOString(),
        },
      ],
    });
  }

  async sendDeployment(
    version: string,
    status: 'success' | 'failure',
    details?: Record<string, any>
  ): Promise<boolean> {
    const emoji = status === 'success' ? '🚀' : '💥';
    const color = status === 'success' ? 0x00ff00 : 0xff0000;

    const fields: DiscordField[] = [
      {
        name: 'Versão',
        value: `\`${version}\``,
        inline: true,
      },
      {
        name: 'Status',
        value: status.toUpperCase(),
        inline: true,
      },
    ];

    if (details) {
      for (const [key, value] of Object.entries(details)) {
        fields.push({
          name: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          value: `\`${String(value)}\``,
          inline: true,
        });
      }
    }

    return this.sendMessage({
      embeds: [
        {
          title: `${emoji} Deploy ${status.toUpperCase()}`,
          color,
          fields,
          footer: {
            text: `Deploy | ${new Date().toISOString()}`,
          },
          timestamp: new Date().toISOString(),
        },
      ],
    });
  }
}

// Instância global
export const discord = new DiscordNotifier();

// Funções de conveniência
export const notifyError = (error: Error | string, context?: Record<string, any>) =>
  discord.sendError(error, context);

export const notifySuccess = (message: string, context?: Record<string, any>) =>
  discord.sendSuccess(message, context);

export const notifyWarning = (message: string, context?: Record<string, any>) =>
  discord.sendWarning(message, context);

export const notifyTest = (
  testName: string,
  passed: boolean,
  details?: string,
  duration?: number
) => discord.sendTestResult(testName, passed, details, duration);

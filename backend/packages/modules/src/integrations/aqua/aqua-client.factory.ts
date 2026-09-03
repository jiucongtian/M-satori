import { Injectable } from '@nestjs/common';
import { AquaAIClient } from '@aqua-ai/sdk';
import { RuntimeInfrastructure } from '@satori/infrastructure';

/**
 * Aqua 基础连接的唯一创建入口。
 *
 * 所有 Workflow 共用同一租户地址和 Service Key；业务模块只能传入请求超时等调用级策略，
 * 不得自行读取环境变量或重复组装认证信息。
 */
@Injectable()
export class AquaClientFactory {
  private readonly clients = new Map<string, AquaAIClient>();

  constructor(private readonly infrastructure: RuntimeInfrastructure) {}

  create(options: { timeoutMs?: number } = {}): AquaAIClient {
    const cacheKey = options.timeoutMs === undefined ? 'default' : `timeout:${options.timeoutMs}`;
    const existing = this.clients.get(cacheKey);
    if (existing) return existing;

    const environment = this.infrastructure.environment;
    const client = new AquaAIClient({
      baseUrl: environment.AQUA_BASE_URL,
      auth: { type: 'serviceKey', serviceKey: environment.AQUA_SERVICE_KEY },
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
    this.clients.set(cacheKey, client);
    return client;
  }
}

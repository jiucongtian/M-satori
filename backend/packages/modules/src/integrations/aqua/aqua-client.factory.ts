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
  constructor(private readonly infrastructure: RuntimeInfrastructure) {}

  create(options: { timeoutMs?: number } = {}): AquaAIClient {
    const environment = this.infrastructure.environment;
    return new AquaAIClient({
      baseUrl: environment.AQUA_BASE_URL,
      auth: { type: 'serviceKey', serviceKey: environment.AQUA_SERVICE_KEY },
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
  }
}

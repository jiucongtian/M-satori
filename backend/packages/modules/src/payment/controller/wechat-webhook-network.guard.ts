import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { WECHAT_WEBHOOK_ALLOWED_IPS } from '../application/index.js';

@Injectable()
export class WechatWebhookNetworkGuard implements CanActivate {
  constructor(@Inject(WECHAT_WEBHOOK_ALLOWED_IPS) private readonly allowed: ReadonlySet<string>) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!this.allowed.has(request.ip)) {
      throw new ForbiddenException({ code: 'WECHAT_WEBHOOK_NETWORK_FORBIDDEN' });
    }
    return true;
  }
}

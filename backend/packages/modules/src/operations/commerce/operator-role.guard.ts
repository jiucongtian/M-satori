import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { operatorRoles, RuntimeInfrastructure } from '@satori/infrastructure';
import { and, eq, isNull } from 'drizzle-orm';
import type { AuthenticatedRequest } from '../../identity/auth/authenticated-request.js';

@Injectable()
export class OperatorRoleGuard implements CanActivate {
  constructor(private readonly infrastructure: RuntimeInfrastructure) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if ((request as AuthenticatedRequest & { operationsService?: boolean }).operationsService) return true;
    const [role] = await this.infrastructure.database
      .select({ role: operatorRoles.role })
      .from(operatorRoles)
      .where(and(eq(operatorRoles.userId, request.auth.userId), isNull(operatorRoles.revokedAt)))
      .limit(1);
    if (!role) {
      throw new ForbiddenException({ code: 'OPERATOR_ROLE_REQUIRED', message: 'Operator role is required' });
    }
    return true;
  }
}

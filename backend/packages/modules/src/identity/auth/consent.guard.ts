import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConflictException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CONSENT_EXEMPT_ROUTE, PUBLIC_ROUTE } from '@satori/contracts';
import { consentRecords, legalDocuments, RuntimeInfrastructure } from '@satori/infrastructure';
import { and, eq, inArray } from 'drizzle-orm';
import type { AuthenticatedRequest } from './authenticated-request.js';

@Injectable()
export class ConsentGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly infrastructure: RuntimeInfrastructure,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets) ||
      this.reflector.getAllAndOverride<boolean>(CONSENT_EXEMPT_ROUTE, targets)
    ) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // A verified operations-service credential is accepted only on the restricted
    // operations commerce routes by AccessTokenGuard. It is a machine identity,
    // not an end user, so it cannot and must not accept user legal documents.
    if ((request as AuthenticatedRequest & { operationsService?: boolean }).operationsService) return true;
    const required = await this.infrastructure.database
      .select()
      .from(legalDocuments)
      .where(eq(legalDocuments.required, true));
    if (required.length === 0) return true;
    const accepted = await this.infrastructure.database
      .select()
      .from(consentRecords)
      .where(
        and(
          eq(consentRecords.userId, request.auth.userId),
          inArray(
            consentRecords.documentId,
            required.map((document) => document.documentId),
          ),
        ),
      );
    const missing = required.filter(
      (document) =>
        !accepted.some(
          (record) =>
            record.documentId === document.documentId && record.documentVersion === document.version,
        ),
    );
    if (missing.length > 0) {
      throw new ConflictException({
        code: 'CONSENT_REQUIRED',
        message: 'Current legal documents must be accepted',
        details: { documentIds: missing.map((document) => document.documentId) },
      });
    }
    return true;
  }
}

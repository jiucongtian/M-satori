import type { FastifyRequest } from 'fastify';

export interface AuthenticationContext {
  userId: string;
  sessionId: string;
}

export type AuthenticatedRequest = FastifyRequest & { auth: AuthenticationContext };

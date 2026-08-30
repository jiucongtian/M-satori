import { SetMetadata } from '@nestjs/common';

export const PUBLIC_ROUTE = 'satori.publicRoute';
export const CONSENT_EXEMPT_ROUTE = 'satori.consentExemptRoute';

export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const ConsentExempt = () => SetMetadata(CONSENT_EXEMPT_ROUTE, true);

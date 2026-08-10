/**
 * Compatibility aliases for the original R1 frontend prototypes.
 * The source of truth is generated.ts, generated from backend/openapi/openapi.yaml.
 */
import type { components } from "./generated";

export type WisdomSeedAccount = components["schemas"]["WisdomSeedAccount"];
export type WisdomSeedTransaction = components["schemas"]["WisdomSeedTransaction"];
export type WisdomSeedTransactionType = WisdomSeedTransaction["type"];
export type RegistrationReward = components["schemas"]["RegistrationReward"];
export type LifeProfileListItem = components["schemas"]["LifeProfile"];
export type SeedSettlement = components["schemas"]["SeedSettlement"];

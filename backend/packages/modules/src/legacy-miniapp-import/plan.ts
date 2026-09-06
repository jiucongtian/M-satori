import { z } from 'zod';
import type { BirthInput, BirthChartResult, StandardLocation } from '@satori/application';
import { ReferenceBirthChartCalculator } from '../astrology/reference-birth-chart.calculator.js';
import { LocalLocationProvider } from '../integrations/locations/location.provider.js';
import { assessSource, digest, object, type RecordData, type SourceData } from './source.js';

const userMapping = z
  .object({
    sourceUserId: z.string().min(1),
    targetUserId: z.uuid(),
    verification: z
      .object({ method: z.enum(['MINIAPP_CLAIM', 'MANUAL_REVIEW']), reference: z.string().min(1).max(200) })
      .strict(),
  })
  .strict();
const profileMapping = z
  .object({
    sourceProfileId: z.string().min(1),
    subjectType: z.literal('OTHER').default('OTHER'),
    relationshipType: z.literal('FRIEND').default('FRIEND'),
    locationId: z.string().min(1),
    timePrecision: z.enum(['EXACT_MINUTE', 'APPROXIMATE', 'HOUR_RANGE', 'DATE_ONLY']),
    hourBranchCode: z
      .enum(['ZI', 'CHOU', 'YIN', 'MAO', 'CHEN', 'SI', 'WU', 'WEI', 'SHEN', 'YOU', 'XU', 'HAI'])
      .optional(),
    confirmed: z.literal(true),
    acceptRecalculatedCards: z.boolean().default(false),
  })
  .strict();
export const mappingSchema = z
  .object({
    version: z.literal(1),
    namespace: z.string(),
    users: z.array(userMapping),
    profiles: z.array(profileMapping),
  })
  .strict();
export type Mapping = z.infer<typeof mappingSchema>;
export interface PlannedProfile {
  sourceProfileId: string;
  sourceUserId: string;
  targetUserId: string;
  displayName: string;
  subjectType: 'OTHER';
  relationshipType: 'FRIEND';
  birthInput: BirthInput;
  location: StandardLocation;
  chart: BirthChartResult;
  changedPillars: string[];
  sourceHash: string;
  planHash: string;
  verificationHash: string;
  original: RecordData;
}
export interface ImportPlan {
  namespace: string;
  profiles: PlannedProfile[];
  sourceHash: string;
}

/** Every legacy profile is an OTHER/FRIEND archive entry; ownership and birth location still require review. */
export async function buildPlan(source: SourceData, rawMapping: unknown): Promise<ImportPlan> {
  const mapping = mappingSchema.parse(rawMapping);
  if (mapping.namespace !== source.namespace) throw new Error('NAMESPACE_MISMATCH');
  const assessment = assessSource(source);
  const assessed = new Map(assessment.profiles.map((profile) => [profile.sourceProfileId, profile]));
  const originals = new Map(source.profiles.map((profile) => [profile._id, profile]));
  const sourceUsers = new Map(source.users.map((user) => [user._id, user]));
  const owners = new Map<string, Mapping['users'][number]>();
  const targets = new Set<string>();
  for (const user of mapping.users) {
    if (owners.has(user.sourceUserId) || targets.has(user.targetUserId))
      throw new Error('DUPLICATE_ACCOUNT_MAPPING');
    if (sourceUsers.get(user.sourceUserId)?.isActive !== true) throw new Error('INVALID_SOURCE_USER_MAPPING');
    owners.set(user.sourceUserId, user);
    targets.add(user.targetUserId);
  }
  const locations = new LocalLocationProvider();
  const calculator = new ReferenceBirthChartCalculator();
  const selected = new Set<string>();
  const profiles: PlannedProfile[] = [];
  for (const selection of mapping.profiles) {
    if (selected.has(selection.sourceProfileId)) throw new Error('DUPLICATE_PROFILE_SELECTION');
    selected.add(selection.sourceProfileId);
    const candidate = assessed.get(selection.sourceProfileId);
    const original = originals.get(selection.sourceProfileId);
    if (!candidate || !original || candidate.disposition !== 'ELIGIBLE')
      throw new Error('PROFILE_NOT_ELIGIBLE');
    const owner = owners.get(candidate.sourceUserId);
    if (!owner) throw new Error('VERIFIED_OWNER_MAPPING_REQUIRED');
    if (original.isUncertainTime === true && selection.timePrecision !== 'DATE_ONLY') {
      throw new Error('UNKNOWN_TIME_MUST_REMAIN_DATE_ONLY');
    }
    if ((selection.timePrecision === 'HOUR_RANGE') !== Boolean(selection.hourBranchCode)) {
      throw new Error('HOUR_BRANCH_PRECISION_MISMATCH');
    }
    const location = await locations.get(selection.locationId);
    if (!location) throw new Error('LOCATION_NOT_FOUND');
    const birthInput: BirthInput = {
      ...candidate.birthDraft,
      locationId: location.locationId,
      timePrecision: selection.timePrecision,
      time: {
        localTime: ['DATE_ONLY', 'HOUR_RANGE'].includes(selection.timePrecision)
          ? null
          : candidate.originalLocalTime,
        hourBranchCode: selection.hourBranchCode ?? null,
      },
    };
    const chart = calculator.calculate(birthInput, location);
    const bazi = object(original.baziData);
    const changedPillars = (['year', 'month', 'day', 'hour'] as const).filter((key) => {
      const pillar = object(bazi[key]);
      return `${String(pillar.gan)}${String(pillar.zhi)}` !== chart.calculationPreview.pillars[key];
    });
    if (changedPillars.length && !selection.acceptRecalculatedCards)
      throw new Error('RECALCULATED_CARDS_REQUIRE_ACCEPTANCE');
    const sourceHash = digest(original);
    const content = {
      sourceProfileId: candidate.sourceProfileId,
      sourceUserId: candidate.sourceUserId,
      targetUserId: owner.targetUserId,
      displayName: String(original.profileName),
      subjectType: selection.subjectType,
      relationshipType: selection.relationshipType,
      birthInput,
      location,
      chart,
      changedPillars,
      sourceHash,
      verificationHash: digest(owner.verification),
    };
    profiles.push({ ...content, planHash: digest(content), original });
  }
  return { namespace: source.namespace, profiles, sourceHash: digest(source) };
}

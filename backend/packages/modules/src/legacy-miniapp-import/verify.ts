import { v5 as uuidv5 } from 'uuid';
import { assessSource, digest, object, type SourceData } from './source.js';
import { buildPlan, type Mapping } from './plan.js';

/** Test missing user/location information in memory only. Never emit this mapping as an import file. */
export async function verifyArchive(source: SourceData) {
  const originalHash = digest(source);
  const assessment = assessSource(source);
  const eligible = assessment.profiles.filter((profile) => profile.disposition === 'ELIGIBLE');
  const originals = new Map(source.profiles.map((profile) => [profile._id, profile]));
  const mapping: Mapping = {
    version: 1,
    namespace: source.namespace,
    users: [...new Set(eligible.map((profile) => profile.sourceUserId))].map((sourceUserId) => ({
      sourceUserId,
      targetUserId: uuidv5(sourceUserId, '9b6835dc-0a54-4bfa-a2f7-f5d03478602a'),
      verification: { method: 'MANUAL_REVIEW', reference: 'SYNTHETIC-VALIDATION-ONLY-NOT-A-CLAIM' },
    })),
    profiles: eligible.map((profile) => ({
      sourceProfileId: profile.sourceProfileId,
      subjectType: 'OTHER',
      relationshipType: 'OTHER',
      locationId: 'loc_cn_110000',
      timePrecision:
        originals.get(profile.sourceProfileId)!.isUncertainTime === true ? 'DATE_ONLY' : 'APPROXIMATE',
      confirmed: true,
      acceptRecalculatedCards: true,
    })),
  };
  const plan = await buildPlan(source, mapping);
  let changedCardProfiles = 0;
  let changedKnownTimeProfiles = 0;
  const changedPillarCounts: Record<string, number> = {};
  for (const profile of plan.profiles) {
    const original = originals.get(profile.sourceProfileId)!;
    const birth = object(original.birthDate);
    if (
      digest(profile.original) !== digest(original) ||
      profile.birthInput.date.year !== birth.year ||
      profile.birthInput.date.month !== birth.month ||
      profile.birthInput.date.day !== birth.day ||
      profile.birthInput.date.isLeapMonth !== (birth.isLeapMonth === true) ||
      profile.birthInput.calendarType !== (birth.isLunar ? 'LUNAR' : 'SOLAR') ||
      profile.birthInput.calculationGender !== (original.gender === 1 ? 'MALE' : 'FEMALE')
    ) {
      throw new Error('SOURCE_PRESERVATION_FAILED');
    }
    if (profile.changedPillars.length) {
      changedCardProfiles += 1;
      if (original.isUncertainTime !== true) changedKnownTimeProfiles += 1;
      for (const pillar of profile.changedPillars)
        changedPillarCounts[pillar] = (changedPillarCounts[pillar] ?? 0) + 1;
    }
  }
  if (digest(source) !== originalHash) throw new Error('SOURCE_MUTATED');
  return {
    mode: 'OFFLINE_SYNTHETIC_CONTEXT_VALIDATION',
    sourceHash: originalHash,
    ...assessment.summary,
    calculatedProfiles: plan.profiles.length,
    preservedOriginalProfiles: source.profiles.length,
    preservedOriginalUsers: source.users.length,
    changedCardProfiles,
    changedKnownTimeProfiles,
    changedUnknownTimeProfiles: changedCardProfiles - changedKnownTimeProfiles,
    changedPillarCounts,
    assumedLocationForTestingOnly: 'loc_cn_110000',
    verifiedRealAccounts: 0,
    importedProfiles: 0,
    note: '全量计算使用内存中的合成目标账号和测试出生地；不构成真实认领或正式导入，未输出可执行映射。',
  };
}

import { ReferenceBirthChartCalculator } from '../astrology/reference-birth-chart.calculator.js';
import { LocalLocationProvider } from '../integrations/locations/location.provider.js';
import type { Mapping } from './plan.js';
import type { SourceData } from './source.js';

/** Synthetic records only. Never replace these with a production export. */
export async function syntheticSource(): Promise<SourceData> {
  const location = (await new LocalLocationProvider().get('loc_cn_110000'))!;
  const chart = new ReferenceBirthChartCalculator().calculate(
    {
      calendarType: 'SOLAR',
      date: { year: 1990, month: 6, day: 15, isLeapMonth: false },
      timePrecision: 'EXACT_MINUTE',
      time: { localTime: '10:30', hourBranchCode: null },
      locationId: location.locationId,
      calculationGender: 'MALE',
    },
    location,
  );
  return {
    version: 1,
    namespace: 'synthetic-miniapp',
    users: [{ _id: 'old-user', openid: 'synthetic-openid', isActive: true, phoneNumber: 'synthetic-phone' }],
    profiles: [
      {
        _id: 'old-profile',
        userId: 'old-user',
        openid: 'synthetic-openid',
        profileName: '测试档案',
        birthDate: {
          year: 1990,
          month: 6,
          day: 15,
          hour: 10,
          minute: 30,
          isLunar: false,
          isLeapMonth: false,
        },
        gender: 1,
        isUncertainTime: false,
        isActive: true,
        description: '仅用于合成测试的备注',
        createTime: { $date: '2024-01-02T03:04:05.000Z' },
        updateTime: { $date: '2025-02-03T04:05:06.000Z' },
        baziData: Object.fromEntries(
          Object.entries(chart.calculationPreview.pillars).map(([key, value]) => [
            key,
            { gan: value!.slice(0, 1), zhi: value!.slice(1), ganzhiIndex: 1 },
          ]),
        ),
      },
    ],
  };
}

export function syntheticMapping(targetUserId: string): Mapping {
  return {
    version: 1,
    namespace: 'synthetic-miniapp',
    users: [
      {
        sourceUserId: 'old-user',
        targetUserId,
        verification: { method: 'MANUAL_REVIEW', reference: 'SYNTHETIC-TEST-ONLY' },
      },
    ],
    profiles: [
      {
        sourceProfileId: 'old-profile',
        subjectType: 'OTHER',
        relationshipType: 'OTHER',
        locationId: 'loc_cn_110000',
        timePrecision: 'EXACT_MINUTE',
        confirmed: true,
        acceptRecalculatedCards: false,
      },
    ],
  };
}

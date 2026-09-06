import { createHash } from 'node:crypto';
import { Lunar, Solar } from 'lunar-typescript';
import type { BirthInput } from '@satori/application';

export type RecordData = Record<string, unknown>;
export interface SourceData {
  version: 1;
  namespace: string;
  users: RecordData[];
  profiles: RecordData[];
}
export interface ProfileAssessment {
  sourceProfileId: string;
  sourceUserId: string;
  disposition: 'ELIGIBLE' | 'DELETED' | 'QUARANTINED';
  issues: string[];
  birthDraft: Omit<BirthInput, 'locationId' | 'timePrecision' | 'time'>;
  originalLocalTime: string | null;
}

export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function object(value: unknown): RecordData {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordData) : {};
}

/** CloudBase exports are normally NDJSON with Extended JSON dates. Never flatten the originals. */
export function parseExport(text: string): RecordData[] {
  const clean = text.replace(/^\uFEFF/, '').trim();
  if (!clean) throw new Error('EMPTY_EXPORT');
  let value: unknown;
  try {
    value = JSON.parse(clean);
  } catch {
    value = clean
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line, index) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          throw new Error(`INVALID_JSON_LINE:${index + 1}`);
        }
      });
  }
  if (!Array.isArray(value)) {
    value = Array.isArray(object(value).data) ? object(value).data : [value];
  }
  if (!Array.isArray(value) || !value.every((item) => Object.keys(object(item)).length > 0)) {
    throw new Error('EXPORT_MUST_CONTAIN_OBJECTS');
  }
  return value as RecordData[];
}

export function sourceDate(value: unknown): Date | null {
  const raw = object(value).$date ?? value;
  const millis = object(raw).$numberLong;
  const date =
    typeof millis === 'string'
      ? new Date(Number(millis))
      : typeof raw === 'string' || typeof raw === 'number'
        ? new Date(raw)
        : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function requireUniqueIds(rows: RecordData[], table: string) {
  const ids = new Set<string>();
  for (const row of rows) {
    if (typeof row._id !== 'string' || !row._id) throw new Error(`MISSING_ID:${table}`);
    if (ids.has(row._id)) throw new Error(`DUPLICATE_ID:${table}`);
    ids.add(row._id);
  }
}

export function assessSource(source: SourceData) {
  if (source.version !== 1 || !/^[a-zA-Z0-9._:-]{1,80}$/.test(source.namespace)) {
    throw new Error('INVALID_SOURCE_NAMESPACE_OR_VERSION');
  }
  requireUniqueIds(source.users, 'users');
  requireUniqueIds(source.profiles, 'profiles');
  const users = new Map(source.users.map((user) => [user._id, user]));
  const openids = new Map<string, number>();
  const phones = new Map<string, number>();
  for (const user of source.users) {
    if (typeof user.openid === 'string' && user.openid)
      openids.set(user.openid, (openids.get(user.openid) ?? 0) + 1);
    if (typeof user.phoneNumber === 'string' && user.phoneNumber.trim()) {
      const phone = user.phoneNumber.trim();
      phones.set(phone, (phones.get(phone) ?? 0) + 1);
    }
  }
  const profiles: ProfileAssessment[] = source.profiles.map((profile) => {
    const issues: string[] = [];
    const blockers: string[] = [];
    const user = users.get(profile.userId);
    if (!user) {
      blockers.push('SOURCE_USER_NOT_FOUND');
      if (typeof profile.openid === 'string' && openids.has(profile.openid))
        issues.push('STALE_USER_ID_POSSIBLE');
    } else {
      if (user.isActive !== true) blockers.push('SOURCE_USER_NOT_ACTIVE');
      if (!profile.openid || profile.openid !== user.openid) blockers.push('OWNER_OPENID_MISMATCH');
      if (openids.get(String(user.openid)) !== 1) blockers.push('AMBIGUOUS_OPENID');
    }
    if (typeof profile.isActive !== 'boolean') blockers.push('ACTIVE_FLAG_INVALID');
    if (
      typeof profile.profileName !== 'string' ||
      !profile.profileName.trim() ||
      profile.profileName.length > 40
    ) {
      blockers.push('PROFILE_NAME_INVALID');
    }
    if (!sourceDate(profile.createTime) || !sourceDate(profile.updateTime))
      blockers.push('SOURCE_TIMESTAMP_INVALID');
    const birth = object(profile.birthDate);
    const { year, month, day, hour, minute, isLunar, isLeapMonth } = birth;
    if (typeof isLunar !== 'boolean' || (isLeapMonth !== undefined && typeof isLeapMonth !== 'boolean'))
      blockers.push('CALENDAR_INVALID');
    if (isLunar === true && isLeapMonth === undefined) blockers.push('LUNAR_LEAP_FLAG_MISSING');
    if (!isLunar && isLeapMonth === true) blockers.push('SOLAR_LEAP_FLAG_INVALID');
    if (profile.gender !== 0 && profile.gender !== 1) blockers.push('GENDER_INVALID');
    if (profile.isUncertainTime === undefined) issues.push('TIME_CERTAINTY_MISSING');
    else if (typeof profile.isUncertainTime !== 'boolean') blockers.push('TIME_CERTAINTY_INVALID');
    if (
      ![year, month, day, hour, minute].every(Number.isInteger) ||
      Number(year) < 1900 ||
      Number(year) > 2100 ||
      Number(month) < 1 ||
      Number(month) > 12 ||
      Number(day) < 1 ||
      Number(day) > 31 ||
      Number(hour) < 0 ||
      Number(hour) > 23 ||
      Number(minute) < 0 ||
      Number(minute) > 59
    )
      blockers.push('BIRTH_FIELDS_INVALID');
    else {
      try {
        if (isLunar) {
          Lunar.fromYmdHms(Number(year), isLeapMonth ? -Number(month) : Number(month), Number(day), 0, 0, 0);
        } else {
          const date = Solar.fromYmd(Number(year), Number(month), Number(day));
          const utc = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
          if (date.getDay() !== day || utc.getUTCMonth() + 1 !== month || utc.getUTCDate() !== day)
            throw new Error();
        }
      } catch {
        blockers.push('BIRTH_DATE_INVALID');
      }
    }
    const bazi = object(profile.baziData);
    if (
      !['year', 'month', 'day', 'hour'].every((key) => {
        const pillar = object(bazi[key]);
        return (
          typeof pillar.gan === 'string' &&
          typeof pillar.zhi === 'string' &&
          pillar.gan.length > 0 &&
          pillar.zhi.length > 0
        );
      })
    )
      blockers.push('LEGACY_CARDS_INVALID');
    issues.push('LOCATION_REQUIRED', 'TIME_PRECISION_CONFIRMATION_REQUIRED', ...blockers);
    return {
      sourceProfileId: String(profile._id),
      sourceUserId: typeof profile.userId === 'string' ? profile.userId : '',
      disposition: profile.isActive === false ? 'DELETED' : blockers.length ? 'QUARANTINED' : 'ELIGIBLE',
      issues,
      birthDraft: {
        calendarType: isLunar === true ? 'LUNAR' : 'SOLAR',
        date: {
          year: Number(year),
          month: Number(month),
          day: Number(day),
          isLeapMonth: isLeapMonth === true,
        },
        calculationGender: profile.gender === 1 ? 'MALE' : 'FEMALE',
      },
      originalLocalTime:
        Number.isInteger(hour) && Number.isInteger(minute)
          ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
          : null,
    };
  });
  const issueCounts: Record<string, number> = {};
  for (const profile of profiles)
    for (const issue of profile.issues) issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
  return {
    profiles,
    summary: {
      users: source.users.length,
      profiles: profiles.length,
      activeProfiles: source.profiles.filter((profile) => profile.isActive === true).length,
      deletedProfiles: profiles.filter((profile) => profile.disposition === 'DELETED').length,
      eligibleProfiles: profiles.filter((profile) => profile.disposition === 'ELIGIBLE').length,
      quarantinedProfiles: profiles.filter((profile) => profile.disposition === 'QUARANTINED').length,
      duplicatePhoneGroups: [...phones.values()].filter((count) => count > 1).length,
      duplicateOpenidGroups: [...openids.values()].filter((count) => count > 1).length,
      usersWithoutPhone: source.users.filter((user) => !user.phoneNumber).length,
      issueCounts,
    },
  };
}

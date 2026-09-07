import { Injectable, type OnModuleInit } from '@nestjs/common';
import { RuntimeInfrastructure } from '@satori/infrastructure';
import { join } from 'node:path';
import { v5 as uuidv5 } from 'uuid';
import { AuthCrypto } from '../identity/auth/auth.crypto.js';
import { loadArchive } from './archive.js';
import {
  assessSource,
  digest,
  normalizeMiniappPhone,
  object,
  type ProfileAssessment,
  type RecordData,
  type SourceData,
} from './source.js';

export { normalizeMiniappPhone } from './source.js';

// Shared with the reviewed CLI: an already imported profile can never be claimed a second time.
const markerNamespace = '3fc9fe91-b90b-4bd2-8f1b-f19aefad60df';
export const miniappProfileMarker = (namespace: string, profileId: string) =>
  uuidv5(`${namespace}:profile:${profileId}`, markerNamespace);

export interface MiniappCandidate {
  original: RecordData;
  assessment: ProfileAssessment;
  markerId: string;
}

export interface MiniappSourceMatch {
  source: SourceData;
  sourceHash: string;
  sourceUserId: string;
  profiles: MiniappCandidate[];
}

export interface MiniappProfileSource {
  source: 'MINIAPP';
  profileName: string;
  birthInput: ProfileAssessment['birthDraft'];
  originalLocalTime: string | null;
  timeUncertain: boolean;
  description: string;
  pillars: { year: string; month: string; day: string; hour: string };
}

type HistoricalSnapshot = { profile: MiniappProfileSource; sourceHash: string };

/** The encrypted archive is permanent source storage, never a public/static asset. */
@Injectable()
export class MiniappImportSource implements OnModuleInit {
  private matches = new Map<string, MiniappSourceMatch>();
  private originals = new Map<string, { candidate: MiniappCandidate; archiveHash: string }>();
  private historical = new Map<string, Map<string, HistoricalSnapshot>>();
  private currentArchive: { source: SourceData; sourceHash: string } | null = null;
  private historicalSources = new Map<string, SourceData>();
  private loadingHistory = new Map<string, Promise<Map<string, HistoricalSnapshot> | null>>();

  constructor(
    private readonly infrastructure: RuntimeInfrastructure,
    private readonly crypto: AuthCrypto,
  ) {}

  async onModuleInit() {
    this.matches.clear();
    this.originals.clear();
    this.historical.clear();
    this.currentArchive = null;
    this.historicalSources.clear();
    this.loadingHistory.clear();
    const { MINIAPP_IMPORT_ARCHIVE_PATH: archivePath, MINIAPP_IMPORT_KEY_PATH: keyPath } =
      this.infrastructure.environment;
    if (!archivePath && !keyPath) return;
    if (!archivePath || !keyPath) throw new Error('MINIAPP_IMPORT_ARCHIVE_AND_KEY_REQUIRED');
    const source = await loadArchive(archivePath, keyPath);
    const sourceHash = digest(source);
    this.currentArchive = { source, sourceHash };
    const originals = new Map(source.profiles.map((profile) => [String(profile._id), profile]));
    const profilesByUser = new Map<string, MiniappCandidate[]>();
    for (const assessment of assessSource(source).profiles) {
      if (assessment.disposition !== 'ELIGIBLE') continue;
      const candidate = {
        original: originals.get(assessment.sourceProfileId)!,
        assessment,
        markerId: miniappProfileMarker(source.namespace, assessment.sourceProfileId),
      };
      this.originals.set(candidate.markerId, { candidate, archiveHash: sourceHash });
      const list = profilesByUser.get(assessment.sourceUserId) ?? [];
      list.push(candidate);
      profilesByUser.set(assessment.sourceUserId, list);
    }
    const usersByPhone = new Map<string, RecordData[]>();
    for (const user of source.users) {
      const phone = normalizeMiniappPhone(user.phoneNumber);
      if (!phone) continue;
      const hash = this.crypto.hash(`phone:${phone}`);
      const list = usersByPhone.get(hash) ?? [];
      list.push(user);
      usersByPhone.set(hash, list);
    }
    for (const [hash, users] of usersByPhone) {
      // A reused number in two old accounts is not enough evidence to reveal either account's profiles.
      if (users.length !== 1 || users[0]!.isActive !== true) continue;
      const sourceUserId = String(users[0]!._id);
      const profiles = profilesByUser.get(sourceUserId) ?? [];
      if (profiles.length) this.matches.set(hash, { source, sourceHash, sourceUserId, profiles });
    }
  }

  match(phoneHash: string) {
    return this.matches.get(phoneHash) ?? null;
  }

  /** Resolves a persisted acceptance against its immutable source, independent of later phone changes. */
  async acceptedMatch(sourceUserHash: string, archiveHash: string): Promise<MiniappSourceMatch | null> {
    if (!/^[a-f\d]{64}$/.test(sourceUserHash) || !/^[a-f\d]{64}$/.test(archiveHash)) return null;
    let source = this.currentArchive?.sourceHash === archiveHash ? this.currentArchive.source : null;
    if (!source) {
      await this.history(archiveHash);
      source = this.historicalSources.get(archiveHash) ?? null;
    }
    if (!source) return null;
    const user = source.users.find((item) => digest([source.namespace, item._id]) === sourceUserHash);
    if (!user || user.isActive !== true) return null;
    const sourceUserId = String(user._id);
    const originals = new Map(source.profiles.map((profile) => [String(profile._id), profile]));
    const profiles = assessSource(source)
      .profiles.filter(
        (assessment) => assessment.disposition === 'ELIGIBLE' && assessment.sourceUserId === sourceUserId,
      )
      .map((assessment) => ({
        original: originals.get(assessment.sourceProfileId)!,
        assessment,
        markerId: miniappProfileMarker(source.namespace, assessment.sourceProfileId),
      }));
    return profiles.length ? { source, sourceHash: archiveHash, sourceUserId, profiles } : null;
  }

  async original(
    markerId: string,
    archiveHash: string,
    sourceHash?: string,
  ): Promise<MiniappProfileSource | null> {
    // Only content-addressed paths are permitted; never use a caller-supplied filesystem fragment.
    if (!/^[a-f\d]{64}$/.test(archiveHash) || (sourceHash !== undefined && !/^[a-f\d]{64}$/.test(sourceHash)))
      return null;
    const stored = this.originals.get(markerId);
    if (stored) {
      const matchingProfile = sourceHash === undefined || digest(stored.candidate.original) === sourceHash;
      if (matchingProfile && (stored.archiveHash === archiveHash || sourceHash !== undefined)) {
        return this.toProfileSource(stored.candidate);
      }
    }
    const archived = await this.history(archiveHash);
    const snapshot = archived?.get(markerId);
    if (!snapshot || (sourceHash !== undefined && snapshot.sourceHash !== sourceHash)) return null;
    return snapshot.profile;
  }

  private async history(archiveHash: string): Promise<Map<string, HistoricalSnapshot> | null> {
    const cached = this.historical.get(archiveHash);
    if (cached) return cached;
    const historyPath = this.infrastructure.environment.MINIAPP_IMPORT_HISTORY_PATH;
    if (!historyPath) return null;
    const pending = this.loadingHistory.get(archiveHash);
    if (pending) return pending;
    const loading = (async () => {
      try {
        const source = await loadArchive(
          join(historyPath, archiveHash, 'source.encrypted.json'),
          join(historyPath, archiveHash, 'archive.key'),
        );
        if (digest(source) !== archiveHash) return null;
        const originals = new Map(source.profiles.map((profile) => [String(profile._id), profile]));
        const snapshots = new Map<string, HistoricalSnapshot>();
        for (const assessment of assessSource(source).profiles) {
          if (assessment.disposition !== 'ELIGIBLE') continue;
          const original = originals.get(assessment.sourceProfileId)!;
          const markerId = miniappProfileMarker(source.namespace, assessment.sourceProfileId);
          snapshots.set(markerId, {
            profile: this.toProfileSource({ original, assessment, markerId }),
            sourceHash: digest(original),
          });
        }
        this.historicalSources.set(archiveHash, source);
        this.historical.set(archiveHash, snapshots);
        return snapshots;
      } catch {
        // Missing, corrupt or incorrectly keyed history is unavailable, never replaced with newer data.
        return null;
      } finally {
        this.loadingHistory.delete(archiveHash);
      }
    })();
    this.loadingHistory.set(archiveHash, loading);
    return loading;
  }

  private toProfileSource({ original, assessment }: MiniappCandidate): MiniappProfileSource {
    const bazi = object(original.baziData);
    const pillar = (name: string) => `${String(object(bazi[name]).gan)}${String(object(bazi[name]).zhi)}`;
    return {
      source: 'MINIAPP',
      profileName: String(original.profileName),
      birthInput: assessment.birthDraft,
      originalLocalTime: assessment.originalLocalTime,
      timeUncertain: original.isUncertainTime !== false,
      description: typeof original.description === 'string' ? original.description : '',
      pillars: { year: pillar('year'), month: pillar('month'), day: pillar('day'), hour: pillar('hour') },
    };
  }
}

import { SEXAGENARY_CYCLE, type ProfileFirstLookPosition } from '@satori/application';
import {
  PROFILE_POSITION_COPY,
  PROFILE_POSITION_COPY_SOURCE_SHA256,
} from './profile-position-copy.generated.js';

export const PROFILE_FIRST_LOOK_KNOWLEDGE_RELEASE = 'lianshanyi-profile/1.0.0';
export const PROFILE_FIRST_LOOK_RULE_VERSION = 'profile-season-rules/1.0.0';
export const PROFILE_FIRST_LOOK_COPY_VERSION = 'profile-first-look-copy/1.0.0';

export const SEASON_ORDER = ['春', '夏', '长夏', '秋', '冬'] as const;
export type ProfileSeason = (typeof SEASON_ORDER)[number];

export interface SeasonCopy {
  element: '木' | '火' | '土' | '金' | '水';
  virtue: '仁' | '礼' | '信' | '义' | '智';
  title: string;
  description: string;
  keywords: readonly string[];
  innerCopy: string;
  outerCopy: string;
}

export const SEASON_COPY: Record<ProfileSeason, SeasonCopy> = {
  春: {
    element: '木',
    virtue: '仁',
    title: '生发而有方向',
    description: '你对新事物保持好奇，愿意观察、尝试，并在持续生长中找到自己的方向。',
    keywords: ['生发', '好奇', '创新'],
    innerCopy: '内心保留着向上生长、不断尝试的动力',
    outerCopy: '给人主动开拓、愿意创造新可能的感觉',
  },
  夏: {
    element: '火',
    virtue: '礼',
    title: '明亮而有行动力',
    description: '你更容易以热情和行动回应世界，也愿意在重要时刻站出来表达与推动。',
    keywords: ['热情', '表达', '行动'],
    innerCopy: '内心有一股希望被看见、把事情推动起来的热度',
    outerCopy: '给人明快、有感染力、愿意付诸行动的感觉',
  },
  长夏: {
    element: '土',
    virtue: '信',
    title: '稳重而有承载',
    description: '你重视可靠、积累与长期价值，习惯先把基础安放稳妥，再等待合适的时机。',
    keywords: ['稳重', '承载', '积累'],
    innerCopy: '内心重视安稳、信任与可以长期依靠的基础',
    outerCopy: '给人踏实、包容、能够承接事情的感觉',
  },
  秋: {
    element: '金',
    virtue: '义',
    title: '清晰而有分寸',
    description: '你擅长观察、整理和判断，也会把精力放在真正重要并能形成结果的事情上。',
    keywords: ['清晰', '分寸', '结果'],
    innerCopy: '内心重视秩序、边界与确定感',
    outerCopy: '给人清醒、利落、善于判断取舍的感觉',
  },
  冬: {
    element: '水',
    virtue: '智',
    title: '沉静而有深度',
    description: '你更习惯先感受和思考，再决定如何行动，并能从变化中整理出自己的判断。',
    keywords: ['沉静', '思考', '洞察'],
    innerCopy: '内心需要安静的空间来感受、总结和蓄积力量',
    outerCopy: '给人冷静、灵活、善于谋划的感觉',
  },
};

const STEM_SEASONS: Record<string, ProfileSeason> = {
  甲: '春',
  乙: '春',
  丙: '夏',
  丁: '夏',
  戊: '长夏',
  己: '长夏',
  庚: '秋',
  辛: '秋',
  壬: '冬',
  癸: '冬',
};

// This follows the approved 60-card season strings: 辰=春、未=夏、戌=秋、丑=冬.
const BRANCH_SEASONS: Record<string, ProfileSeason> = {
  子: '冬',
  丑: '冬',
  寅: '春',
  卯: '春',
  辰: '春',
  巳: '夏',
  午: '夏',
  未: '夏',
  申: '秋',
  酉: '秋',
  戌: '秋',
  亥: '冬',
};

export const STEM_TALENTS: Record<string, string> = {
  甲: '领导力',
  乙: '承载力',
  丙: '号召力',
  丁: '演说力',
  戊: '学习力',
  己: '战斗力',
  庚: '变通力',
  辛: '执行力',
  壬: '拼搏力',
  癸: '总结力',
};

export const POSITION_DIMENSIONS: Record<ProfileFirstLookPosition, '思想' | '行为' | '事业' | '梦想目标'> = {
  hour: '思想',
  day: '行为',
  month: '事业',
  year: '梦想目标',
};

export const POSITION_ORDER = ['hour', 'day', 'month', 'year'] as const;

export function knowledgeFor(card: string, position: ProfileFirstLookPosition) {
  const positionCopy = PROFILE_POSITION_COPY[card as keyof typeof PROFILE_POSITION_COPY]?.[position];
  const stem = [...card][0];
  const branch = [...card][1];
  const stemSeason = stem ? STEM_SEASONS[stem] : undefined;
  const branchSeason = branch ? BRANCH_SEASONS[branch] : undefined;
  const talentMark = stem ? STEM_TALENTS[stem] : undefined;
  if (!positionCopy || !stem || !branch || !stemSeason || !branchSeason || !talentMark) {
    throw Object.assign(new Error(`Profile first-look knowledge is incomplete for ${card}.${position}`), {
      code: 'PROFILE_FIRST_LOOK_KNOWLEDGE_INCOMPLETE',
      retryable: false,
    });
  }
  return {
    sourceCopy: positionCopy,
    publishedCopy: softenCopy(positionCopy),
    stem,
    branch,
    stemSeason,
    branchSeason,
    talentMark,
    sourceChecksum: PROFILE_POSITION_COPY_SOURCE_SHA256,
  };
}

function softenCopy(copy: string) {
  const replacements: ReadonlyArray<readonly [string, string]> = [
    ['情绪化', '情绪感受比较鲜明'],
    ['敏感多疑', '感受敏锐，也会反复确认'],
    ['敏感好战', '感受敏锐，也有较强的行动张力'],
    ['固执诡异', '有自己的坚持，也常用不同寻常的方式思考'],
    ['掌控欲强', '希望事情保持在清晰可控的节奏中'],
    ['不讲章纪', '不太喜欢被固定章法限制'],
    ['自我否决', '容易反复权衡'],
    ['爱财', '重视实际价值'],
    ['好战', '行动张力较强'],
  ];
  return replacements.reduce((result, [source, target]) => result.replaceAll(source, target), copy);
}

function assertKnowledgeCompleteness() {
  const expected = new Set(SEXAGENARY_CYCLE);
  const actual = new Set(Object.keys(PROFILE_POSITION_COPY));
  if (expected.size !== actual.size || [...expected].some((card) => !actual.has(card))) {
    throw new Error('Profile first-look position knowledge must cover the complete sexagenary cycle');
  }
  for (const card of SEXAGENARY_CYCLE) {
    for (const position of POSITION_ORDER) knowledgeFor(card, position);
  }
}

assertKnowledgeCompleteness();

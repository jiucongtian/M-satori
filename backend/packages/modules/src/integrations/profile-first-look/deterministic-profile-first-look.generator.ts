import {
  type ProfileFirstLookContent,
  type ProfileFirstLookGenerationInput,
  type ProfileFirstLookGenerationResult,
  type ProfileFirstLookGenerator,
  type ProfileFirstLookPosition,
} from '@satori/application';
import {
  POSITION_DIMENSIONS,
  POSITION_ORDER,
  PROFILE_FIRST_LOOK_COPY_VERSION,
  PROFILE_FIRST_LOOK_KNOWLEDGE_RELEASE,
  PROFILE_FIRST_LOOK_RULE_VERSION,
  SEASON_COPY,
  SEASON_ORDER,
  knowledgeFor,
  type ProfileSeason,
} from './knowledge/profile-first-look.knowledge.js';

const NOTICE = '这是一份基础认识，不是对你人生的定论。' as const;
const TITLE_SUFFIX: Record<ProfileFirstLookPosition, string> = {
  hour: '背后的思考',
  day: '落地的方式',
  month: '展开的事业',
  year: '指向的愿景',
};

type SeasonCounts = Record<ProfileSeason, number>;
type OverallType = 'dominant' | 'moderate' | 'dual' | 'balanced';

interface SeasonView {
  primary: ProfileSeason;
  candidates: ProfileSeason[];
  tieBreaker: string | null;
}

interface SeasonSignature {
  overall: {
    type: OverallType;
    primary: ProfileSeason;
    secondary: ProfileSeason | null;
    tieBreaker: string | null;
    counts: SeasonCounts;
  };
  inner: SeasonView;
  outer: SeasonView;
  relation: 'aligned' | 'supportive' | 'contrast' | 'complementary';
  ruleVersion: string;
}

export class DeterministicProfileFirstLookGenerator implements ProfileFirstLookGenerator {
  generate(input: ProfileFirstLookGenerationInput): Promise<ProfileFirstLookGenerationResult> {
    const startedAt = performance.now();
    const knowledge = Object.fromEntries(
      POSITION_ORDER.map((position) => [position, knowledgeFor(input.cards[position], position)]),
    ) as Record<ProfileFirstLookPosition, ReturnType<typeof knowledgeFor>>;
    const signature = createSeasonSignature(knowledge);
    const content = createContent(input, knowledge, signature);
    return Promise.resolve({
      content,
      manifest: {
        workflowVersion: 'profile-four-card-first-look/local-1.0.0',
        skillVersion: PROFILE_FIRST_LOOK_RULE_VERSION,
        model: 'deterministic-rules',
        promptVersion: PROFILE_FIRST_LOOK_COPY_VERSION,
        outputSchemaVersion: '1.0.0',
        contentPolicyVersion: 'profile-gentle-language/1.0.0',
        generator: 'deterministic',
        ruleVersion: PROFILE_FIRST_LOOK_RULE_VERSION,
        knowledgeRelease: PROFILE_FIRST_LOOK_KNOWLEDGE_RELEASE,
      },
      providerRequestId: `local:${input.runReference}`,
      providerExecutionId: null,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
  }
}

function createContent(
  input: ProfileFirstLookGenerationInput,
  knowledge: Record<ProfileFirstLookPosition, ReturnType<typeof knowledgeFor>>,
  signature: SeasonSignature,
): ProfileFirstLookContent {
  const summary = summaryFor(signature);
  return {
    schemaVersion: '1.0.0',
    status: 'complete',
    profileSummary: summary,
    cards: POSITION_ORDER.map((position) => {
      const item = knowledge[position];
      const dimension = POSITION_DIMENSIONS[position];
      return {
        position,
        dimension,
        card: input.cards[position],
        title: `${item.talentMark}${TITLE_SUFFIX[position]}`,
        summary: `在${dimension}这一面，你更容易表现出${sentence(item.publishedCopy)}`,
        innerTrait: `内在更接近${item.branchSeason}的节奏：${SEASON_COPY[item.branchSeason].innerCopy}`,
        outerTrait: `外在更容易呈现${item.stemSeason}的气质：${SEASON_COPY[item.stemSeason].outerCopy}`,
        status: 'complete',
        evidence: {
          source: '连山易知识/06.六十甲子表#四柱特质',
          source_sha256: item.sourceChecksum,
          stem_season: item.stemSeason,
          branch_season: item.branchSeason,
          knowledge_release: PROFILE_FIRST_LOOK_KNOWLEDGE_RELEASE,
        },
        missingFields: [],
      };
    }),
    knowledgeRelease: PROFILE_FIRST_LOOK_KNOWLEDGE_RELEASE,
    notice: NOTICE,
  };
}

function summaryFor(signature: SeasonSignature): ProfileFirstLookContent['profileSummary'] {
  const { overall, inner, outer } = signature;
  const primary = SEASON_COPY[overall.primary];
  const secondary = overall.secondary ? SEASON_COPY[overall.secondary] : null;
  const title =
    overall.type === 'dominant'
      ? `${overall.primary}意鲜明的生命底色`
      : overall.type === 'moderate'
        ? `${overall.primary}意渐显的生命底色`
        : overall.type === 'dual' && overall.secondary
          ? `${overall.primary}与${overall.secondary}交织的生命底色`
          : '多种节律并存的生命底色';
  const overallCopy =
    overall.type === 'dual' && secondary
      ? `你的生命底色由${overall.primary}与${overall.secondary}共同构成。${primary.description}${secondary.description}`
      : overall.type === 'balanced'
        ? `你的生命底色比较均衡，不容易长期停留在单一状态。回到自己时，${primary.description}`
        : `${primary.description}`;
  const description = [
    overallCopy,
    `真正回到自己时，你更接近${inner.primary}的节奏；面对外界时，则更容易展现${outer.primary}的气质。`,
    relationCopy(signature.relation),
  ].join('');
  return {
    title,
    description,
    keywords: [...new Set([...primary.keywords, ...(secondary?.keywords ?? [])])].slice(0, 6),
    innerTrait: SEASON_COPY[inner.primary].innerCopy,
    outerTrait: SEASON_COPY[outer.primary].outerCopy,
  };
}

function createSeasonSignature(
  knowledge: Record<ProfileFirstLookPosition, ReturnType<typeof knowledgeFor>>,
): SeasonSignature {
  const allNodes = POSITION_ORDER.flatMap((position) => [
    knowledge[position].stemSeason,
    knowledge[position].branchSeason,
  ]);
  const counts = countSeasons(allNodes);
  const ranked = rank(counts);
  const rankedFirst = firstSeason(ranked, 'overall ranking');
  const topCount = counts[rankedFirst];
  const topCandidates = ranked.filter((season) => counts[season] === topCount);
  let type: OverallType;
  if (topCandidates.length === 1 && topCount >= 4) type = 'dominant';
  else if (topCandidates.length === 1) type = 'moderate';
  else if (topCandidates.length === 2 && topCount > counts[ranked[2] ?? rankedFirst]) type = 'dual';
  else type = 'balanced';

  const dayBranch = knowledge.day.branchSeason;
  const dayStem = knowledge.day.stemSeason;
  const primary: ProfileSeason =
    type === 'balanced'
      ? dayBranch
      : topCandidates.includes(dayBranch)
        ? dayBranch
        : firstSeason(topCandidates, 'overall candidates');
  const secondary =
    type === 'dual'
      ? (topCandidates.find((season) => season !== primary) ?? null)
      : type === 'balanced'
        ? dayStem !== primary
          ? dayStem
          : (ranked.find((season) => season !== primary) ?? null)
        : (ranked.find((season) => season !== primary && counts[season] > 0) ?? null);

  const inner = resolveView(
    [
      knowledge.hour.stemSeason,
      knowledge.hour.branchSeason,
      knowledge.day.stemSeason,
      knowledge.day.branchSeason,
    ],
    POSITION_ORDER.map((position) => knowledge[position].branchSeason),
    dayBranch,
    'all_branches',
    'day_branch',
  );
  const outer = resolveView(
    [
      knowledge.month.stemSeason,
      knowledge.month.branchSeason,
      knowledge.year.stemSeason,
      knowledge.year.branchSeason,
    ],
    POSITION_ORDER.map((position) => knowledge[position].stemSeason),
    dayStem,
    'all_stems',
    'day_stem',
  );

  return {
    overall: {
      type,
      primary,
      secondary,
      tieBreaker:
        type === 'balanced' ? (dayStem === dayBranch ? 'day_branch' : 'day_branch_then_day_stem') : null,
      counts,
    },
    inner,
    outer,
    relation: relationBetween(inner.primary, outer.primary),
    ruleVersion: PROFILE_FIRST_LOOK_RULE_VERSION,
  };
}

function resolveView(
  primaryNodes: ProfileSeason[],
  secondaryNodes: ProfileSeason[],
  finalFallback: ProfileSeason,
  secondaryLabel: string,
  fallbackLabel: string,
): SeasonView {
  const primaryCounts = countSeasons(primaryNodes);
  const top = rank(primaryCounts).filter(
    (season) => primaryCounts[season] === Math.max(...Object.values(primaryCounts)),
  );
  if (top.length === 1)
    return { primary: firstSeason(top, 'view candidates'), candidates: top, tieBreaker: null };
  const secondaryCounts = countSeasons(secondaryNodes);
  const bestSecondary = Math.max(...top.map((season) => secondaryCounts[season]));
  const narrowed = top.filter((season) => secondaryCounts[season] === bestSecondary);
  if (narrowed.length === 1) {
    return {
      primary: firstSeason(narrowed, 'narrowed view candidates'),
      candidates: top,
      tieBreaker: secondaryLabel,
    };
  }
  return {
    primary: narrowed.includes(finalFallback)
      ? finalFallback
      : firstSeason(narrowed, 'final view candidates'),
    candidates: top,
    tieBreaker: narrowed.includes(finalFallback) ? fallbackLabel : `${fallbackLabel}_then_fixed_order`,
  };
}

function countSeasons(nodes: ProfileSeason[]): SeasonCounts {
  const counts = Object.fromEntries(SEASON_ORDER.map((season) => [season, 0])) as SeasonCounts;
  for (const season of nodes) counts[season] += 1;
  return counts;
}

function rank(counts: SeasonCounts) {
  return [...SEASON_ORDER].sort((left, right) => counts[right] - counts[left]);
}

function firstSeason(seasons: ProfileSeason[], context: string): ProfileSeason {
  const season = seasons[0];
  if (!season) throw new Error(`Season resolution produced no candidates for ${context}`);
  return season;
}

function relationBetween(inner: ProfileSeason, outer: ProfileSeason): SeasonSignature['relation'] {
  if (inner === outer) return 'aligned';
  const innerElement = SEASON_COPY[inner].element;
  const outerElement = SEASON_COPY[outer].element;
  const generating = new Set(['木火', '火土', '土金', '金水', '水木']);
  const controlling = new Set(['木土', '土水', '水火', '火金', '金木']);
  if (generating.has(`${innerElement}${outerElement}`) || generating.has(`${outerElement}${innerElement}`)) {
    return 'supportive';
  }
  if (
    controlling.has(`${innerElement}${outerElement}`) ||
    controlling.has(`${outerElement}${innerElement}`)
  ) {
    return 'contrast';
  }
  return 'complementary';
}

function relationCopy(relation: SeasonSignature['relation']) {
  if (relation === 'aligned') return '你的内在节奏与外在表达比较一致，通常更容易让人感受到真实而稳定的你。';
  if (relation === 'supportive')
    return '你的内在节奏与外在表达能够彼此滋养，一面蓄力，另一面自然把力量带出来。';
  if (relation === 'contrast')
    return '你的内在节奏与外在表达之间带着自然反差，这不是矛盾，而是你调节环境与自我的方式。';
  return '你的内在节奏与外在表达各有侧重，也让你能够用不止一种方式回应生活。';
}

function sentence(copy: string) {
  return /[。！？]$/.test(copy) ? copy : `${copy}。`;
}

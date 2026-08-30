import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSourceUrls = [
  "../app/page.tsx",
  "../src/features/auth/WelcomeScreen.tsx",
  "../src/features/auth/LoginScreen.tsx",
  "../src/features/auth/ConsentScreen.tsx",
  "../src/features/profile/ProfileCreateScreen.tsx",
  "../src/components/LifeWisdomCard.tsx",
  "../src/features/legacy/LegacyProfileFlow.tsx",
].map((path) => new URL(path, import.meta.url));

async function readPageSources() {
  return (await Promise.all(pageSourceUrls.map((url) => readFile(url, "utf8")))).join("\n");
}

async function readCssSources() {
  return (await Promise.all(["../app/globals.css", "../app/legal/legal.css", "../src/features/legacy/legacy.css"].map((path) => readFile(new URL(path, import.meta.url), "utf8")))).join("\n");
}

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("服务端首屏直接渲染欢迎页，Session 在后台恢复", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /初见欢迎页/);
  assert.match(html, /每一天/);
  assert.match(html, /开始认识自己/);
  assert.doesNotMatch(html, /正在恢复登录状态/);
});

test("AUTH-02 不展示已有档案快捷入口，新用户礼物按后端额度显示", async () => {
  const page = await readPageSources();
  const welcome = page.match(/view === "welcome" \? \([\s\S]*?\) : view === "login"/)?.[0] ?? "";
  const gift = page.match(/export function SeedGift[\s\S]*?\n}\n\nexport function TodayHome/)?.[0] ?? "";
  assert.doesNotMatch(welcome, /已有档案/);
  assert.match(page, /amount=\{home\?\.registrationReward\.wisdomSeedAmount \?\? 18\}/);
  assert.match(gift, /<span>\{amount\}<\/span>/);
  assert.match(gift, /收下 \$\{amount\} 颗智慧种子/);
  assert.doesNotMatch(gift, /收下 3 颗智慧种子|<span>3<\/span>|<strong>3 颗<\/strong>/);
});

test("AUTH-04 使用统一资料用途文案且不展示内部协议规则编号", async () => {
  const login = await readFile(new URL("../src/features/auth/LoginScreen.tsx", import.meta.url), "utf8");
  assert.match(login, /并知晓相关资料的用途/);
  assert.doesNotMatch(login, /并知晓出生资料的用途|AUTH-05 · 协议与隐私确认/);
});
test("AUTH-03 与 AUTH-02 复用左上角品牌布局且不提供返回", async () => {
  const login = await readFile(new URL("../src/features/auth/LoginScreen.tsx", import.meta.url), "utf8");
  assert.match(login, /<header className="brand-row login-header"><Brand \/><\/header>/);
  assert.doesNotMatch(login, /back-button|返回欢迎页|login-brand|Brand compact/);
});
test("页面编号仅在显式开启的研发与调试构建中显示", async () => {
  const page = await readPageSources();
  const component = await readFile(new URL("../src/shared/ui.tsx", import.meta.url), "utf8");
  assert.match(component, /process\.env\.NEXT_PUBLIC_SHOW_PAGE_LABELS === "true"/);
  assert.match(component, /showPageDebugLabels \? <span className="screen-id"/);
  assert.equal((component.match(/className="screen-id"/g) || []).length, 1);
  assert.ok((page.match(/<PageDebugLabel>/g) || []).length >= 2);
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(packageJson.scripts.dev, /NEXT_PUBLIC_SHOW_PAGE_LABELS=true/);
  assert.doesNotMatch(packageJson.scripts["build:static"], /NEXT_PUBLIC_SHOW_PAGE_LABELS=true/);
  assert.match(packageJson.scripts["build:test:static"], /NEXT_PUBLIC_SHOW_PAGE_LABELS=true/);
  assert.match(packageJson.scripts["build:debug:static"], /NEXT_PUBLIC_SHOW_PAGE_LABELS=true/);
});
test("正式工程包含完整原型基础样式", async () => {
  const formalCss = await readCssSources();
  for (const selector of [".stage", ".phone", ".hero-copy", ".login-page", ".profile-flow", ".today-home", ".my-home"]) {
    assert.match(formalCss, new RegExp(selector.replace(".", "\\.")));
  }
  assert.ok(formalCss.length > 50_000);
});

test("R1.0 使用统一字体令牌并明确区分品牌与功能文字", async () => {
  const css = await readCssSources();
  for (const token of [
    "--font-brand:", "--font-ui:", "--type-display: 32px", "--type-page-title: 24px",
    "--type-body: 14px", "--type-secondary: 13px", "--type-caption: 12px",
  ]) assert.match(css, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(css, /\.phone\{font-family:var\(--font-ui\)/);
  assert.match(css, /\.phone h1,[\s\S]*?font-family:var\(--font-brand\)/);
  assert.match(css, /\.report-opening p,[\s\S]*?font-size:var\(--type-body\);line-height:1\.85/);
  assert.match(css, /\.home-energy-card \.guide-tips strong,[\s\S]*?font-size:var\(--type-caption\)/);
});

test("R1.0 首屏使用平台中文字体并保留字体授权证据", async () => {
  const css = await readCssSources();
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const sansLicense = await readFile(new URL("../public/fonts/licenses/Noto-Sans-SC-OFL-1.1.txt", import.meta.url), "utf8");
  const serifLicense = await readFile(new URL("../public/fonts/licenses/Noto-Serif-SC-OFL-1.1.txt", import.meta.url), "utf8");

  assert.equal(packageJson.dependencies["@fontsource/noto-sans-sc"], "5.2.7");
  assert.equal(packageJson.dependencies["@fontsource/noto-serif-sc"], "5.2.7");
  assert.doesNotMatch(css, /@font-face|\/fonts\/noto-/);
  for (const family of ["noto-sans-sc", "noto-serif-sc"]) {
    for (const weight of [400, 500, 600]) {
      const path = `/fonts/${family}/${family}-${weight}.woff2`;
      const binary = await readFile(new URL(`../public${path}`, import.meta.url));
      assert.ok(binary.byteLength > 10_000);
    }
  }
  for (const license of [sansLicense, serifLicense]) assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
});

test("R1.0 字体令牌优先使用系统中文字体，避免首屏字体下载", async () => {
  const css = await readCssSources();
  assert.match(css, /--font-brand: "Songti SC", "STSong", "Noto Serif CJK SC", serif/);
  assert.match(css, /--font-ui: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif/);
});

test("R1.0 主导航展示五项且三个未来模块只进入预告页", async () => {
  const page = await readPageSources();
  const nav = page.match(/function MainNav[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(nav, /\["今日", 10/);
  assert.match(nav, /\["我的", 21/);
  assert.match(nav, /PREVIEW-READ/);
  assert.match(nav, /PREVIEW-GROWTH/);
  assert.match(nav, /PREVIEW-RELATIONSHIP/);
  assert.ok(nav.indexOf('["关系"') < nav.indexOf('["成长"'));
  assert.doesNotMatch(nav, /\["问事", 29|\["成长", 43|\["关系", 44/);
});

test("R1.0 可达页面白名单不包含后续版本模块", async () => {
  const page = await readPageSources();
  const scope = page.match(/const r1StepIds = new Set\(\[[\s\S]*?\]\);/)?.[0] ?? "";
  for (const id of ["PROFILE-01", "PROFILE-11", "GIFT-01", "HOME-01", "DAILY-03", "MY-01", "MY-03", "MY-09", "MY-16"]) {
    assert.match(scope, new RegExp(`"${id}"`));
  }
  assert.match(scope, /PREVIEW-READ/);
  assert.match(scope, /PREVIEW-GROWTH/);
  assert.match(scope, /PREVIEW-RELATIONSHIP/);
  assert.doesNotMatch(scope.replaceAll("PREVIEW-READ", "").replaceAll("PREVIEW-GROWTH", "").replaceAll("PREVIEW-RELATIONSHIP", ""), /READ-|GRW-|REL-|LIFE-|PER-|SHOP-|GOODS-|ORDER-/);
});

test("R1.1 我的页面展示商业闭环且不混入后续报告产品", async () => {
  const page = await readPageSources();
  const myHome = page.match(/function MyHome[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.doesNotMatch(myHome, /成长记录|每日指引记录/);
  assert.match(myHome, /生命智慧档案库/);
  assert.match(myHome, /智慧种子/);
  assert.match(myHome, /我的权益/);
  assert.match(myHome, /serviceSummary\?\.membership/);
  assert.match(myHome, /选择会员计划/);
  assert.match(myHome, /会员计划/);
  assert.match(myHome, /服务商城/);
  assert.match(myHome, /我的订单/);
  assert.doesNotMatch(myHome, /助学童子|生命之光|月运|年运|关系匹配/);
});

test("R1.1 我的首页会员与服务权益来自后端事实", async () => {
  const my = await readFile(new URL("../src/features/my/MyScreens.tsx", import.meta.url), "utf8");
  const legacy = await readFile(new URL("../src/features/legacy/LegacyProfileFlow.tsx", import.meta.url), "utf8");
  assert.match(my, /api\.currentMembership\(\)/);
  assert.match(my, /api\.entitlements\(\)/);
  assert.match(my, /toMyServiceSummary\(membership,entitlements\)/);
  assert.match(legacy, /serviceSummary\?\.membership/);
  assert.match(legacy, /当前尚未开通会员/);
  assert.doesNotMatch(my, /剩余 18 天|12<em> \/ 15次|4<em> \/ 5份/);
});

test("R1.0 智慧种子统一为不可交易的 AI 体验额度，赠送页不重复展示说明", async () => {
  const page = await readPageSources();
  const gift = page.match(/function SeedGift[\s\S]*?\n}\n/)?.[0] ?? "";
  const daily = page.match(/function SeedPayment[\s\S]*?\n}\n/)?.[0] ?? "";
  const seeds = page.match(/function MySeeds[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.doesNotMatch(gift, /智慧种子是平台免费赠送、会员附赠或学院配置的 AI 体验额度/);
  assert.match(daily, /确认后由服务端预留/);
  assert.match(daily, /未形成有效内容会自动恢复/);
  assert.match(daily, /AI 体验额度不足/);
  assert.match(seeds, /可用 AI 体验额度/);
  assert.match(seeds, /仅用于 AI 体验/);
  for (const component of [gift, daily, seeds]) {
    assert.doesNotMatch(component, /统一的价值凭证|购买智慧种子|确认支付|现金兑换/);
  }
});

test("R1.0 AI 与确定性知识内容分别展示准确边界声明", async () => {
  const page = await readPageSources();
  const aiNotice = page.match(/function AiContentNotice[\s\S]*?\n}\n/)?.[0] ?? "";
  const profileNotice = page.match(/function ProfileReferenceNotice[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(aiNotice, /AI 生成内容/);
  assert.match(profileNotice, /传统文化参考内容/);
  assert.match(profileNotice, /固定知识版本与规则生成/);
  assert.match(profileNotice, /不构成医疗、投资、法律建议或对未来结果的保证/);
  for (const name of ["RelationshipFirstLook", "FirstLookArchive"]) {
    const component = page.match(new RegExp(`function ${name}[\\s\\S]*?\\n}\\n`))?.[0] ?? "";
    assert.match(component, /<ProfileReferenceNotice \/>/);
  }
  const daily = page.match(/function DailyReport[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(daily, /<AiContentNotice \/>/);
});

test("R1.0 Release 白名单阻断购种、商城与种子兑换页面", async () => {
  const page = await readPageSources();
  const scope = page.match(/const r1StepIds = new Set\(\[[\s\S]*?\]\);/)?.[0] ?? "";
  for (const id of ["SHOP-01", "SEED-01", "SEED-02", "SEED-03", "GOODS-01", "GOODS-05", "ORDER-01"]) {
    assert.doesNotMatch(scope, new RegExp(`"${id}"`));
  }
});

test("MY-02 进入 MY-17 完整编辑档案闭环", async () => {
  const page = await readPageSources();
  const profile = page.match(/function MyProfile[\s\S]*?\n}\n/)?.[0] ?? "";
  const editor = page.match(/function EditSelfProfile[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(profile, /编辑生命智慧档案/);
  assert.match(page, /function EditSelfProfile/);
  assert.match(page, /R1\.0 · MY-17/);
  assert.match(page, /api\.previewProfile/);
  assert.match(page, /api\.confirmProfile/);
  assert.match(page, /本次修改将创建新版本/);
  assert.match(editor, /edit-profile-scroll unified-profile/);
  assert.match(editor, /unified-form-card/);
  assert.match(editor, /calendar-switch/);
  assert.match(editor, /lunar-date-row/);
  assert.match(editor, /time-known-switch/);
  assert.match(editor, /edit-gender-options/);
  assert.doesNotMatch(profile, /编辑功能正在完善中/);
  assert.doesNotMatch(profile, /编辑出生资料|查看版本与历史影响/);
});

test("R1.0 所有建档入口均跳过并隐藏太阳时地区选择", async () => {
  const page = await readPageSources();
  const flow = page.match(/function LegacyProfileFlow[\s\S]*?function FlowStep/)?.[0] ?? "";
  const editSelf = page.match(/function EditSelfProfile[\s\S]*?function MySeeds/)?.[0] ?? "";
  const newPerson = page.match(/function NewPersonArchive[\s\S]*?function ArchiveConfirm/)?.[0] ?? "";
  assert.match(page, /R1_UNSELECTED_LOCATION_ID = "loc_cn_330100"/);
  assert.match(flow, /const effectiveStep = step === 4 \? 5 : step/);
  assert.match(flow, /id === "PROFILE-04"\) return setStep\(5\)/);
  assert.match(flow, /id === "PROFILE-07"\) return setStep\(3\)/);
  assert.doesNotMatch(flow, /BIRTH REGION|太阳时地区|region-unavailable/);
  for (const component of [editSelf, newPerson]) assert.doesNotMatch(component, /太阳时地区|region-unavailable|searchLocations|place-result|出生地点<\/span><input/);
});
test("PROFILE-11 可从 MY-02 进入 MY-18 长期回看", async () => {
  const page = await readPageSources();
  assert.match(page, /MY-18/);
  assert.match(page, /生命智慧初识/);
  assert.match(page, /function FirstLookArchive/);
  assert.match(page, /first-look-entry/);
  assert.match(page, /api\.generateProfileFirstLook/);
  assert.match(page, /api\.profileFirstLook/);
  assert.match(page, /content\.profileSummary\.description/);
  assert.match(page, /content\.cards\.map/);
  assert.match(page, /content\.notice/);
  assert.doesNotMatch(page, /生于盛夏，火意明亮/);
  assert.doesNotMatch(page, /card\.summary\|\|/);
});

test("PROFILE-08 完成预览后自动确认并跳过 PROFILE-10 进入初见生成态", async () => {
  const page = await readPageSources();
  const flow = page.match(/function LegacyProfileFlow[\s\S]*?function FlowStep/)?.[0] ?? "";
  const calculating = page.match(/function Calculating[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(flow, /id !== "PROFILE-08"/);
  assert.match(flow, /api\.previewProfile/);
  assert.match(flow, /setCalculationStage\(4\)/);
  assert.doesNotMatch(flow, /setStep\(7\)/);
  assert.match(flow, /window\.setTimeout\(\(\) => void confirmProfile\(\), 450\)/);
  assert.match(flow, /const cardsComplete = hasCompleteFirstLookCards\(revisionToConfirm\)/);
  assert.match(flow, /setFirstLookLoading\(cardsComplete\);\s*setStep\(8\)/);
  assert.match(flow, /if \(cardsComplete\) await generateFirstLook/);
  assert.match(calculating, /index < stage/);
  assert.match(calculating, /重新生成/);
  assert.doesNotMatch(calculating, /开启档案初见 →|onDone/);
});
test("PROFILE-08 不展示保存退出操作", async () => {
  const page = await readPageSources();
  assert.match(page, /id !== "PROFILE-02" && id !== "PROFILE-08" && id !== "PROFILE-10"/);
});

test("PROFILE-11 请求失败后回读后端持久化失败状态", async () => {
  const page = await readPageSources();
  const generation = page.match(/async function generateFirstLook[\s\S]*?\n  }\n\n  async function openFirstLookArchive/)?.[0] ?? "";
  assert.match(generation, /await api\.generateProfileFirstLook\(revisionId\)/);
  assert.match(generation, /setFirstLook\(await api\.profileFirstLook\(revisionId\)\)/);
  assert.match(generation, /setApiError\(apiMessage\(error\)\)/);
});

test("PROFILE-11 四卡不完整时不发起生成并允许修改或跳过", async () => {
  const page = await readPageSources();
  const firstLook = page.match(/function RelationshipFirstLook[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(page, /function hasCompleteFirstLookCards/);
  assert.match(page, /card\.cardCode !== "UNKNOWN" && card\.ganzhi/);
  assert.match(firstLook, /补充出生时间后/);
  assert.match(firstLook, />修改资料</);
  assert.match(firstLook, />暂时跳过</);
  assert.match(page, /onEdit=\{\(\) => setStep\(1\)\}/);
});

test("出生时间只保留知道与不知道并正确映射 DATE_ONLY", async () => {
  const page = await readPageSources();
  const mapping = page.match(/function birthTimeFromProfileData[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(mapping, /accuracy === "完全不知道"/);
  assert.match(mapping, /timePrecision: "DATE_ONLY"/);
  assert.match(mapping, /timePrecision: "EXACT_MINUTE"/);
  assert.doesNotMatch(mapping, /HOUR_RANGE|APPROXIMATE/);
  assert.match(page, /知道具体时间/);
  assert.match(page, /不知道具体时间/);
  assert.match(page, /暂按子时生成完整档案/);
});

test("PROFILE-08 开启初见时防止并发重复确认并恢复已激活的档案版本", async () => {
  const page = await readPageSources();
  const confirmation = page.match(/async function confirmProfile\(\) \{[\s\S]*?async function claimReward/)?.[0] ?? "";
  assert.match(page, /const confirmingRevisionRef = useRef<string \| null>\(null\)/);
  assert.match(confirmation, /confirmingRevisionRef\.current === revision\.revisionId/);
  assert.match(confirmation, /PROFILE_REVISION_ALREADY_CONFIRMED/);
  assert.match(confirmation, /await api\.profileRevision\(revisionToConfirm\.revisionId\)/);
  assert.match(confirmation, /persistedRevision\.status !== "ACTIVE"/);
  assert.match(confirmation, /setRevision\(persistedRevision\)/);
  assert.match(confirmation, /confirmingRevisionRef\.current = null/);
});

test("HOME-01 使用最新高中特低能量指引卡并保留真实数据入口", async () => {
  const page = await readPageSources();
  const css = await readCssSources();
  const home = page.match(/function TodayHome[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(home, /home-energy-card/);
  assert.match(home, /home\?\.dailyEnergySummary\.data/);
  assert.match(home, /<h1>\{name\}，你好<\/h1>/);
  assert.doesNotMatch(home, /summary\?\.greeting/);
  assert.doesNotMatch(home, /home-note|今日指引 ·|summary\.date/);
  assert.match(home, /summary\?\.energyLevel === level/);
  assert.match(home, /summary\?\.guidance/);
  assert.match(home, /summary\.suitableActions/);
  assert.match(home, /summary\.cautions/);
  assert.match(home, /home-growth-scene/);
  assert.match(css, /\.today-home \.home-energy-card\{min-height:clamp\(340px,44svh,390px\)/);
  assert.match(css, /\.home-growth-scene \.life-growth\{top:50%;right:auto;left:50%/);
  assert.match(css, /\.home-energy-card \.guide-tips>div\+div\{padding:3px 4px 7px;border:0;text-align:center\}/);
  assert.match(home, /summary\?\.heavenCard \? ` · \$\{summary\.heavenCard\}` : ""/);
  assert.doesNotMatch(home, /summary\?\.dayCard \? ` · \$\{summary\.dayCard\}`/);
  assert.match(home, /className="home-guidance-link"/);
  assert.match(css, /\.home-energy-card \.home-guidance-link\{-webkit-appearance:none;appearance:none;width:auto;min-width:44px;min-height:44px/);
  assert.match(css, /\.home-energy-card \.home-guidance-link\{[^}]*background-image:none[^}]*filter:none;backdrop-filter:none;-webkit-backdrop-filter:none/);
  assert.match(css, /\.home-energy-card \.home-guidance-link:hover,\.home-energy-card \.home-guidance-link:active,\.home-energy-card \.home-guidance-link:focus\{[^}]*backdrop-filter:none;-webkit-backdrop-filter:none\}/);
  assert.doesNotMatch(home, /先稳住自己的节奏，再清醒回应外界的变化/);
  assert.match(home, /适合做什么/);
  assert.match(home, /注意什么/);
  assert.match(home, /home\?\.wisdomSeedAccount\.available/);
  assert.match(home, /ready \? "查看今日能量指引" : "获取今日能量指引"/);
  assert.match(page, /id === "HOME-01" \? " home-flow"/);
  assert.match(css, /\.profile-flow\.home-flow\{height:100%;min-height:0;overflow:hidden\}/);
  assert.match(css, /\.home-flow \.today-home\{[^}]*overflow-x:hidden[^}]*overflow-y:auto[^}]*display:flex[^}]*flex-direction:column[^}]*scrollbar-width:none/);
  assert.match(css, /\.home-flow \.today-home>h1\{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.home-flow \.today-home>\.home-energy-card\{flex:none;margin-bottom:18px\}/);
  assert.match(css, /\.home-flow \.today-home>\.main-nav\{position:sticky[^}]*margin:auto -9px 0/);
});

test("每日指引和分享流程复用首页能量状态", async () => {
  const page = await readPageSources();
  assert.match(page, /const dailyEnergyLevel = home\?\.dailyEnergySummary\.data\?\.energyLevel/);
  for (const component of ["DailyStart", "DailyReport", "DailyShare", "ShareOptions", "ShareGenerating", "ShareSuccess"]) {
    const source = page.match(new RegExp(`function ${component}[\\s\\S]*?\\n}`))?.[0] ?? "";
    assert.match(source, /energyLevel\?: EnergyLevel/);
    assert.match(source, /\{energyLevel \?\? "—"\}/);
    assert.doesNotMatch(source, />中</);
  }
});

test("HOME-01 今日能量卡使用轻透疗愈层次而非厚重实色", async () => {
  const css = await readCssSources();
  assert.match(css, /\.daily-guide \{[^}]*rgba\(99,138,117,\.82\)/);
  assert.match(css, /backdrop-filter:blur\(10px\)/);
  assert.match(css, /\.daily-guide:before/);
  assert.match(css, /\.daily-guide:after/);
});

test("三个预告页统一说明后续上线与未来能力", async () => {
  const page = await readPageSources();
  const preview = page.match(/function ComingSoonPage[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(preview, /这片新的枝叶正在生长/);
  assert.match(preview, /将在后续版本与你见面/);
  assert.match(preview, /未来将支持/);
  assert.match(preview, /我知道了，返回今日/);
});

test("预告页保持单屏且底部导航位置稳定", async () => {
  const css = await readCssSources();
  assert.match(css, /\.coming-soon-page\{[^}]*height:100%[^}]*overflow:hidden[^}]*display:flex/);
  assert.match(css, /\.today-home>\.main-nav,\.my-home>\.main-nav,\.coming-soon-page>\.main-nav\{[^}]*position:absolute[^}]*left:-9px[^}]*right:-9px[^}]*bottom:0[^}]*height:52px[^}]*grid-template-columns:repeat\(5,1fr\)/);
});

test("五个根页面切换时不重新执行整页入场动画", async () => {
  const css = await readCssSources();
  assert.match(css, /\.phone>\.today-home,\.phone>\.reading-home\.root-tab-page,\.phone>\.my-home\{animation:none\}/);
  assert.doesNotMatch(css, /\.coming-soon-page\{[^}]*animation:page-in/);
});

test("待后端能力具有明确候选契约", async () => {
  const support = await readFile(new URL("../src/api/contracts/support.ts", import.meta.url), "utf8");
  assert.match(support, /CONTRACT_PROPOSED/);
  assert.match(support, /profileLibrary/);
  assert.match(support, /registrationReward/);
  assert.match(support, /wisdomSeeds/);
});

test("真实 API 客户端使用同源接口、Cookie Session 与内存 Access Token", async () => {
  const client = await readFile(new URL("../src/api/client.ts", import.meta.url), "utf8");
  assert.match(client, /const API_BASE = "\/api\/v1"/);
  assert.match(client, /credentials: "include"/);
  assert.match(client, /private accessToken: string \| null = null/);
  assert.match(client, /Idempotency-Key/);
  assert.match(client, /\/auth\/sessions\/refresh/);
  assert.match(client, /\/auth\/sessions\/current/);
  assert.doesNotMatch(client, /localStorage\.setItem\([^\n]*(access|token)/i);
});

test("手机号登录后按档案状态分流，老用户及新用户建档完成后都进入 HOME-01", async () => {
  const login = await readFile(new URL("../src/features/auth/LoginScreen.tsx", import.meta.url), "utf8");
  const routes = await readFile(new URL("../src/shared/routes.ts", import.meta.url), "utf8");
  const guard = await readFile(new URL("../src/shared/guards.tsx", import.meta.url), "utf8");
  const profileCreate = await readFile(new URL("../src/features/profile/ProfileCreateScreen.tsx", import.meta.url), "utf8");
  assert.match(login, /session=await api\.createSession\(challengeId,code,acceptances\)/);
  assert.match(login, /session\.user\.requiresConsent\|\|session\.nextAction==="ACCEPT_CONSENTS"/);
  assert.match(login, /const current=await api\.me\(\)/);
  assert.match(login, /authenticatedEntryPath\(current\.nextAction\)/);
  assert.doesNotMatch(login, /URLSearchParams|requested|safeNextPath/);
  assert.match(routes, /CREATE_PROFILE: ROUTES\.profileCreate/);
  assert.match(routes, /CONFIRM_PROFILE: ROUTES\.profileCreate/);
  assert.match(routes, /CLAIM_REGISTRATION_REWARD: ROUTES\.profileCreate/);
  assert.match(routes, /VIEW_HOME: ROUTES\.home/);
  assert.match(guard, /authenticatedEntryPath\(me\.nextAction\)[\s\S]*pathname !== requiredPath[\s\S]*router\.replace\(requiredPath\)/);
  assert.match(profileCreate, /registrationReward\.status==="CLAIMED"[\s\S]*RESTORE_GIFT/);
  assert.match(profileCreate, /claimRegistrationReward\(\)[\s\S]*await resolve\(\)[\s\S]*router\.replace\(ROUTES\.home\)/);
  assert.match(profileCreate, /<SeedGift[\s\S]*onNext=\{\(\)=>router\.replace\(ROUTES\.home\)\}/);
});

test("生命智慧档案详情支持卡牌放大，未知时间卡牌只显示遮罩且禁止放大", async () => {
  const cards = await readFile(new URL("../src/components/LifeWisdomCard.tsx", import.meta.url), "utf8");
  assert.match(cards, /closest\("\.my-detail, \.person-archive-detail"\)/);
  assert.match(cards, /expandable&&available&&!card\.uncertainty/);
  assert.match(cards, /life-card-unknown-overlay">时间未知/);
  assert.match(cards, /createPortal\(<div className="life-card-modal"/);
  assert.doesNotMatch(cards, /时间未知 · 暂按子时生成/);
});
test("R1 核心页面调用真实后端能力", async () => {
  const page = await readPageSources();
  const session = await readFile(new URL("../src/shared/session.tsx", import.meta.url), "utf8");
  const combined = page + session;
  for (const call of ["api.sendSms","api.createSession","api.logout","api.previewProfile","api.confirmProfile","api.generateProfileFirstLook","api.profileFirstLook","api.claimRegistrationReward","api.createTodayInsight","api.generationTask","api.createProfile","api.previewOtherProfile","api.confirmOtherProfile","api.deleteProfile"]) assert.match(combined,new RegExp(call.replace(".","\\.")));
  assert.match(page, /api\.createSession\(challengeId,code,acceptances\)/);
  assert.doesNotMatch(page, /验证码已发送，原型中|原型中直接查看结果/);
});
test("Session 恢复不阻塞匿名欢迎页首屏", async () => {
  const welcome = await readFile(new URL("../src/features/auth/WelcomeScreen.tsx", import.meta.url), "utf8");
  const session = await readFile(new URL("../src/shared/session.tsx", import.meta.url), "utf8");
  assert.match(session, /const restored = await api\.refresh\(\)/);
  assert.match(welcome, /return <RouteFrame[\s\S]*初见欢迎页/);
  assert.doesNotMatch(welcome, /status !== "authenticated".*RouteSkeleton/);
});
test("协议版本更新时阻止空接受列表并为新旧 Session 完成补充确认", async () => {
  const page = await readPageSources();
  const client = await readFile(new URL("../src/api/client.ts", import.meta.url), "utf8");
  assert.match(page, /const current=await api\.bootstrap\(\)/);
  assert.match(page, /requiredConsentAcceptances\(current\)/);
  assert.match(page, /error\.code!=="LEGAL_DOCUMENT_VERSION_INVALID"/);
  assert.match(page, /if\(acceptances\.length>0\)await api\.acceptConsents\(acceptances\)/);
  assert.match(client, /acceptConsents\(acceptances:[\s\S]*?"\/me\/consents"/);
});
test("任意受保护接口返回 CONSENT_REQUIRED 时全局进入协议确认页", async () => {
  const client = await readFile(new URL("../src/api/client.ts", import.meta.url), "utf8");
  const session = await readFile(new URL("../src/shared/session.tsx", import.meta.url), "utf8");
  assert.match(client, /export const CONSENT_REQUIRED_EVENT = "satori:consent-required"/);
  assert.match(client, /failure\?\.code === "CONSENT_REQUIRED"[\s\S]*?window\.dispatchEvent\(new CustomEvent\(CONSENT_REQUIRED_EVENT/);
  assert.match(session, /window\.addEventListener\(CONSENT_REQUIRED_EVENT, handleConsentRequired\)/);
  assert.match(session, /router\.replace\(consentPath\(next\)\)/);
  assert.match(session, /window\.removeEventListener\(CONSENT_REQUIRED_EVENT, handleConsentRequired\)/);
});
test("MY-04 打开的每日指引详情返回 MY-01", async () => {
  const page = await readPageSources();
  assert.match(page, /setDailyReturnStep\(21\); setStep\(14\)/);
  assert.match(page, /onBack=\{\(\) => setStep\(dailyReturnStep\)\}/);
});

test("R1.1 我的页面以服务权益为主并降低赠送体验额度层级", async () => {
  const page = await readPageSources();
  const css = await readCssSources();
  const myHome = page.match(/function MyHome[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(myHome, /账号与退出/);
  assert.match(myHome, /联系我们/);
  assert.doesNotMatch(myHome, /消息与帮助/);
  assert.match(myHome, /平台赠送 · AI体验额度/);
  assert.match(myHome, /不可购买、交易、提现或兑换人民币/);
  assert.match(css, /\.my-current-membership\{/);
  assert.match(css, /\.my-seed-credit-secondary\{/);
});

test("MY-01 明确提示生命智慧档案库可以进入", async () => {
  const page = await readPageSources();
  const myHome = page.match(/function MyHome[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(myHome, /aria-label="进入生命智慧档案库"/);
  assert.match(myHome, /查看和管理自己与重要之人的档案/);
  assert.match(myHome, /进入档案库/);
});

test("R1.1 商业闭环只销售已上线服务并使用确认价格", async () => {
  const [commerce, catalog] = await Promise.all([
    readFile(new URL("../src/features/commerce/CommerceScreens.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../backend/packages/modules/src/catalog/domain/seed-data.ts", import.meta.url), "utf8"),
  ]);
  assert.match(catalog, /今日能量·10次体验[\s\S]*?amountMinor: 990/);
  assert.match(catalog, /抽卡问事·10次包[\s\S]*?amountMinor: 5_990/);
  assert.match(catalog, /membership\('glow', '微光计划', 1_290/);
  assert.match(catalog, /membership\('serenity', '清和计划', 2_490/);
  assert.match(catalog, /membership\('freedom', '自在计划', 3_990/);
  assert.doesNotMatch(catalog, /R1\.1体验版/);
  assert.match(commerce, /最终金额以服务端报价为准/);
  assert.doesNotMatch(commerce, /const PRODUCTS|price:"¥/);
});

test("R1.1 会员、支付结果和退款使用独立路由与异常恢复", async () => {
  const routes = await readFile(new URL("../src/shared/routes.ts", import.meta.url), "utf8");
  const commerce = await readFile(new URL("../src/features/commerce/CommerceScreens.tsx", import.meta.url), "utf8");
  assert.match(routes, /serviceMembership: "\/services\/membership"/);
  assert.match(routes, /serviceMembershipDetail: "\/services\/membership\/detail"/);
  assert.match(routes, /serviceEnergyPack: "\/services\/energy-pack"/);
  assert.match(commerce, /payment\.status === "SUCCEEDED"/);
  assert.match(commerce, /order\.status === "FULFILLMENT_FAILED"/);
  assert.match(commerce, /请勿重复购买/);
  assert.match(commerce, /会员升级原方案剩余权益不属于退款范围/);
  assert.match(commerce, /服务端报价/);
});

test("R1.0 退出登录二次确认且联系我们突出客服、官媒依次下沉", async () => {
  const page = await readPageSources();
  const settings = page.match(/function MySettings[\s\S]*?\n}\n/)?.[0] ?? "";
  const support = page.match(/function MySupport[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(settings, /确认退出当前账号/);
  assert.match(settings, /className="danger-action"[\s\S]*退出当前账号[\s\S]*<span>→<\/span>/);
  assert.match(settings, /继续留在这里/);
  assert.doesNotMatch(settings, /账号安全|隐私中心|数据管理|通知设置|通用设置/);
  for (const channel of ["官方视频号", "官方公众号", "官方小红书", "官方客服"]) assert.match(support, new RegExp(channel));
  for (const asset of ["official-video-channel.png", "official-wechat-account.jpeg", "official-xiaohongshu.png", "official-customer-service.png"]) assert.match(support, new RegExp(asset));
  assert.match(support, /support-focus/);
  assert.match(support, /official-media/);
  assert.doesNotMatch(support, /contact-tabs/);
  assert.ok(support.indexOf("官方公众号") < support.indexOf("官方视频号"));
  assert.ok(support.indexOf("官方视频号") < support.indexOf("官方小红书"));
  assert.match(support, /className="support-focus"[\s\S]*className="official-media"/);
});

test("MY-09 人物档案使用进入详情文案", async () => {
  const page = await readPageSources();
  const archive = page.match(/function WisdomArchive[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(archive, /进入详情/);
  assert.doesNotMatch(archive, /\?"私人记录":"待完善"/);
});

test("MY-13 复用档案结构并只保留编辑和一次删除确认", async () => {
  const page = await readPageSources();
  const archive = page.match(/function PersonArchive[\s\S]*?\n}\n/)?.[0] ?? "";
  const client = await readFile(new URL("../src/api/client.ts", import.meta.url), "utf8");
  assert.match(archive, /生命智慧初识/);
  assert.match(archive, /编辑生命智慧档案/);
  assert.match(archive, /删除这份人物档案/);
  assert.match(archive, /<UnifiedProfileForm/);
  assert.match(archive, /mode="edit"/);
  assert.match(archive, /确认删除这份档案/);
  assert.doesNotMatch(archive, /管理人物资料与授权|授权与共享状态/);
  assert.match(client, /method: "PATCH"/);
  assert.match(page, /api\.deleteProfile\(selectedProfile\.profileId\)/);
});

test("PROFILE-11 与 GIFT-01 不展示返回和保存退出操作", async () => {
  const page = await readPageSources();
  const css = await readCssSources();
  assert.match(page, /const headerlessSteps = new Set\(\[\.\.\.standaloneSteps, "PROFILE-11", "GIFT-01"\]\)/);
  assert.match(page, /!headerlessSteps\.has\(id\) && <header className="flow-header">/);
  assert.match(page, /headerlessSteps\.has\(id\) \? " headerless-flow"/);
  assert.match(css, /\.profile-flow\.headerless-flow\{height:100%;min-height:0;overflow:hidden\}/);
});

test("PROFILE-08/11 直达初见详情、四张卡牌置顶且 PAY-01 提供客服帮助闭环", async () => {
  const page = await readPageSources();
  const calculating = page.match(/function Calculating[\s\S]*?\n}\n/)?.[0] ?? "";
  const firstLook = page.match(/function RelationshipFirstLook[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(calculating, /<span>成档<\/span>/);
  assert.match(calculating, /对齐你的生命节律/);
  assert.match(calculating, /生成四张关系卡牌/);
  assert.match(calculating, /正在进入初见/);
  assert.doesNotMatch(calculating, /开启档案初见 →/);
  assert.match(firstLook, /<FirstLookCardPanel revision=\{revision\} \/>/);
  assert.doesNotMatch(page, /function ProfileResult/);
  assert.doesNotMatch(page, /\{id === "PROFILE-10"/);
  assert.doesNotMatch(`${calculating}\n${firstLook}`, /生命智慧档案 · V\{|已经算好|计算已经完成|查看计算结果/);
  assert.match(page, /AI 体验额度不足，获取帮助/);
  assert.match(page, /本次体验额度暂时不足/);
  assert.match(page, /profileSteps\.indexOf\("MY-08"\)/);
});

test("PROFILE-02—07 单页完成建档并真实提交公历或农历参数", async () => {
  const page = await readPageSources();
  const form = page.match(/function UnifiedProfileForm[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(page, /id === "PROFILE-02" \? "PROFILE-02—07" : id/);
  assert.match(page, /<UnifiedProfileForm data=\{data\} onChange=\{setData\} onNext=\{previewProfile\}/);
  assert.match(form, /选择出生日期历法/);
  assert.match(form, />公历<\/button>/);
  assert.match(form, />农历<\/button>/);
  assert.match(form, /系统会保留农历原始日期并统一换算/);
  assert.match(form, /真太阳时校正正在准备/);
  assert.match(form, /aria-checked="false"/);
  assert.match(page, /calendarType: data\.calendarType/);
  assert.match(page, /isLeapMonth: data\.calendarType === "LUNAR" && data\.isLeapMonth/);
  assert.doesNotMatch(page, /id === "PROFILE-02"[\s\S]{0,180}保存退出/);
});

test("MY-02 将出生时间精度枚举转换为中文", async () => {
  const page = await readPageSources();
  const profile = page.match(/function MyProfile[\s\S]*?\n}\n/)?.[0] ?? "";
  for (const label of ["准确到分钟", "大致时间", "只知道时辰", "未提供具体时间"]) assert.match(profile, new RegExp(label));
  assert.doesNotMatch(profile, /birth\?\.timePrecision \|\|/);
});

test("MY-10 复用统一建档组件并真实提交历法与时间精度", async () => {
  const page = await readPageSources();
  const newPerson = page.match(/function NewPersonArchive[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(newPerson, /<UnifiedProfileForm/);
  assert.match(newPerson, /variant="other"/);
  assert.match(page, /calendarType: otherData\.calendarType/);
  assert.match(page, /isLeapMonth: otherData\.calendarType === "LUNAR" && otherData\.isLeapMonth/);
  assert.match(page, /birthTimeFromProfileData\(otherData\.accuracy, otherData\.time\)/);
  assert.match(page, /timePrecision: "DATE_ONLY"/);
  assert.match(page, /life-card-unknown-overlay/);
  assert.match(page, /与我的关系/);
  assert.match(page, /资料来源正当/);
});

test("MY-09 新增人物在 MY-11 确认后直接返回档案库", async () => {
  const page = await readPageSources();
  const confirmFlow = page.match(/async function confirmOtherProfile[\s\S]*?\n  }\n/)?.[0] ?? "";
  const confirmPage = page.match(/function ArchiveConfirm[\s\S]*?\n\nfunction ArchiveGenerating/)?.[0] ?? "";
  assert.match(page, /id === "MY-09"[\s\S]*?onAdd=\{\(\) => setStep\(112\)\}/);
  assert.match(page, /id === "MY-10"[\s\S]*?onNext=\{createOtherProfile\}/);
  assert.match(page, /id === "MY-11"[\s\S]*?onNext=\{confirmOtherProfile\}/);
  assert.match(confirmFlow, /setProfiles\(await api\.profiles\(\)\); setStep\(111\)/);
  assert.doesNotMatch(confirmFlow, /setStep\(114\)/);
  assert.match(confirmPage, /确认并创建档案/);
  assert.doesNotMatch(confirmPage, /确认并生成四张卡牌/);
});

test("正式生命智慧卡牌使用统一组件、版本映射与失败兜底", async () => {
  const page = await readPageSources();
  const component = await readFile(new URL("../src/components/LifeWisdomCard.tsx", import.meta.url), "utf8");
  const css = await readCssSources();
  assert.match(page, /LifeWisdomCardRow/);
  assert.equal((page.match(/<LifeWisdomCardRow/g) || []).length >= 4, true);
  assert.match(component, /data-card-code/);
  assert.match(component, /data-deck/);
  assert.match(component, /card\.assetUrl/);
  assert.match(component, /onError=.*setFailed/);
  assert.match(component, /life-card-back/);
  assert.match(component, /<footer>\{card\.title\}<\/footer>/);
  assert.doesNotMatch(component, /card\.ganzhi/);
  assert.match(css, /\.life-card-visual/);
});

test("R1.0 用户可见品牌统一为横排初见 · FRESH", async () => {
  const page = await readPageSources();
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const card = await readFile(new URL("../src/components/LifeWisdomCard.tsx", import.meta.url), "utf8");
  assert.match(page, /初见/);
  assert.match(page, /FRESH/);
  assert.match(layout, /初见 · FRESH/);
  assert.match(card, />初见<\/span>/);
  assert.doesNotMatch(`${page}\n${layout}\n${card}`, /身心游|SATORI/);
});

test("初见视觉规范、设计令牌与公共基础组件已经固化", async () => {
  const page = await readPageSources();
  const css = await readCssSources();
  const primitives = await readFile(new URL("../src/components/FreshPrimitives.tsx", import.meta.url), "utf8");
  const spec = await readFile(new URL("../../docs/初见·FRESH-视觉与组件设计规范.md", import.meta.url), "utf8");

  for (const token of ["--color-brand-primary", "--color-text-primary", "--space-4", "--radius-md", "--shadow-focus", "--motion-normal"]) {
    assert.match(css, new RegExp(token));
  }
  assert.match(css, /\.fresh-button--primary/);
  assert.match(css, /\.fresh-icon-button/);
  assert.match(primitives, /export function FreshButton/);
  assert.match(primitives, /export function BackButton/);
  assert.match(primitives, /export function FreshSurface/);
  assert.match(page, /import \{ BackButton, FreshButton \} from "@\/src\/components\/FreshPrimitives"/);
  assert.equal((page.match(/<BackButton/g) || []).length >= 5, true);
  assert.match(spec, /状态：已固化/);
  assert.match(spec, /H5 原型、R1\.0 及后续 Release/);
});

test("R1.0 DAILY-01—03 始终展示真实智慧种子余额", async () => {
  const page = await readPageSources();
  const dailyHeader = page.match(/function DailyHeader[\s\S]*?\n}/)?.[0] ?? "";
  const payment = page.match(/export function SeedPayment[\s\S]*?\n}\n\nexport function DailyGenerating/)?.[0] ?? "";
  const start = page.match(/export function DailyStart[\s\S]*?\n}\n\nexport function SeedPayment/)?.[0] ?? "";
  const createDaily = page.match(/async function startDailyInsight[\s\S]*?\n  }/)?.[0] ?? "";

  assert.match(page, /const availableBalance = account\?\.available \?\? null/);
  for (const id of ["DAILY-01", "PAY-01", "DAILY-02", "DAILY-03"]) {
    assert.match(page, new RegExp(`id === "${id}"[\\s\\S]{0,220}balance=\\{availableBalance\\}`));
  }
  assert.match(dailyHeader, /balance: number \| null/);
  assert.match(dailyHeader, /balance \?\? "—"/);
  assert.doesNotMatch(dailyHeader, /balance = 3/);
  assert.match(start, /<DailyHeader onBack=\{onBack\} balance=\{balance\}/);
  assert.match(payment, /const syncing = balance === null/);
  assert.match(payment, /disabled=\{busy \|\| syncing\}/);
  assert.match(createDaily, /await loadOverview\(\);/);
});

test("R1.1 每日能量由服务端按固定顺序选择会员、权益包或智慧种子", async () => {
  const [daily, legacy, environment] = await Promise.all([
    readFile(new URL("../src/features/daily/DailyScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/legacy/LegacyProfileFlow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../backend/packages/infrastructure/src/config/environment.ts", import.meta.url), "utf8"),
  ]);
  assert.match(daily, /costLabel="1 次今日能量权益"/);
  assert.match(daily, /<SeedPayment[^>]*unified/);
  assert.match(legacy, /会员 → 权益包 → 智慧种子/);
  assert.match(legacy, /成功核销，失败自动释放/);
  assert.match(environment, /DAILY_INSIGHT_CONSUMPTION_MODE:[\s\S]*default\('UNIFIED'\)/);
});

test("R1.1 内部入口统一进入新版商城与会员中心", async () => {
  const [profileFlow, readingFlow] = await Promise.all([
    readFile(new URL("../src/features/legacy/LegacyProfileFlow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reading/ReadingFlowScreen.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(profileFlow, /membership: "\/my\/membership"/);
  assert.match(profileFlow, /services: "\/shop"/);
  assert.match(readingFlow, /target === "services"\) router\.push\(ROUTES\.shop\)/);
});

test("MY-18 不再通过页面内容硬编码调试编号", async () => {
  const page = await readPageSources();
  const firstLook = page.match(/function FirstLookArchive[\s\S]*?\n\nfunction EditSelfProfile/)?.[0] ?? "";
  assert.match(firstLook, /生命智慧初识/);
  assert.doesNotMatch(firstLook, /R1\.0 · MY-18/);
});

test("用户协议与隐私政策进入安全且可读的前端阅读页", async () => {
  const ui = await readFile(new URL("../src/shared/ui.tsx", import.meta.url), "utf8");
  const legal = await readFile(new URL("../app/legal/page.tsx", import.meta.url), "utf8");
  const css = await readCssSources();
  assert.match(ui, /`\/legal\?documentId=\$\{encodeURIComponent\(document\.documentId\)\}`/);
  assert.doesNotMatch(ui, /return document \? `\/api\/v1\/legal-documents/);
  assert.match(legal, /fetch\(`\/api\/v1\/legal-documents\/\$\{encodeURIComponent\(documentId\)\}`/);
  assert.match(legal, /function MarkdownDocument/);
  assert.match(legal, /<table>/);
  assert.match(legal, /<blockquote/);
  assert.doesNotMatch(legal, /dangerouslySetInnerHTML/);
  assert.match(css, /\.legal-markdown/);
  assert.match(css, /\.legal-table-wrap/);
});
test("所有图形 Logo 均统一展示初见与 FRESH", async () => {
  const page = await readPageSources();
  const css = await readCssSources();
  const brand = page.match(/function Brand[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(brand, /<strong>初见<\/strong><small>FRESH<\/small>/);
  assert.doesNotMatch(brand, /!compact/);
  assert.match(css, /\.brand-compact \.brand-mark/);
  assert.match(css, /\.brand-compact strong/);
});

test("AUTH-02 移除重复协议文案但 AUTH-04 保留正式协议确认", async () => {
  const welcome = await readFile(new URL("../src/features/auth/WelcomeScreen.tsx", import.meta.url), "utf8");
  const login = await readFile(new URL("../src/features/auth/LoginScreen.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(welcome, /继续即表示你已阅读并同意/);
  assert.match(login, /我已阅读并同意/);
  assert.match(login, /legalHref\(bootstrap,"TERMS_OF_SERVICE"\)/);
  assert.match(login, /legalHref\(bootstrap,"PRIVACY_POLICY"\)/);
});
test("HOME-01 生命动画提高枝叶与金色线条可见度", async () => {
  const css = await readCssSources();
  assert.match(css, /\.home-growth-scene \.life-growth\{[^}]*opacity:\.62/);
  assert.match(css, /\.home-growth-scene \.living-stem\{[^}]*#d2aa63/);
  assert.match(css, /\.home-growth-scene \.living-leaf\{[^}]*rgba\(232,204,145,\.78\)/);
  assert.match(css, /\.home-growth-scene \.living-leaf::after\{[^}]*rgba\(235,203,137,\.82\)/);
});

test("HOME-01 完整展示生长动画且不出现底部横向滚动条", async () => {
  const css = await readCssSources();
  assert.match(css, /\.home-energy-card \.home-growth-scene\{[^}]*min-height:clamp\(148px,18svh,172px\)[^}]*overflow:visible/);
  assert.match(css, /\.home-flow \.today-home\{[^}]*overflow-x:hidden[^}]*overflow-y:auto[^}]*scrollbar-width:none/);
  assert.match(css, /\.home-flow \.today-home::-webkit-scrollbar\{display:none\}/);
  assert.doesNotMatch(css, /\.home-flow \.today-home\{[^}]*scrollbar-width:thin/);
});

test("H5 阅读正文、底部导航与多端断点保持可读", async () => {
  const css = await readCssSources();
  assert.match(css, /\.main-nav button \{[^}]*min-height: 44px;[^}]*font-size: clamp\(12px, 3\.2vw, 14px\)/s);
  assert.match(css, /\.first-look-cover p \{[^}]*font-size: clamp\(14px, 3\.8vw, 16px\)[^}]*line-height: 1\.9/s);
  assert.match(css, /\.first-look-voices p \{[^}]*font-size: clamp\(14px, 3\.8vw, 16px\)[^}]*line-height: 1\.85/s);
  assert.match(css, /@media \(max-width: 520px\) \{[\s\S]*?height: 100dvh;[\s\S]*?min-height: 0;/);
  assert.match(css, /@media \(min-width: 521px\) \{[\s\S]*?width: min\(calc\(100vw - 48px\), 680px\)/);
  assert.match(css, /@media \(min-width: 960px\) \{[\s\S]*?width: min\(calc\(100vw - 80px\), 760px\)/);
});

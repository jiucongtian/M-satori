import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("服务端首屏渲染中性 Session 恢复态，避免老用户闪现欢迎页", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /正在恢复登录状态/);
  assert.match(html, /正在回到属于你的今日/);
  assert.doesNotMatch(html, /R1\.0 · AUTH-02/);
});

test("AUTH-02 不展示已有档案快捷入口，新用户礼物按后端额度显示", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const welcome = page.match(/view === "welcome" \? \([\s\S]*?\) : view === "login"/)?.[0] ?? "";
  const gift = page.match(/function SeedGift[\s\S]*?\n}\n\nfunction TodayHome/)?.[0] ?? "";
  assert.doesNotMatch(welcome, /已有档案/);
  assert.match(page, /amount=\{home\?\.registrationReward\.wisdomSeedAmount \?\? 18\}/);
  assert.match(gift, /<span>\{amount\}<\/span>/);
  assert.match(gift, /收下 \$\{amount\} 颗智慧种子/);
  assert.doesNotMatch(gift, /收下 3 颗智慧种子|<span>3<\/span>|<strong>3 颗<\/strong>/);
});

test("AUTH-04 使用统一资料用途文案且不展示内部协议规则编号", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const login = page.match(/view === "login" \? \([\s\S]*?\) : view === "recovery"/)?.[0] ?? "";
  assert.match(login, /并知晓相关资料的用途/);
  assert.doesNotMatch(login, /并知晓出生资料的用途|AUTH-05 · 协议与隐私确认/);
});

test("AUTH-03 与 AUTH-02 复用左上角品牌布局且不提供返回", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const login = page.match(/view === "login" \? \([\s\S]*?\) : view === "recovery"/)?.[0] ?? "";
  assert.match(login, /<header className="brand-row login-header">\s*<Brand \/>\s*<\/header>/);
  assert.doesNotMatch(login, /back-button|返回欢迎页|login-brand|Brand compact/);
});

test("页面编号仅在显式开启的研发与测试构建中显示", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const component = page.match(/const showPageDebugLabels[\s\S]*?function PageDebugLabel[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(component, /process\.env\.NEXT_PUBLIC_SHOW_PAGE_LABELS === "true"/);
  assert.match(component, /if \(!showPageDebugLabels\) return null/);
  assert.equal((page.match(/className="screen-id"/g) || []).length, 1);
  assert.ok((page.match(/<PageDebugLabel>/g) || []).length >= 3);

  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(packageJson.scripts.dev, /NEXT_PUBLIC_SHOW_PAGE_LABELS=true/);
  assert.doesNotMatch(packageJson.scripts["build:static"], /NEXT_PUBLIC_SHOW_PAGE_LABELS=true/);
  assert.match(packageJson.scripts["build:test:static"], /NEXT_PUBLIC_SHOW_PAGE_LABELS=true/);
});

test("正式工程包含完整原型基础样式", async () => {
  const formalCss = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  for (const selector of [".stage", ".phone", ".hero-copy", ".login-page", ".profile-flow", ".today-home", ".my-home"]) {
    assert.match(formalCss, new RegExp(selector.replace(".", "\\.")));
  }
  assert.ok(formalCss.length > 50_000);
});

test("R1.0 主导航展示五项且三个未来模块只进入预告页", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const nav = page.match(/function MainNav[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(nav, /\["今日", 10/);
  assert.match(nav, /\["我的", 21/);
  assert.match(nav, /PREVIEW-READ/);
  assert.match(nav, /PREVIEW-GROWTH/);
  assert.match(nav, /PREVIEW-RELATIONSHIP/);
  assert.doesNotMatch(nav, /\["问事", 29|\["成长", 43|\["关系", 44/);
});

test("R1.0 可达页面白名单不包含后续版本模块", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const scope = page.match(/const r1StepIds = new Set\(\[[\s\S]*?\]\);/)?.[0] ?? "";
  for (const id of ["PROFILE-01", "PROFILE-11", "GIFT-01", "HOME-01", "DAILY-03", "MY-01", "MY-03", "MY-09", "MY-16"]) {
    assert.match(scope, new RegExp(`"${id}"`));
  }
  assert.match(scope, /PREVIEW-READ/);
  assert.match(scope, /PREVIEW-GROWTH/);
  assert.match(scope, /PREVIEW-RELATIONSHIP/);
  assert.doesNotMatch(scope.replaceAll("PREVIEW-READ", "").replaceAll("PREVIEW-GROWTH", "").replaceAll("PREVIEW-RELATIONSHIP", ""), /READ-|GRW-|REL-|LIFE-|PER-|SHOP-|GOODS-|ORDER-/);
});

test("R1.0 我的页面不展示后续版本入口", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const myHome = page.match(/function MyHome[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(myHome, /每日指引记录/);
  assert.match(myHome, /生命智慧档案库/);
  assert.match(myHome, /智慧种子/);
  assert.doesNotMatch(myHome, /商城|助学童子|生命之光|月运|年运|关系匹配/);
});

test("R1.0 智慧种子统一为不可交易的 AI 体验额度", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const gift = page.match(/function SeedGift[\s\S]*?\n}\n/)?.[0] ?? "";
  const daily = page.match(/function SeedPayment[\s\S]*?\n}\n/)?.[0] ?? "";
  const seeds = page.match(/function MySeeds[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(gift, /AI 体验额度/);
  assert.match(gift, /不可购买、充值、提现、转赠或交易/);
  assert.match(daily, /确认后将预留体验额度/);
  assert.match(daily, /未形成有效内容会自动恢复/);
  assert.match(daily, /AI 体验额度不足/);
  assert.match(seeds, /可用 AI 体验额度/);
  assert.match(seeds, /仅用于 AI 体验/);
  for (const component of [gift, daily, seeds]) {
    assert.doesNotMatch(component, /统一的价值凭证|购买智慧种子|确认支付|现金兑换/);
  }
});

test("R1.0 AI 与确定性知识内容分别展示准确边界声明", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
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
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const scope = page.match(/const r1StepIds = new Set\(\[[\s\S]*?\]\);/)?.[0] ?? "";
  for (const id of ["SHOP-01", "SEED-01", "SEED-02", "SEED-03", "GOODS-01", "GOODS-05", "ORDER-01"]) {
    assert.doesNotMatch(scope, new RegExp(`"${id}"`));
  }
});

test("MY-02 进入 MY-17 完整编辑档案闭环", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
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
  assert.match(editor, /unified-time-row/);
  assert.match(editor, /edit-gender-options/);
  assert.doesNotMatch(profile, /编辑功能正在完善中/);
  assert.doesNotMatch(profile, /编辑出生资料|查看版本与历史影响/);
});

test("R1.0 所有建档入口均跳过并隐藏太阳时地区选择", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const flow = page.match(/function ProfileFlow[\s\S]*?\n}\n\nfunction FlowStep/)?.[0] ?? "";
  const editSelf = page.match(/function EditSelfProfile[\s\S]*?function MySeeds/)?.[0] ?? "";
  const newPerson = page.match(/function NewPersonArchive[\s\S]*?function ArchiveConfirm/)?.[0] ?? "";
  assert.match(page, /R1_UNSELECTED_LOCATION_ID = "loc_cn_330100"/);
  assert.match(flow, /const effectiveStep = step === 4 \? 5 : step/);
  assert.match(flow, /id === "PROFILE-04"\) return setStep\(5\)/);
  assert.match(flow, /id === "PROFILE-07"\) return setStep\(3\)/);
  assert.doesNotMatch(flow, /BIRTH REGION|太阳时地区|地区校正|region-unavailable/);
  for (const component of [editSelf, newPerson]) {
    assert.doesNotMatch(component, /太阳时地区|地区校正|region-unavailable|searchLocations|place-result|出生地点<\/span><input/);
  }
});

test("PROFILE-11 可从 MY-02 进入 MY-18 长期回看", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
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

test("PROFILE-08 自动生成预览，点击开启后跳过 PROFILE-10 进入初见生成态", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const flow = page.match(/function ProfileFlow[\s\S]*?\n}\n\nfunction FlowStep/)?.[0] ?? "";
  const calculating = page.match(/function Calculating[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(flow, /id !== "PROFILE-08"/);
  assert.match(flow, /api\.previewProfile/);
  assert.match(flow, /setTimeout\(\(\) => active && setCalculationStage\(1\), 500\)/);
  assert.match(flow, /setTimeout\(\(\) => active && setCalculationStage\(2\), 1100\)/);
  assert.match(flow, /setTimeout\(\(\) => active && setCalculationStage\(3\), 1700\)/);
  assert.match(flow, /setCalculationStage\(4\)/);
  assert.doesNotMatch(flow, /setStep\(7\)/);
  assert.match(flow, /onDone=\{\(\) => void confirmProfile\(\)\}/);
  assert.match(flow, /setFirstLookLoading\(true\);\s*setStep\(8\)/);
  assert.match(calculating, /index < stage/);
  assert.match(calculating, /done \? "✓" : active \? "●" : "○"/);
  assert.match(calculating, /开启后会自动生成并打开详情/);
  assert.match(calculating, /重新生成/);
  assert.doesNotMatch(calculating, /className="done">✓ 校验/);
});

test("PROFILE-08 不展示保存退出操作", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /id !== "PROFILE-02" && id !== "PROFILE-08" && id !== "PROFILE-10"/);
});

test("PROFILE-11 请求失败后回读后端持久化失败状态", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const generation = page.match(/async function generateFirstLook[\s\S]*?\n  }\n\n  async function openFirstLookArchive/)?.[0] ?? "";
  assert.match(generation, /await api\.generateProfileFirstLook\(revisionId\)/);
  assert.match(generation, /setFirstLook\(await api\.profileFirstLook\(revisionId\)\)/);
  assert.match(generation, /setApiError\(apiMessage\(error\)\)/);
});

test("PROFILE-08 开启初见时防止并发重复确认并恢复已激活的档案版本", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const confirmation = page.match(/async function confirmProfile\(\) \{[\s\S]*?\n  \}\n\n  async function claimReward/)?.[0] ?? "";
  assert.match(page, /const confirmingRevisionRef = useRef<string \| null>\(null\)/);
  assert.match(confirmation, /confirmingRevisionRef\.current === revision\.revisionId/);
  assert.match(confirmation, /PROFILE_REVISION_ALREADY_CONFIRMED/);
  assert.match(confirmation, /await api\.profileRevision\(revisionToConfirm\.revisionId\)/);
  assert.match(confirmation, /persistedRevision\.status !== "ACTIVE"/);
  assert.match(confirmation, /setRevision\(persistedRevision\)/);
  assert.match(confirmation, /confirmingRevisionRef\.current = null/);
});

test("HOME-01 使用最新高中特低能量指引卡并保留真实数据入口", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
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
  assert.match(css, /\.home-energy-card button\{width:auto;min-width:0;height:auto;margin:3px 0 0 auto/);
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
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const dailyEnergyLevel = home\?\.dailyEnergySummary\.data\?\.energyLevel/);
  for (const component of ["DailyStart", "DailyReport", "DailyShare", "ShareOptions", "ShareGenerating", "ShareSuccess"]) {
    const source = page.match(new RegExp(`function ${component}[\\s\\S]*?\\n}`))?.[0] ?? "";
    assert.match(source, /energyLevel\?: EnergyLevel/);
    assert.match(source, /\{energyLevel \?\? "—"\}/);
    assert.doesNotMatch(source, />中</);
  }
});

test("HOME-01 今日能量卡使用轻透疗愈层次而非厚重实色", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.daily-guide \{[^}]*rgba\(99,138,117,\.82\)/);
  assert.match(css, /backdrop-filter:blur\(10px\)/);
  assert.match(css, /\.daily-guide:before/);
  assert.match(css, /\.daily-guide:after/);
});

test("三个预告页统一说明后续上线与未来能力", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const preview = page.match(/function ComingSoonPage[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(preview, /这片新的枝叶正在生长/);
  assert.match(preview, /将在后续版本与你见面/);
  assert.match(preview, /未来将支持/);
  assert.match(preview, /我知道了，返回今日/);
});

test("预告页保持单屏且底部导航位置稳定", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.coming-soon-page\{[^}]*height:100%[^}]*overflow:hidden[^}]*display:flex/);
  assert.match(css, /\.today-home>\.main-nav,\.my-home>\.main-nav,\.coming-soon-page>\.main-nav\{[^}]*position:absolute[^}]*left:-9px[^}]*right:-9px[^}]*bottom:0[^}]*height:52px[^}]*grid-template-columns:repeat\(5,1fr\)/);
});

test("五个根页面切换时不重新执行整页入场动画", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.today-home,\.my-home\{animation:none\}/);
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

test("手机号登录后按后端真实档案状态分流，老用户直接进入 HOME-01", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const session = await createSessionWithCurrentConsents\(\)/);
  assert.match(page, /session\.user\.requiresConsent \|\| session\.nextAction === "ACCEPT_CONSENTS"/);
  assert.match(page, /const me = await api\.me\(\)/);
  assert.match(page, /stepForAction\(me\.nextAction \|\| session\.nextAction\)/);
  assert.match(page, /if \(action === "CREATE_TODAY_DAILY_INSIGHT" \|\| action === "VIEW_HOME"\) return 10/);
});

test("R1 核心页面调用真实后端能力", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const call of ["api.sendSms", "api.createSession", "api.logout", "api.previewProfile", "api.confirmProfile", "api.generateProfileFirstLook", "api.profileFirstLook", "api.claimRegistrationReward", "api.createTodayInsight", "api.generationTask", "api.createProfile", "api.previewOtherProfile", "api.confirmOtherProfile", "api.deleteProfile"]) {
    assert.match(page, new RegExp(call.replace(".", "\\.")));
  }
  assert.match(page, /api\.createSession\(challengeId, code, consentAcceptances\)/);
  assert.match(page, /const session = await createSessionWithCurrentConsents\(\);[\s\S]*?session\.user\.requiresConsent \|\| session\.nextAction === "ACCEPT_CONSENTS"[\s\S]*?await acceptCurrentConsents\(\);[\s\S]*?const me = await api\.me\(\);[\s\S]*?stepForAction\(me\.nextAction \|\| session\.nextAction\)/);
  assert.match(page, /action === "CONFIRM_PROFILE" \|\| action === "CLAIM_REGISTRATION_REWARD"\) return 10/);
  assert.doesNotMatch(page, /验证码已发送，原型中/);
  assert.doesNotMatch(page, /原型中直接查看结果/);
});

test("老用户恢复 Session 前使用中性恢复态，不渲染 AUTH-02", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const \[sessionReady, setSessionReady\] = useState\(false\)/);
  assert.match(page, /!sessionReady \? <SessionRestoring \/> : view === "welcome"/);
  assert.match(page, /finally\(\(\) => active && setSessionReady\(true\)\)/);
});

test("协议版本更新时阻止空接受列表并为新旧 Session 完成补充确认", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const client = await readFile(new URL("../src/api/client.ts", import.meta.url), "utf8");
  assert.match(page, /const currentBootstrap = await api\.bootstrap\(\)/);
  assert.match(page, /requiredConsentAcceptances\(currentBootstrap\)/);
  assert.match(page, /error\.code !== "LEGAL_DOCUMENT_VERSION_INVALID"/);
  assert.match(page, /isConsentRequired\(error\)[\s\S]*?setView\("consent"\)/);
  assert.match(page, /function ConsentUpdate/);
  assert.match(page, /await api\.acceptConsents\(acceptances\)/);
  assert.match(client, /acceptConsents\(acceptances:[\s\S]*?"\/me\/consents"/);
});

test("MY-04 打开的每日指引详情返回 MY-01", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /setDailyReturnStep\(21\); setStep\(14\)/);
  assert.match(page, /onBack=\{\(\) => setStep\(dailyReturnStep\)\}/);
});

test("R1.0 我的页面收口账户、联系入口并使用通栏智慧种子卡片", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const myHome = page.match(/function MyHome[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(myHome, /账号与退出/);
  assert.match(myHome, /联系我们/);
  assert.doesNotMatch(myHome, /消息与帮助/);
  assert.match(css, /\.my-assets\{grid-template-columns:1fr\}/);
});

test("R1.0 退出登录二次确认且联系我们突出客服、官媒依次下沉", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const settings = page.match(/function MySettings[\s\S]*?\n}\n/)?.[0] ?? "";
  const support = page.match(/function MySupport[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(settings, /确认退出当前账号/);
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
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const archive = page.match(/function WisdomArchive[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(archive, /进入详情/);
  assert.doesNotMatch(archive, /\?"私人记录":"待完善"/);
});

test("MY-13 复用档案结构并只保留编辑和一次删除确认", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
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
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /const headerlessSteps = new Set\(\[\.\.\.standaloneSteps, "PROFILE-11", "GIFT-01"\]\)/);
  assert.match(page, /!headerlessSteps\.has\(id\) && <header className="flow-header">/);
  assert.match(page, /headerlessSteps\.has\(id\) \? " headerless-flow"/);
  assert.match(css, /\.profile-flow\.headerless-flow\{height:100%;min-height:0;overflow:hidden\}/);
});

test("PROFILE-08/11 直达初见详情、四张卡牌置顶且 PAY-01 提供客服帮助闭环", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const calculating = page.match(/function Calculating[\s\S]*?\n}\n/)?.[0] ?? "";
  const firstLook = page.match(/function RelationshipFirstLook[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(calculating, /<span>成档<\/span>/);
  assert.match(calculating, /对齐你的生命节律/);
  assert.match(calculating, /生成四张关系卡牌/);
  assert.match(calculating, /开启档案初见/);
  assert.match(firstLook, /<FirstLookCardPanel revision=\{revision\} \/>/);
  assert.doesNotMatch(page, /function ProfileResult/);
  assert.doesNotMatch(page, /\{id === "PROFILE-10"/);
  assert.doesNotMatch(`${calculating}\n${firstLook}`, /生命智慧档案 · V\{|已经算好|计算已经完成|查看计算结果/);
  assert.match(page, /AI 体验额度不足，获取帮助/);
  assert.match(page, /本次体验额度暂时不足/);
  assert.match(page, /profileSteps\.indexOf\("MY-08"\)/);
});

test("PROFILE-02—07 单页完成建档并真实提交公历或农历参数", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
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
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const profile = page.match(/function MyProfile[\s\S]*?\n}\n/)?.[0] ?? "";
  for (const label of ["准确到分钟", "大致时间", "只知道时辰", "未提供具体时间"]) assert.match(profile, new RegExp(label));
  assert.doesNotMatch(profile, /birth\?\.timePrecision \|\|/);
});

test("MY-10 复用统一建档组件并真实提交历法与时间精度", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const newPerson = page.match(/function NewPersonArchive[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(newPerson, /<UnifiedProfileForm/);
  assert.match(newPerson, /variant="other"/);
  assert.match(page, /calendarType: otherData\.calendarType/);
  assert.match(page, /isLeapMonth: otherData\.calendarType === "LUNAR" && otherData\.isLeapMonth/);
  assert.match(page, /otherData\.accuracy === "准确到分钟" \? "EXACT_MINUTE"/);
  assert.match(page, /与我的关系/);
  assert.match(page, /资料来源正当/);
});

test("MY-09 新增人物在 MY-11 确认后直接返回档案库", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
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
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const component = await readFile(new URL("../src/components/LifeWisdomCard.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
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
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const card = await readFile(new URL("../src/components/LifeWisdomCard.tsx", import.meta.url), "utf8");
  assert.match(page, /初见/);
  assert.match(page, /FRESH/);
  assert.match(layout, /初见 · FRESH/);
  assert.match(card, />初见<\/span>/);
  assert.doesNotMatch(`${page}\n${layout}\n${card}`, /身心游|SATORI/);
});

test("R1.0 DAILY-01—03 始终展示真实智慧种子余额", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const dailyHeader = page.match(/function DailyHeader[\s\S]*?\n}/)?.[0] ?? "";
  const payment = page.match(/function SeedPayment[\s\S]*?\n}\n\nfunction DailyGenerating/)?.[0] ?? "";
  const start = page.match(/function DailyStart[\s\S]*?\n}\n\nfunction SeedPayment/)?.[0] ?? "";
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

test("MY-18 不再通过页面内容硬编码调试编号", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const firstLook = page.match(/function FirstLookArchive[\s\S]*?\n\nfunction EditSelfProfile/)?.[0] ?? "";
  assert.match(firstLook, /生命智慧初识/);
  assert.doesNotMatch(firstLook, /R1\.0 · MY-18/);
});

test("用户协议与隐私政策进入安全且可读的前端阅读页", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const legal = await readFile(new URL("../app/legal/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /`\/legal\.html\?documentId=\$\{encodeURIComponent\(document\.documentId\)\}`/);
  assert.doesNotMatch(page, /return document \? `\/api\/v1\/legal-documents/);
  assert.match(legal, /fetch\(`\/api\/v1\/legal-documents\/\$\{encodeURIComponent\(documentId\)\}`/);
  assert.match(legal, /function MarkdownDocument/);
  assert.match(legal, /<table>/);
  assert.match(legal, /<blockquote/);
  assert.doesNotMatch(legal, /dangerouslySetInnerHTML/);
  assert.match(css, /\.legal-markdown/);
  assert.match(css, /\.legal-table-wrap/);
});

test("所有图形 Logo 均统一展示初见与 FRESH", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const brand = page.match(/function Brand[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(brand, /<strong>初见<\/strong><small>FRESH<\/small>/);
  assert.doesNotMatch(brand, /!compact/);
  assert.match(css, /\.brand-compact \.brand-mark/);
  assert.match(css, /\.brand-compact strong/);
});

test("AUTH-02 移除重复协议文案但 AUTH-04 保留正式协议确认", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const welcome = page.match(/view === "welcome" \? \([\s\S]*?\) : view === "login"/)?.[0] ?? "";
  const login = page.match(/view === "login" \? \([\s\S]*?\) : view === "recovery"/)?.[0] ?? "";
  assert.doesNotMatch(welcome, /继续即表示你已阅读并同意/);
  assert.match(login, /我已阅读并同意/);
  assert.match(login, /legalHref\("TERMS_OF_SERVICE"\)/);
  assert.match(login, /legalHref\("PRIVACY_POLICY"\)/);
});

test("HOME-01 生命动画提高枝叶与金色线条可见度", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.home-growth-scene \.life-growth\{[^}]*opacity:\.62/);
  assert.match(css, /\.home-growth-scene \.living-stem\{[^}]*#d2aa63/);
  assert.match(css, /\.home-growth-scene \.living-leaf\{[^}]*rgba\(232,204,145,\.78\)/);
  assert.match(css, /\.home-growth-scene \.living-leaf::after\{[^}]*rgba\(235,203,137,\.82\)/);
});

test("HOME-01 完整展示生长动画且不出现底部横向滚动条", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.home-energy-card \.home-growth-scene\{[^}]*min-height:clamp\(148px,18svh,172px\)[^}]*overflow:visible/);
  assert.match(css, /\.home-flow \.today-home\{[^}]*overflow-x:hidden[^}]*overflow-y:auto[^}]*scrollbar-width:none/);
  assert.match(css, /\.home-flow \.today-home::-webkit-scrollbar\{display:none\}/);
  assert.doesNotMatch(css, /\.home-flow \.today-home\{[^}]*scrollbar-width:thin/);
});

test("H5 阅读正文、底部导航与多端断点保持可读", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.main-nav button \{[^}]*min-height: 44px;[^}]*font-size: clamp\(12px, 3\.2vw, 14px\)/s);
  assert.match(css, /\.first-look-cover p \{[^}]*font-size: clamp\(14px, 3\.8vw, 16px\)[^}]*line-height: 1\.9/s);
  assert.match(css, /\.first-look-voices p \{[^}]*font-size: clamp\(14px, 3\.8vw, 16px\)[^}]*line-height: 1\.85/s);
  assert.match(css, /@media \(max-width: 520px\) \{[\s\S]*?height: 100dvh;[\s\S]*?min-height: 0;/);
  assert.match(css, /@media \(min-width: 521px\) \{[\s\S]*?width: min\(calc\(100vw - 48px\), 680px\)/);
  assert.match(css, /@media \(min-width: 960px\) \{[\s\S]*?width: min\(calc\(100vw - 80px\), 760px\)/);
});

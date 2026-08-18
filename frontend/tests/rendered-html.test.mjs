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

test("R1.0 正式 AI 内容入口展示统一边界声明", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const notice = page.match(/function AiContentNotice[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(notice, /AI 生成内容/);
  assert.match(notice, /不构成医疗、投资、法律建议或对未来结果的保证/);
  for (const name of ["RelationshipFirstLook", "DailyReport", "FirstLookArchive"]) {
    const component = page.match(new RegExp(`function ${name}[\\s\\S]*?\\n}\\n`))?.[0] ?? "";
    assert.match(component, /<AiContentNotice \/>/);
  }
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
  assert.match(profile, /编辑生命智慧档案/);
  assert.match(page, /function EditSelfProfile/);
  assert.match(page, /R1\.0 · MY-17/);
  assert.match(page, /api\.previewProfile/);
  assert.match(page, /api\.confirmProfile/);
  assert.match(page, /本次修改将创建新版本/);
  assert.doesNotMatch(profile, /编辑功能正在完善中/);
  assert.doesNotMatch(profile, /编辑出生资料|查看版本与历史影响/);
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

test("HOME-01 使用最新高中特低能量指引卡并保留真实数据入口", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const home = page.match(/function TodayHome[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(home, /home-energy-card/);
  assert.match(home, /home\?\.dailyEnergySummary\.data/);
  assert.match(home, /summary\?\.energyLevel === level/);
  assert.match(home, /summary\?\.guidance/);
  assert.match(home, /summary\.suitableActions/);
  assert.match(home, /summary\.cautions/);
  assert.doesNotMatch(home, /先稳住自己的节奏，再清醒回应外界的变化/);
  assert.match(home, /适合做什么/);
  assert.match(home, /注意什么/);
  assert.match(home, /home\?\.wisdomSeedAccount\.available/);
  assert.match(home, /ready \? "查看今日能量指引" : "获取今日能量指引"/);
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
  assert.match(page, /const session = await api\.createSession/);
  assert.match(page, /const me = await api\.me\(\)/);
  assert.match(page, /stepForAction\(me\.nextAction \|\| session\.nextAction\)/);
  assert.match(page, /if \(action === "CREATE_TODAY_DAILY_INSIGHT" \|\| action === "VIEW_HOME"\) return 10/);
});

test("R1 核心页面调用真实后端能力", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const call of ["api.sendSms", "api.createSession", "api.logout", "api.searchLocations", "api.previewProfile", "api.confirmProfile", "api.generateProfileFirstLook", "api.profileFirstLook", "api.claimRegistrationReward", "api.createTodayInsight", "api.generationTask", "api.createProfile", "api.previewOtherProfile", "api.confirmOtherProfile", "api.deleteProfile"]) {
    assert.match(page, new RegExp(call.replace(".", "\\.")));
  }
  assert.match(page, /await api\.createSession\(challengeId, code, consentAcceptances\);[\s\S]*?const me = await api\.me\(\);[\s\S]*?stepForAction\(me\.nextAction \|\| session\.nextAction\)/);
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

test("R1.0 退出登录具有二次确认且联系我们展示四个官方二维码", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const settings = page.match(/function MySettings[\s\S]*?\n}\n/)?.[0] ?? "";
  const support = page.match(/function MySupport[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(settings, /确认退出当前账号/);
  assert.match(settings, /继续留在这里/);
  assert.doesNotMatch(settings, /账号安全|隐私中心|数据管理|通知设置|通用设置/);
  for (const channel of ["官方视频号", "官方公众号", "官方小红书", "官方客服"]) assert.match(support, new RegExp(channel));
  for (const asset of ["official-video-channel.png", "official-wechat-account.jpeg", "official-xiaohongshu.png", "official-customer-service.png"]) assert.match(support, new RegExp(asset));
  assert.match(support, /contact-tabs/);
  assert.match(support, /contact-focus/);
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

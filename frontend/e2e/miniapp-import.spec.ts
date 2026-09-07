import { expect, test, type Page } from "@playwright/test";
import { prototypeHome, prototypeProfiles, prototypeRevision } from "../src/shared/prototypeData";

type ImportStatus = "NONE" | "OFFERED" | "ACCEPTED" | "DECLINED" | "COMPLETED";
type Decision = { offerId: string; decision: "ACCEPT" | "DECLINE" };

async function mockAccount(page: Page, options: {
  status?: ImportStatus;
  anonymous?: boolean;
  requiresConsent?: boolean;
  failFirstDecision?: boolean;
  loseDecisionResponse?: boolean;
  staleFirstOffer?: boolean;
  backgroundImport?: boolean;
} = {}) {
  const state = {
    status: options.status ?? "OFFERED" as ImportStatus,
    authenticated: !options.anonymous,
    checks: 0,
    profileChecks: 0,
    offerId: "miniapp-browser-offer",
    submissions: [] as { body: Decision; key: string | undefined }[],
  };
  const me = {
    userId: "miniapp-import-browser-user",
    status: "ACTIVE",
    phoneMasked: "138****1234",
    requiresConsent: options.requiresConsent ?? false,
    createdAt: "2026-09-07T00:00:00.000Z",
    preferences: { timezone: "Asia/Shanghai", locale: "zh-CN" },
    profileState: "ACTIVE",
    nextAction: options.requiresConsent ? "ACCEPT_CONSENTS" : "VIEW_HOME",
  };
  const statusData = () => ({ status: state.status, ...(state.status === "NONE" ? {} : {
    offerId: state.offerId,
    profileCount: 3,
    importedCount: state.status === "COMPLETED" ? 3 : 0,
  }) });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    const reply = (data: unknown) => route.fulfill({ json: { data } });
    if (path === "/auth/sessions/refresh") {
      if (!state.authenticated) return route.fulfill({ status: 401, json: { error: { code: "UNAUTHORIZED" } } });
      return reply({ accessToken: "browser-access-token", accessTokenExpiresAt: "2026-09-08T00:00:00Z" });
    }
    if (path === "/auth/sessions" && request.method() === "POST") {
      state.authenticated = true;
      return reply({ accessToken: "browser-access-token", user: me, nextAction: me.nextAction });
    }
    if (path === "/auth/sms-challenges") return reply({ challengeId: "browser-sms", phoneMasked: me.phoneMasked });
    if (path === "/me") return reply(me);
    if (path === "/me/home-overview") return reply(prototypeHome);
    if (path === "/me/life-profiles") {
      state.profileChecks += 1;
      return reply([prototypeProfiles[0], ...(state.status === "COMPLETED" ? Array.from({ length: 3 }, (_, index) => ({
        ...prototypeProfiles[2], profileId: `imported-friend-${index}`, displayName: `导入后朋友${index + 1}`,
      })) : [])]);
    }
    if (path.startsWith("/me/life-profile/revisions/")) return reply(prototypeRevision);
    if (path === "/app/bootstrap") return reply({ requiredLegalDocuments: [], features: {}, maintenance: { enabled: false } });
    if (path === "/me/miniapp-import") {
      state.checks += 1;
      return reply(statusData());
    }
    if (path === "/me/miniapp-import/decision") {
      const body = request.postDataJSON() as Decision;
      state.submissions.push({ body, key: request.headers()["idempotency-key"] });
      if (options.staleFirstOffer && state.submissions.length === 1) {
        state.offerId = "miniapp-browser-offer-updated";
        return route.fulfill({ status: 409, json: { error: { code: "MINIAPP_OFFER_UNAVAILABLE", message: "导入信息已更新" } } });
      }
      if (options.failFirstDecision && state.submissions.length === 1) return route.abort("failed");
      state.status = body.decision === "ACCEPT" ? options.backgroundImport ? "ACCEPTED" : "COMPLETED" : "DECLINED";
      if (options.loseDecisionResponse && state.submissions.length === 1) return route.abort("failed");
      return reply(statusData());
    }
    return reply([]);
  });
  return state;
}

test("手机号无旧档案时登录恢复不弹提示", async ({ page }) => {
  const state = await mockAccount(page, { status: "NONE" });
  await page.goto("/home");
  await expect.poll(() => state.checks).toBeGreaterThan(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.submissions).toHaveLength(0);
});

test("有匹配资料时明确说明次数和归属，Escape 及背景点击不会替用户决定", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const state = await mockAccount(page);
  await page.goto("/home");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("身心游卡牌微信小程序");
  await expect(dialog).toContainText("3 份");
  await expect(dialog).toContainText("这个导入提醒只会有一次");
  await expect(dialog).toContainText("也不会再有导入机会");
  await expect(dialog).toContainText("关系统一为「朋友」");
  await expect(dialog).toContainText("出生地默认为「北京」，导入后可修改");
  await page.keyboard.press("Escape");
  await page.mouse.click(3, 3);
  await expect(dialog).toBeVisible();
  expect(state.submissions).toHaveLength(0);
  await dialog.getByRole("button", { name: "不导入，放弃此次机会" }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("button", { name: "不导入，放弃此次机会" })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("拒绝保存到服务器，清除本地存储并重新登录恢复仍不提示", async ({ page }) => {
  const state = await mockAccount(page);
  await page.goto("/home");
  await page.getByRole("button", { name: "不导入，放弃此次机会" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.submissions[0].body).toEqual({ offerId: "miniapp-browser-offer", decision: "DECLINE" });
  expect(state.submissions[0].key).toBeTruthy();
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  const previousChecks = state.checks;
  await page.reload();
  await expect.poll(() => state.checks).toBeGreaterThan(previousChecks);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.submissions).toHaveLength(1);
});

test("同意导入成功后显示结果，重新登录恢复不会再次给出导入机会", async ({ page }) => {
  const state = await mockAccount(page);
  await page.goto("/home");
  await page.getByRole("button", { name: "同意导入", exact: true }).click();
  await expect(page.getByRole("heading", { name: "旧档案已导入" })).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("已添加 3 份朋友档案");
  expect(state.submissions[0].body.decision).toBe("ACCEPT");
  await page.getByRole("button", { name: "继续使用" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const previousChecks = state.checks;
  await page.reload();
  await expect.poll(() => state.checks).toBeGreaterThan(previousChecks);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.submissions).toHaveLength(1);
});

test("发送失败后只重试同一选择，复用请求标识避免重复导入", async ({ page }) => {
  const state = await mockAccount(page, { failFirstDecision: true });
  await page.goto("/home");
  await page.getByRole("button", { name: "同意导入", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("暂未收到确认");
  await expect(page.getByRole("button", { name: "不导入，放弃此次机会" })).toHaveCount(0);
  await page.getByRole("button", { name: "重试提交我的选择" }).click();
  await expect(page.getByRole("heading", { name: "旧档案已导入" })).toBeVisible();
  expect(state.submissions).toHaveLength(2);
  expect(state.submissions[0]).toEqual(state.submissions[1]);
});

test("服务器保存后响应丢失会核对最终状态，不重复请求导入", async ({ page }) => {
  const state = await mockAccount(page, { loseDecisionResponse: true });
  await page.goto("/home");
  await page.getByRole("button", { name: "同意导入", exact: true }).click();
  await expect(page.getByRole("heading", { name: "旧档案已导入" })).toBeVisible();
  expect(state.submissions).toHaveLength(1);
});

test("后台导入完成会刷新已打开的档案库，关闭反馈后不会重新弹窗", async ({ page }) => {
  const state = await mockAccount(page, { backgroundImport: true });
  await page.goto("/my/archive");
  await page.getByRole("button", { name: "同意导入", exact: true }).click();
  await expect(page.getByRole("heading", { name: "已收到你的导入选择" })).toBeVisible();
  await page.getByRole("button", { name: "继续使用" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const checksBefore = state.profileChecks;
  state.status = "COMPLETED";
  await expect(page.getByRole("button", { name: /导入后朋友1/ })).toBeVisible({ timeout: 10_000 });
  expect(state.profileChecks).toBeGreaterThan(checksBefore);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.submissions).toHaveLength(1);
});

test("后台完成时只更新尚未关闭的反馈，不重新要求选择", async ({ page }) => {
  const state = await mockAccount(page, { backgroundImport: true });
  await page.goto("/home");
  await page.getByRole("button", { name: "同意导入", exact: true }).click();
  await expect(page.getByRole("heading", { name: "已收到你的导入选择" })).toBeVisible();
  state.status = "COMPLETED";
  await expect(page.getByRole("heading", { name: "旧档案已导入" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "同意导入", exact: true })).toHaveCount(0);
  expect(state.submissions).toHaveLength(1);
});

test("恢复登录时已同意的后台任务静默完成并刷新档案库", async ({ page }) => {
  const state = await mockAccount(page, { status: "ACCEPTED" });
  await page.goto("/my/archive");
  await expect.poll(() => state.checks).toBeGreaterThan(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  state.status = "COMPLETED";
  await expect(page.getByRole("button", { name: /导入后朋友1/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.submissions).toHaveLength(0);
});

test("过期提醒会更新凭证并保留原决定，重试不会持续发送失效的导入信息", async ({ page }) => {
  const state = await mockAccount(page, { staleFirstOffer: true });
  await page.goto("/home");
  await page.getByRole("button", { name: "同意导入", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("已保留你的选择");
  await expect(page.getByRole("button", { name: "不导入，放弃此次机会" })).toHaveCount(0);
  await page.getByRole("button", { name: "重试提交我的选择" }).click();
  await expect(page.getByRole("heading", { name: "旧档案已导入" })).toBeVisible();
  expect(state.submissions).toHaveLength(2);
  expect(state.submissions[0].body).toEqual({ offerId: "miniapp-browser-offer", decision: "ACCEPT" });
  expect(state.submissions[1].body).toEqual({ offerId: "miniapp-browser-offer-updated", decision: "ACCEPT" });
  expect(state.submissions[1].key).not.toBe(state.submissions[0].key);
});

for (const status of ["ACCEPTED", "DECLINED", "COMPLETED"] as const) {
  test(`服务器已记录 ${status} 时任何设备恢复登录都不弹导入提示`, async ({ page }) => {
    const state = await mockAccount(page, { status });
    await page.goto("/home");
    await expect.poll(() => state.checks).toBeGreaterThan(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}

test("匿名状态不查询旧资料，验证码登录成功后出现提示", async ({ page }) => {
  const state = await mockAccount(page, { anonymous: true });
  await page.goto("/login");
  await page.getByLabel("手机号", { exact: true }).fill("13800001234");
  await page.locator(".consent-row .checkmark").click();
  await expect(page.getByRole("checkbox")).toBeChecked();
  expect(state.checks).toBe(0);
  await page.getByRole("button", { name: "获取验证码" }).click();
  await page.getByLabel("验证码", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(state.checks).toBeGreaterThan(0);
});

test("尚未完成协议同意的会话不会提前给出资料导入选择", async ({ page }) => {
  const state = await mockAccount(page, { requiresConsent: true });
  await page.goto("/home");
  await expect(page).toHaveURL(/\/consent/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.checks).toBe(0);
});

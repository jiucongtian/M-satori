import { expect, test, type Page } from "@playwright/test";
import { prototypeHome, prototypeProfiles, prototypeRevision } from "../src/shared/prototypeData";

const source = {
  source: "MINIAPP",
  profileName: "小程序里的原称呼",
  birthInput: { calendarType: "LUNAR", date: { year: 1990, month: 5, day: 3, isLeapMonth: true }, calculationGender: "FEMALE" },
  originalLocalTime: "02:01",
  timeUncertain: true,
  description: "第一行原备注\n第二行仍然保留 <script>不应执行</script>",
  pillars: { year: "甲子", month: "乙丑", day: "丙寅", hour: "丁卯" },
};
const imported = { ...prototypeProfiles[2], profileId: "imported-friend", displayName: "已修改的称呼", currentRevisionId: "imported-revision" };
const ordinary = { ...prototypeProfiles[1], profileId: "ordinary-friend", displayName: "普通人物", currentRevisionId: "ordinary-revision" };
const birthInput = { calendarType: "SOLAR", date: { year: 1990, month: 6, day: 24, isLeapMonth: false }, timePrecision: "EXACT_MINUTE", time: { localTime: "02:01", hourBranchCode: null }, locationId: "loc_cn_110000", calculationGender: "FEMALE" };
const importedBirthInput = { ...birthInput, timePrecision: "HOUR_RANGE", time: { localTime: null, hourBranchCode: "CHOU" } };

async function mockArchive(page: Page, failFirstSource = false) {
  let sourceRequests = 0;
  const previews: Record<string, unknown>[] = [];
  let savedImportedBirth: Record<string, unknown> = importedBirthInput;
  let pendingBirth: Record<string, unknown> = importedBirthInput;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    const reply = (data: unknown) => route.fulfill({ json: { data } });
    if (path === "/auth/sessions/refresh") return reply({ accessToken: "archive-test-token", accessTokenExpiresAt: "2099-01-01T00:00:00Z" });
    if (path === "/me") return reply({ userId: "archive-test-user", status: "ACTIVE", requiresConsent: false, preferences: { timezone: "Asia/Shanghai", locale: "zh-CN" }, profileState: "ACTIVE", nextAction: "VIEW_HOME" });
    if (path === "/me/home-overview") return reply(prototypeHome);
    if (path === "/me/miniapp-import") return reply({ status: "COMPLETED", importedCount: 1 });
    if (path === "/me/life-profiles") return reply([prototypeProfiles[0], imported, ordinary]);
    if (path === "/locations") return reply([{ locationId: "geonames:1796236", displayName: "上海", administrativePath: ["中国", "上海"], countryCode: "CN", timezone: "Asia/Shanghai", coordinates: { latitude: 31.22, longitude: 121.46 } }]);
    if (path === "/me/miniapp-import/profiles/imported-friend") {
      sourceRequests += 1;
      if (failFirstSource && sourceRequests === 1) return route.abort("failed");
      return reply(source);
    }
    if (path === "/me/miniapp-import/profiles/ordinary-friend") return reply(null);
    if (path.endsWith("/revisions/preview")) {
      previews.push(request.postDataJSON());
      pendingBirth = request.postDataJSON().birthInput;
      return reply({ ...prototypeRevision, revisionId: "updated-revision", originalInput: request.postDataJSON().birthInput });
    }
    if (path.endsWith("/confirm")) {
      if (path.includes("imported-friend")) savedImportedBirth = pendingBirth;
      return reply({ ...prototypeRevision, revisionId: "updated-revision", originalInput: pendingBirth });
    }
    if (path.startsWith("/me/life-profile/revisions/")) return reply({ ...prototypeRevision, revisionId: path.split("/").at(-1), originalInput: path.endsWith("imported-revision") ? savedImportedBirth : birthInput });
    if (path === "/me/life-profiles/imported-friend") return reply({ ...imported, ...request.postDataJSON() });
    if (path === "/me/life-profiles/ordinary-friend") return reply({ ...ordinary, ...request.postDataJSON() });
    return reply([]);
  });
  await page.goto("/my/archive");
  await expect(page.locator(".my-header strong").filter({ hasText: "生命智慧档案库" })).toBeVisible();
  return { previews };
}

test("已导入档案保留原称呼、农历闰月、备注和原四柱，窄屏也可查看", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await mockArchive(page);
  await page.getByRole("button", { name: /已修改的称呼/ }).click();
  await page.getByText("查看原小程序资料", { exact: true }).click();
  const details = page.locator(".miniapp-source-details");
  await expect(details).toContainText("小程序里的原称呼");
  await expect(details).toContainText("1990年闰5月3日 · 农历");
  await expect(details).toContainText("02:01 · 时间不确定");
  await expect(details).toContainText(source.description);
  await expect(details.locator("script")).toHaveCount(0);
  for (const pillar of Object.values(source.pillars)) await expect(details.locator(".miniapp-original-pillars")).toContainText(pillar);
  await expect(page.locator(".person-archive-detail>.life-wisdom-card-row .life-wisdom-card")).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await details.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("original-profile-320px.png") });
});

test("原资料加载失败显示重试，重试成功后仍能查看原四柱", async ({ page }) => {
  await mockArchive(page, true);
  await page.getByRole("button", { name: /已修改的称呼/ }).click();
  await expect(page.locator(".miniapp-source-retry")).toContainText("原小程序资料暂时加载失败");
  await page.getByRole("button", { name: "重新加载原资料" }).click();
  await page.getByText("查看原小程序资料", { exact: true }).click();
  await expect(page.locator(".miniapp-source-details")).toContainText("原四柱卡牌");
  await expect(page.locator(".miniapp-source-retry")).toHaveCount(0);
});

test("切换到普通人物不沿用上一份原资料，普通编辑继续保留原出生地", async ({ page }) => {
  const state = await mockArchive(page);
  await page.getByRole("button", { name: /已修改的称呼/ }).click();
  await expect(page.getByText("查看原小程序资料", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回上一页", exact: true }).click();
  await page.getByRole("button", { name: /普通人物/ }).click();
  await expect(page.getByRole("button", { name: "编辑生命智慧档案", exact: true })).toBeEnabled();
  await expect(page.getByText("正在检查原小程序资料…", { exact: true })).toHaveCount(0);
  await expect(page.getByText("查看原小程序资料", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "编辑生命智慧档案", exact: true }).click();
  await expect(page.getByLabel("姓名或你熟悉的称呼")).toHaveValue("普通人物");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect.poll(() => state.previews.length).toBe(1);
  expect((state.previews[0].birthInput as typeof birthInput).locationId).toBe("loc_cn_110000");
});

test("编辑导入档案保留默认北京和原时辰范围，原资料入口继续保留", async ({ page }) => {
  const state = await mockArchive(page);
  await page.getByRole("button", { name: /已修改的称呼/ }).click();
  await page.getByRole("button", { name: "编辑生命智慧档案", exact: true }).click();
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect.poll(() => state.previews.length).toBe(1);
  expect((state.previews[0].birthInput as typeof birthInput).locationId).toBe("loc_cn_110000");
  expect((state.previews[0].birthInput as typeof importedBirthInput).timePrecision).toBe("HOUR_RANGE");
  expect((state.previews[0].birthInput as typeof importedBirthInput).time).toEqual({ localTime: null, hourBranchCode: "CHOU" });
  await expect(page.getByText("查看原小程序资料", { exact: true })).toBeVisible();
});


test("用户补充准确时间后按分钟保存，同时继续保留出生地", async ({ page }) => {
  const state = await mockArchive(page);
  await page.getByRole("button", { name: /已修改的称呼/ }).click();
  await expect(page.locator(".detail-section")).toContainText("01:00–03:00 · 时辰范围");
  await page.getByRole("button", { name: "编辑生命智慧档案", exact: true }).click();
  await expect(page.locator(".other-profile-editor")).toContainText("保持时间不变将保留原时辰");
  await page.getByLabel("出生时间", { exact: true }).fill("02:15");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect.poll(() => state.previews.length).toBe(1);
  const preview = state.previews[0].birthInput as typeof birthInput;
  expect(preview.locationId).toBe("loc_cn_110000");
  expect(preview.timePrecision).toBe("EXACT_MINUTE");
  expect(preview.time).toEqual({ localTime: "02:15", hourBranchCode: null });
});

test("导入档案可从默认北京改为实际出生城市，选择前保持原值，保存后重新加载继续保留", async ({ page }) => {
  const state = await mockArchive(page);
  await page.getByRole("button", { name: /已修改的称呼/ }).click();
  await page.getByRole("button", { name: "编辑生命智慧档案", exact: true }).click();
  const locationEditor = page.getByRole("region", { name: "修改出生地" });
  await expect(locationEditor).toContainText("当前：北京");
  await page.getByLabel("搜索出生城市", { exact: true }).fill("上海");
  await expect(locationEditor).toContainText("当前：北京");
  await page.getByRole("button", { name: "搜索城市", exact: true }).click();
  await locationEditor.getByRole("button", { name: /^上海/ }).click();
  await expect(locationEditor).toContainText("当前：上海");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect.poll(() => state.previews.length).toBe(1);
  expect((state.previews[0].birthInput as typeof birthInput).locationId).toBe("geonames:1796236");
  await expect(page.getByText("查看原小程序资料", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /已修改的称呼/ }).click();
  await page.getByRole("button", { name: "编辑生命智慧档案", exact: true }).click();
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect.poll(() => state.previews.length).toBe(2);
  expect((state.previews[1].birthInput as typeof birthInput).locationId).toBe("geonames:1796236");
});

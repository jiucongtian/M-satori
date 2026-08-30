import { expect, test, type Page } from "@playwright/test";

async function navGeometry(page: Page) {
  return page.locator(".app-bottom-nav").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { top: Math.round(rect.top), height: Math.round(rect.height), bottom: Math.round(rect.bottom) };
  });
}

test("根页面在目标设备矩阵中可滚动、主操作可达且底栏稳定", async ({ page }, testInfo) => {
  await page.goto("/home");
  await expect(page.locator(".today-home")).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  const nav = page.locator(".app-bottom-nav");
  await expect(nav).toBeVisible();
  const baseline = await navGeometry(page);
  expect(baseline.bottom).toBeLessThanOrEqual(page.viewportSize()!.height);

  const guidance = page.locator(".home-guidance-link");
  if (testInfo.project.name === "small-phone") await guidance.scrollIntoViewIfNeeded();
  await expect(guidance).toBeVisible();
  await expect(guidance).toBeEnabled();

  for (const name of ["关系", "成长", "今日", "问事", "我的"]) {
    await nav.getByRole("button", { name }).click();
    await expect(page.locator(".app-bottom-nav")).toBeVisible();
    const current = await navGeometry(page);
    expect(current).toEqual(baseline);
  }
});

test("华为 Mate X7 外屏首屏可见今日指引入口", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mate-x7-outer");
  await page.goto("/home");
  await expect(page.locator(".home-guidance-link")).toBeInViewport();
});

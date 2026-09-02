import { expect, test } from "@playwright/test";
import {installApiFixture} from './fixture';

test.beforeEach(async ({ page }) => {
  await installApiFixture(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await page.waitForTimeout(400);
});

test("@visual ADMIN-VISUAL-001 品牌色与语义色符合运营平台规范", async ({ page }) => {
  const colors = await page.locator(".admin-shell").evaluate((el) => {
    const css = getComputedStyle(el);
    return {
      green: css.getPropertyValue("--admin-green").trim().toLowerCase(),
      cream: css.getPropertyValue("--admin-cream").trim().toLowerCase(),
      danger: css.getPropertyValue("--admin-danger").trim().toLowerCase(),
    };
  });
  expect(colors).toEqual({ green: "#3f6757", cream: "#f6f3eb", danger: "#b65f55" });
});

test("@visual ADMIN-VISUAL-002 标题、正文、表格和按钮达到可读字号", async ({ page }) => {
  const px = async (selector: string) => Number.parseFloat(await page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontSize));
  expect(await px(".admin-topbar h1")).toBeGreaterThanOrEqual(27);
  expect(await px(".admin-shell")).toBeGreaterThanOrEqual(15);
  expect(await px(".admin-secondary")).toBeGreaterThanOrEqual(14);
  await page.getByRole("button", { name: /用户中心/ }).click();
  expect(await px(".admin-table-panel table")).toBeGreaterThanOrEqual(14);
  expect(await px(".admin-table-panel th")).toBeGreaterThanOrEqual(13);
});

test("@visual ADMIN-VISUAL-003 主操作满足最小点击高度", async ({ page }) => {
  const boxes = await page.locator(".admin-primary:visible, .admin-secondary:visible").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  expect(boxes.length).toBeGreaterThan(0);
  expect(Math.min(...boxes)).toBeGreaterThanOrEqual(40);
});

test("@visual ADMIN-RESPONSIVE-001 页面不产生整页横向溢出", async ({ page }) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "品 商品中心" }).click();
  await expect(page.getByRole("heading", { name: "商品中心" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

test("@visual ADMIN-COPY-001 用户主界面不出现内部英文状态枚举", async ({ page }) => {
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/TERMINATED_BY_UPGRADE|\bACTIVE\b|PROPERTY_LIMIT/);
});

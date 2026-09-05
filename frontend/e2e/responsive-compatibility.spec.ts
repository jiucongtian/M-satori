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
  await page.waitForTimeout(250);
  const baseline = await navGeometry(page);
  expect(baseline.bottom).toBeLessThanOrEqual(page.viewportSize()!.height);

  const guidance = page.locator(".home-guidance-link");
  if (testInfo.project.name === "small-phone") await guidance.scrollIntoViewIfNeeded();
  await expect(guidance).toBeVisible();
  await expect(guidance).toBeEnabled();

  for (const name of ["关系", "成长", "今日", "问事", "我的"]) {
    await nav.getByRole("button", { name }).click({ force: true });
    await expect(page.locator(".app-bottom-nav")).toBeVisible();
    const current = await navGeometry(page);
    expect(current.height, `tab=${name}`).toBe(baseline.height);
    expect(current.top, `tab=${name}`).toBeGreaterThanOrEqual(0);
    expect(current.bottom, `tab=${name}`).toBeLessThanOrEqual(page.viewportSize()!.height);
  }
});

test("华为 Mate X7 外屏首屏可见今日指引入口", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mate-x7-outer");
  await page.goto("/home");
  await expect(page.locator(".home-guidance-link")).toBeInViewport();
});

test("READ-13/15 的一至五张牌始终在固定区域按指定行数排列", async ({ page }) => {
  await page.goto("/home");
  for (const count of [1, 2, 3, 4, 5]) {
    await page.evaluate((cardCount) => {
      document.body.innerHTML = `<main class="phone"><div class="reading-report-scroll"><div class="card-layout report-card-gallery count-${cardCount}">${Array.from({length:cardCount},(_,index)=>`<figure><img src="/cards/satori-default-v1/${String(index+1).padStart(2,"0")}.jpg" alt="测试卡牌"><figcaption><strong>${index===0?"自己":`选择${index}`}</strong></figcaption></figure>`).join("")}</div></div></main>`;
    }, count);
    const layout = await page.locator(".report-card-gallery").evaluate((region) => {
      const bounds = region.getBoundingClientRect();
      const cards = [...region.querySelectorAll("figure")].map((card) => card.getBoundingClientRect());
      return { stageWidth:bounds.width, cardWidth:cards[0]?.width??0, rows: new Set(cards.map((card) => Math.round(card.top))).size, inside: cards.every((card) => card.left >= bounds.left && card.right <= bounds.right && card.top >= bounds.top && card.bottom <= bounds.bottom) };
    });
    expect(layout.inside, `count=${count} layout=${JSON.stringify(layout)}`).toBeTruthy();
    expect(layout.rows).toBe(count <= 3 ? 1 : 2);
    const minimumWidthRatio = ({1:.38,2:.31,3:.23,4:.21,5:.19} as const)[count as 1|2|3|4|5];
    expect(layout.cardWidth/layout.stageWidth, `count=${count} should use the stable stage`).toBeGreaterThanOrEqual(minimumWidthRatio);
  }
});

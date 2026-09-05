import { expect, test } from '@playwright/test';

test('核心页面访问和底部导航点击会上报且不包含敏感字段', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone');
  const batches: Array<{ events?: Array<Record<string, unknown>> }> = [];
  await page.route('**/api/v1/analytics/events/batch', async (route) => {
    batches.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ data: { accepted: true, acceptedCount: 1 } }) });
  });

  await page.goto('/home');
  const nav = page.locator('.app-bottom-nav');
  await nav.getByRole('button', { name: '关系' }).click();
  await expect.poll(
    () => batches.flatMap((batch) => batch.events ?? []).some((event) => event.event_name === 'navigation_tab_clicked'),
    { timeout: 12_000 },
  ).toBeTruthy();

  const events = batches.flatMap((batch) => batch.events ?? []);
  const names = events.map((event) => event.event_name);
  expect(names).toContain('global_page_viewed');
  expect(names).toContain('daily_home_viewed');
  expect(names).toContain('navigation_tab_clicked');
  expect(events.some((event) => event.page_code === 'R1.0 · HOME-01')).toBeTruthy();

  const serialized = JSON.stringify(events);
  expect(serialized).not.toMatch(/1[3-9]\d{9}/);
  expect(serialized).not.toMatch(/"(?:phone|question|report|birth|password|token|imei)"\s*:/i);
});

test('埋点接口失败不会阻断用户切换页面', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone');
  await page.route('**/api/v1/analytics/events/batch', (route) => route.fulfill({ status: 503, body: '{}' }));
  await page.goto('/home');
  await page.locator('.app-bottom-nav').getByRole('button', { name: '关系' }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.locator('.coming-soon-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: /看见两个人之间/ })).toBeVisible();
});

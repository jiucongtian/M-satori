import { test, expect } from '@playwright/test';
import { installApiFixture } from './fixture';

test('发布状态独立于入口，单次补购配置可暂存且不冒充当前入口', async ({ page }) => {
  await installApiFixture(page);
  await page.goto('/admin');
  await page.getByRole('button', { name: '品 商品中心' }).click();
  await expect(page.getByRole('columnheader', { name: '发布状态', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '展示入口（当前版本）' })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'SP-READ-001' });
  await expect(row.getByText('已发布', { exact: true })).toBeVisible();
  await expect(row.getByText('次数不足时补购', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: /查看并配置/ }).click();
  await page.getByRole('button', { name: '展示入口', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /次数不足时补购/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /普通商城 用户/ })).not.toBeChecked();
  await page.getByRole('checkbox', { name: /普通商城 用户/ }).check();
  const request = page.waitForRequest(r => r.url().endsWith('/products/1/draft') && r.method() === 'PUT');
  await page.getByRole('button', { name: '暂存，稍后继续' }).click();
  expect((await request).postDataJSON().displayChannels).toEqual(['SHORTAGE', 'STORE']);
  await expect(page.getByText('当前入口：次数不足时补购', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/product-display-editor.png', fullPage: true });
  await page.getByRole('button', { name: /返回商品列表/ }).click();
  await page.getByRole('row').filter({ hasText: 'MB-QINGHE' }).getByRole('button', { name: /查看并配置/ }).click();
  await page.getByRole('button', { name: '展示入口', exact: true }).click();
  await expect(page.getByText('会员使用独立的会员计划入口，不进入普通商城或次数不足补购列表。')).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
});

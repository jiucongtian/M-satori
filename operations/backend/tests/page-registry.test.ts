import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAnalyticsPageRows, pageCodeByRoute, registeredPageCode } from '../src/page-registry.js';

test('/shop 固定登记为 R1.1 · SHOP-01', () => {
  assert.equal(pageCodeByRoute['/shop'], 'R1.1 · SHOP-01');
  assert.equal(registeredPageCode(null, '/shop'), 'R1.1 · SHOP-01');
});

test('历史空编号与新编号聚合为同一页面', () => {
  assert.deepEqual(normalizeAnalyticsPageRows([
    { page_code: null, route: '/shop', pv: 41, uv: 13, errors: 118 },
    { page_code: 'R1.1 · SHOP-01', route: '/shop', pv: 9, uv: 4, errors: 0 },
  ]), [{ page_code: 'R1.1 · SHOP-01', route: '/shop', pv: 50, uv: 17, errors: 118 }]);
});

test('未知路由仍明确标记为未登记页面', () => {
  assert.equal(registeredPageCode(undefined, '/new-page'), '未登记页面');
});

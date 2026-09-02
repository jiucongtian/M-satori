import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import test from 'node:test';
test('运营平台保持独立 API 与品牌入口',async()=>{const [page,api]=await Promise.all([readFile(new URL('../app/page.tsx',import.meta.url),'utf8'),readFile(new URL('../app/api.ts',import.meta.url),'utf8')]);assert.match(page,/初见 · FRESH/);assert.match(api,/operations-api/)});

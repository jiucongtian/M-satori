import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('研发数据中心具备七个视图和受控导航',async()=>{const [page,center]=await Promise.all([readFile(new URL('../app/page.tsx',import.meta.url),'utf8'),readFile(new URL('../app/development-center.tsx',import.meta.url),'utf8')]);assert.match(page,/TECH_ADMIN/);assert.match(page,/visibleNav/);for(const tab of ['总览','功能与版本','研发节奏','代码分析','测试质量','Issue与风险','数据健康'])assert.match(center,new RegExp(tab));assert.match(center,/尚未接入/)});

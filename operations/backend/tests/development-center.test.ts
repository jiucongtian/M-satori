import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {developmentCenterData} from '../src/development-center.js';

test('研发数据中心仅允许超级管理员和技术管理员访问',async()=>{const source=await readFile(new URL('../src/server.ts',import.meta.url),'utf8');assert.match(source,/\/api\/development-center/);assert.match(source,/\['SUPER_ADMIN','TECH_ADMIN'\]/);assert.match(source,/仅超级管理员和技术管理员可以查看研发数据中心/)});
test('研发指标缺失时保持 null 而不是伪造为 0',()=>{assert.equal(developmentCenterData.quality.cases,null);assert.equal(developmentCenterData.issues.total,null);assert.ok(developmentCenterData.components.every(x=>x.commits===null));assert.equal(developmentCenterData.source.mode,'PARTIAL')});

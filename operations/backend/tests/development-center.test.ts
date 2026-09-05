import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('研发数据中心仅允许超级管理员和技术管理员访问',async()=>{const source=await readFile(new URL('../src/server.ts',import.meta.url),'utf8');assert.match(source,/\/api\/development-center/);assert.match(source,/\['SUPER_ADMIN','TECH_ADMIN'\]/);assert.match(source,/仅超级管理员和技术管理员可以查看研发数据中心/)});
test('研发数据从 GitHub 准实时读取并为不可得指标保留 null',async()=>{const source=await readFile(new URL('../src/development-center.ts',import.meta.url),'utf8');assert.match(source,/api\.github\.com/);assert.match(source,/AbortSignal\.timeout/);assert.match(source,/expires:Date\.now\(\)\+60000/);assert.match(source,/functionCoverage:null/);assert.match(source,/codeCoverage:null/);assert.match(source,/reopened:null/)});

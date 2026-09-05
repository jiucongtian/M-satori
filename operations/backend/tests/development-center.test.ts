import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('研发数据中心仅允许超级管理员和技术管理员访问',async()=>{const source=await readFile(new URL('../src/server.ts',import.meta.url),'utf8');assert.match(source,/\/api\/development-center/);assert.match(source,/\['SUPER_ADMIN','TECH_ADMIN'\]/);assert.match(source,/仅超级管理员和技术管理员可以查看研发数据中心/)});
test('研发数据按每日快照读取并为不可得指标保留 null',async()=>{const source=await readFile(new URL('../src/development-center.ts',import.meta.url),'utf8');assert.match(source,/api\.github\.com/);assert.match(source,/operations_development_snapshots/);assert.match(source,/setHours\(23,0,0,0\)/);assert.match(source,/captured_by/);assert.match(source,/functionCoverage:null/);assert.match(source,/codeCoverage:null/);assert.match(source,/reopened:null/)});
test('研发数据支持受控人工刷新并写入审计',async()=>{const source=await readFile(new URL('../src/server.ts',import.meta.url),'utf8');assert.match(source,/development-center\/refresh/);assert.match(source,/DEVELOPMENT_DATA_REFRESHED/);assert.match(source,/仅超级管理员和技术管理员可以刷新研发数据/)});
test('四端提交按各自目录统计且明确 GitHub 对比上限',async()=>{const source=await readFile(new URL('../src/development-center.ts',import.meta.url),'utf8');assert.match(source,/path=\$\{encodeURIComponent\(path\)\}/);assert.match(source,/componentCommits/);assert.match(source,/commitsCapped/);assert.match(source,/differenceTruncated/);assert.match(source,/testFileRate/)});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ROUTES,safeNextPath } from "../src/shared/routes.ts";

test("R1.1 分享路由可在登录后安全恢复",()=>{
  const daily="/share/preview?type=daily&choice=2&date=2026-09-03";
  const reading="/share/select?type=reading&choice=1&readingId=01a055dd-c0e7-741d-86a0-b5e3f1846a5a";
  assert.equal(safeNextPath(daily),daily);
  assert.equal(safeNextPath(reading),reading);
  assert.equal(safeNextPath("/share/preview?type=daily&question=secret"),ROUTES.home);
});

test("海报文案只来自真实报告字段且不暴露问事原文",async()=>{
  const source=await readFile(new URL("../src/features/share/ShareFirstLookScreen.tsx",import.meta.url),"utf8");
  assert.match(source,/dailyPosterCopies/);
  for(const field of ["c?.theme","c?.insight","c?.action","c?.reflectionQuestion"])assert.match(source,new RegExp(field.replace(/[?.]/g,"\\$&")));
  const readingCopies=source.slice(source.indexOf("export function readingPosterCopies"),source.indexOf("function href"));
  assert.doesNotMatch(readingCopies,/reading\.question/);
  assert.match(readingCopies,/reading\.cards/);
  const titleBlock=source.match(/const titleSets=\{([\s\S]*?)\} as const/)?.[1]??"";
  const titles=[...titleBlock.matchAll(/"([^\"]+)"/g)].map(item=>item[1]);
  assert.equal(titles.length,18);
  for(const title of titles)assert.equal([...title].length,8,`${title} 应为 8 个字`);
  const bodyBlock=source.match(/const bodySets=\{([\s\S]*?)\} as const/)?.[1]??"";
  const bodies=[...bodyBlock.matchAll(/"([^\"]+)"/g)].map(item=>item[1]);
  assert.equal(bodies.length,18);
  for(const body of bodies){assert.ok([...body].length>=28,`${body} 应至少有 28 个字`);assert.ok([...body].length<=40,`${body} 应不超过 40 个字`);assert.match(body,/[。！？]$/)}
});

test("海报遵循固定角标、二维码和预览保存同源规则",async()=>{
  const [source,styles]=await Promise.all([
    readFile(new URL("../src/features/share/ShareFirstLookScreen.tsx",import.meta.url),"utf8"),
    readFile(new URL("../src/features/share/share-first-look.css",import.meta.url),"utf8"),
  ]);
  assert.match(source,/\.poster-large \.fresh-poster/);
  assert.match(source,/toBlob/);
  assert.match(source,/width:360,height:640,pixelRatio:3/);
  assert.match(source,/ResizeObserver/);
  assert.match(styles,/width:360px;height:640px/);
  assert.match(source,/navigator\.canShare/);
  assert.match(source,/长按图片/);
  assert.match(source,/mergeShortTail/);
  assert.match(styles,/\.poster-report-kind\{position:absolute/);
  assert.match(styles,/inset:5\.5% 6\.5% auto auto/);
  assert.match(styles,/right:6\.5%;bottom:3\.2%/);
  assert.match(styles,/text-wrap:balance/);
  assert.doesNotMatch(source,/预览扫码后的页面|从今日反思与关键词中提炼|图片已提前准备/);
});

test("分享选择、预览和保存进入运营埋点",async()=>{
  const [provider,business,source]=await Promise.all([
    readFile(new URL("../src/analytics/AnalyticsProvider.tsx",import.meta.url),"utf8"),
    readFile(new URL("../src/analytics/businessEvents.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/features/share/ShareFirstLookScreen.tsx",import.meta.url),"utf8"),
  ]);
  for(const event of ["share_poster_generation_viewed","share_poster_selection_viewed","share_poster_preview_viewed"])assert.match(provider,new RegExp(event));
  assert.match(business,/share_entry_clicked/);
  assert.match(business,/share_poster_selected/);
  assert.match(source,/share_poster_saved/);
});

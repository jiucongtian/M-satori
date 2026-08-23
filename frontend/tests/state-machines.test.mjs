import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { initialProfileMachine, profileReducer } from "../src/features/profile/profileMachine.ts";
import { dailyReducer, initialDailyMachine } from "../src/features/daily/dailyMachine.ts";

test("建档状态机只接受合法具名转换", () => {
  let machine = initialProfileMachine;
  machine = profileReducer(machine, { type: "START" });
  machine = profileReducer(machine, { type: "PREVIEW" });
  machine = profileReducer(machine, { type: "PREVIEW_READY" });
  machine = profileReducer(machine, { type: "CONFIRMED" });
  machine = profileReducer(machine, { type: "FIRST_LOOK_DONE" });
  machine = profileReducer(machine, { type: "COMPLETE" });
  assert.equal(machine.state, "complete");
  assert.equal(profileReducer(machine, { type: "START" }), machine);
});

test("建档失败恢复到明确的安全状态", () => {
  const failed = profileReducer({ state: "calculating", recoverTo: "editing" }, { type: "FAIL", recoverTo: "calculating" });
  assert.equal(failed.state, "failed");
  assert.equal(profileReducer(failed, { type: "RETRY" }).state, "calculating");
});

test("建档依据后端档案事实恢复到待确认、初见或赠礼状态", () => {
  assert.equal(profileReducer(initialProfileMachine, { type: "RESTORE_CONFIRMING" }).state, "confirming");
  assert.equal(profileReducer(initialProfileMachine, { type: "RESTORE_FIRST_LOOK" }).state, "first-look");
  assert.equal(profileReducer(initialProfileMachine, { type: "RESTORE_GIFT" }).state, "gift");
});

test("每日指引状态机覆盖恢复、确认、生成、完成与失败重试", () => {
  let machine = dailyReducer(initialDailyMachine, { type: "RESTORE_START" });
  machine = dailyReducer(machine, { type: "CONFIRM_COST" });
  machine = dailyReducer(machine, { type: "GENERATE" });
  assert.equal(machine.state, "generating");
  assert.equal(dailyReducer(machine, { type: "READY" }).state, "ready");
  const failed = dailyReducer(machine, { type: "FAIL", recoverTo: "generating" });
  assert.equal(dailyReducer(failed, { type: "RETRY" }).state, "generating");
});

test("流程草稿具有版本、过期和用户边界，写命令具有前端进行中锁", async () => {
  const [storage, profile, daily] = await Promise.all([
    readFile(new URL("../src/shared/storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/profile/ProfileCreateScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/daily/DailyScreen.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(storage, /version !== version \|\| parsed\.ownerId !== ownerId \|\| parsed\.expiresAt <= Date\.now\(\)/);
  assert.match(storage, /window\.sessionStorage/);
  assert.doesNotMatch(storage, /localStorage/);
  assert.match(profile, /confirmLock\.current===revision\.revisionId/);
  assert.match(profile, /previewLock\.current/);
  assert.match(profile, /writeFlowDraft\("profile",owner,DRAFT_VERSION,data\);dispatch\(\{type:"PREVIEW"\}\)/);
  assert.match(profile, /rewardLock\.current/);
  assert.match(profile, /if\(value\.profile\.pendingRevisionId\)/);
  assert.match(daily, /createLock\.current/);
});

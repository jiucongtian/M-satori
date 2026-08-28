import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const r11Tests = readdirSync(new URL(".", import.meta.url))
  .filter((name) => name.endsWith(".test.mjs"))
  .map((name) => `tests/r1.1/${name}`);

const commands = [
  ["既有单元与契约测试", process.platform === "win32" ? "npm.cmd" : "npm", ["run", "test"]],
  ["R1.1 自动化测试", process.execPath, ["--test", ...r11Tests]],
  ["R1.1 后端契约 Mock 测试", process.execPath, ["--test", "../backend/tests/contract/r1.1-p0-contract.test.mjs"]],
  ["代码规范检查", process.platform === "win32" ? "npm.cmd" : "npm", ["run", "lint"]],
  ["静态构建", process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build:static"]],
];

const failed = [];
for (const [name, command, args] of commands) {
  console.log(`\n▶ ${name}`);
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) failed.push(name);
}

if (failed.length) {
  console.error(`\nR1.1 全量回归未通过：${failed.join("、")}`);
  process.exitCode = 1;
} else {
  console.log("\nR1.1 全量回归通过。");
}

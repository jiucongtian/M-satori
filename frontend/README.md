# vinext-starter

## Satori Release 本地端口约定

- `http://localhost:3000/`：H5 原型基准
- `http://localhost:3001/`：R1.0 前端研发测试环境（本项目唯一开发端口）
- `http://localhost:3011/`：R1.1 抽卡问事前端研发测试环境
- `http://localhost:3002/`：R2.0 前端研发测试环境
- `http://localhost:3003/`：R3.0 前端研发测试环境，后续版本依次递增

R1.0 仅开放：登录注册、本人生命智慧档案、四张关系卡牌、新用户赠种、今日首页、每日指引、我的基础页面、生命智慧档案库基础能力、智慧种子体验额度账户及使用记录。

智慧种子仅表示平台免费赠送、会员附赠或学院配置的 AI 体验额度，不提供购买、充值、提现、转赠或交易能力；R1.0 不开放商城、实体商品兑换和人工服务支付。

R1.0 底部栏继续展示“问事、成长、关系”，点击后只能进入对应的功能预告页，不得进入尚未发布的实际业务流程。

R1.1 开放“抽卡问事”：单卡、双卡、3—5张多卡，系统随机抽取，按张数消耗智慧种子；包含安全改写、报告生成、失败恢复、历史、反馈和分享，不包含追问与成长行动。

## Release 约定

- 维护分支：`release/r1.0`、`release/r1.1`、`release/r2.0`、`release/r3.0`
- 发布标签：`frontend-r1.0.0`、`frontend-r1.0.1`，按语义化版本递增
- 每个 Release 的代码、测试范围与本地端口保持一一对应
- `main` 只承载已经确认稳定的版本代码

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Email and name are intended for display or contact purposes.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)

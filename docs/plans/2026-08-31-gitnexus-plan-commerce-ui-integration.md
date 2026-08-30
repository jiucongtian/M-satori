# GitNexus Engineering Plan

> Task: Restore the approved R1.1 membership and service-store experience while keeping the latest real backend commerce flow.
> Evidence verified at commit 5f78c0b50c5e3b53454c51980e4174c32896d506; GitNexus index stale at 6fd4aa7, source-weighted planning used.
> Evidence provenance schema 2; global dirty digest 0a9c85780067d9afcd0764f307b60891e3cee927ee11eaeb5ec7826d10fd82cd; cited-path manifest 6 sorted entries; exact generated plan path excluded.

## Objective (§1)

Use `a9e3c33` as the visual and interaction reference for “服务商城” and “会员计划”, while all catalog, membership, price, entitlement, renewal, upgrade and order data remains supplied by the current R1.1 backend. Payment-provider behavior is explicitly unchanged.

## Current Behaviour (§2–3)

- [verified] `CommerceScreens.tsx` aliases legacy `/services` routes to the newer `ShopScreen` and `MembershipScreen`, replacing the approved presentation.
- [verified] The new screens already load `serviceOfferings`, `membershipPlans`, `currentMembership`, `membershipPeriods`, checkout quotes, orders and entitlements from the API.
- [verified] `MyScreens.tsx` already renders a backend-derived membership and entitlement summary.
- [verified] The old `a9e3c33` presentation used hard-coded products and simulated state; it is reference material only and must not be restored as data logic.

## Findings (§4–5)

- [verified, git diff a9e3c33..5f78c0b] The backend commerce stack is additive and must remain intact.
- [verified, source read] The shared route seam is `CommerceScreens.tsx`; `/services`, `/shop`, and `/my/membership` converge there.
- [graph, impact target ShopScreen/MembershipScreen/MyHomeScreen] Impact is UNKNOWN because the index predates these R1.1 symbols; direct imports were confirmed with `git grep`.
- No PDG claim is load-bearing; presentation changes must preserve existing API call ordering and checkout URLs.

## Proposed Changes (§6)

1. Refine `ShopScreen`, `OfferingCard`, and `PlanCard` to use the approved service-store hierarchy and copy while retaining server-loaded offerings and membership state.
2. Refine `MembershipScreen` and `MembershipAction` to use the approved three-plan comparison experience while retaining real active period, renewal, upgrade, downgrade restrictions and backend identifiers.
3. Keep `MyHomeScreen` backend-derived summary and ensure its two entries reach the shared integrated screens.
4. Update contract tests to require real APIs and the approved presentation simultaneously. Do not change payment provider selection or payment modules.

## Implementation Sequence (§7)

1. Add presentation helpers/view models derived only from backend DTOs; update service-store layout and tests.
2. Update membership comparison/current-period layout and tests for no membership, renewal, upgrade and downgrade visibility.
3. Verify My-page links, legacy route aliases, checkout query construction and backend-derived summaries.
4. Run targeted tests, lint and static build; commit each coherent stage separately.

## Test Strategy (§8)

- Catalog returned → service cards and three membership plans render in approved hierarchy.
- Active membership returned → current plan and remaining period render; same plan renews, higher plan upgrades, lower plan is not offered.
- No active membership → all plans enter the existing checkout flow.
- “我的” membership and service-store entries reach the integrated screens.
- Existing tests continue proving service pricing, quote, order and entitlement data are server authoritative.
- Payment-provider tests remain unchanged.

## Implementation Context (§11)

```yaml
implementation_context:
  task_summary: "Integrate approved R1.1 commerce UI with current real backend membership flow"
  evidence_provenance:
    schema_version: 2
    head_commit: "5f78c0b50c5e3b53454c51980e4174c32896d506"
    generated_plan_path: "docs/plans/2026-08-31-gitnexus-plan-commerce-ui-integration.md"
    global_dirty_digest:
      algorithm: "sha256"
      canonicalization: "gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records"
      value: "0a9c85780067d9afcd0764f307b60891e3cee927ee11eaeb5ec7826d10fd82cd"
    cited_path_manifest:
      - {path: "frontend/package.json", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:b45f662354f83cdb9ec79fbf5d44117ab258030ffc0979b371f92c3f57587146", index_digest: "sha256:b45f662354f83cdb9ec79fbf5d44117ab258030ffc0979b371f92c3f57587146", worktree_digest: "sha256:b45f662354f83cdb9ec79fbf5d44117ab258030ffc0979b371f92c3f57587146", untracked_digest: absent}
      - {path: "frontend/src/features/commerce/CommerceScreens.tsx", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:fb63dc8f6972d7a49e9bf6f8a9421f23d24bb1a056a696062ecf9f5077f0554b", index_digest: "sha256:fb63dc8f6972d7a49e9bf6f8a9421f23d24bb1a056a696062ecf9f5077f0554b", worktree_digest: "sha256:fb63dc8f6972d7a49e9bf6f8a9421f23d24bb1a056a696062ecf9f5077f0554b", untracked_digest: absent}
      - {path: "frontend/src/features/commerce/commerce.css", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:8d10c47ddc355ffc9d97cfc0cc0888fd65c6391d5fdcdf387e6dea6cad45b48f", index_digest: "sha256:8d10c47ddc355ffc9d97cfc0cc0888fd65c6391d5fdcdf387e6dea6cad45b48f", worktree_digest: "sha256:8d10c47ddc355ffc9d97cfc0cc0888fd65c6391d5fdcdf387e6dea6cad45b48f", untracked_digest: absent}
      - {path: "frontend/src/features/my/MyScreens.tsx", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:6e456edc16eff651601b330f4d8c1ecc945461add29aaa4820917ec400f1a172", index_digest: "sha256:6e456edc16eff651601b330f4d8c1ecc945461add29aaa4820917ec400f1a172", worktree_digest: "sha256:6e456edc16eff651601b330f4d8c1ecc945461add29aaa4820917ec400f1a172", untracked_digest: absent}
      - {path: "frontend/tests/commerce-flow.test.mjs", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:e377399b6e900ca9ac09a9007a3bc47a0aaea556b528aa1253377bfc25de6946", index_digest: "sha256:e377399b6e900ca9ac09a9007a3bc47a0aaea556b528aa1253377bfc25de6946", worktree_digest: "sha256:e377399b6e900ca9ac09a9007a3bc47a0aaea556b528aa1253377bfc25de6946", untracked_digest: absent}
      - {path: "frontend/tests/r1.1/commerce.contract.test.mjs", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:187eae28d66c976af99a1ba1c9c1f9ef7f16802003408922789d383bf94b62cf", index_digest: "sha256:187eae28d66c976af99a1ba1c9c1f9ef7f16802003408922789d383bf94b62cf", worktree_digest: "sha256:187eae28d66c976af99a1ba1c9c1f9ef7f16802003408922789d383bf94b62cf", untracked_digest: absent}
  files_to_modify:
    - {file: "frontend/src/features/commerce/CommerceScreens.tsx", symbols: [ShopScreen, OfferingCard, PlanCard, MembershipScreen, MembershipAction], intended_change: "approved UI with backend DTOs"}
    - {file: "frontend/src/features/commerce/commerce.css", symbols: [], intended_change: "approved commerce visual hierarchy"}
    - {file: "frontend/tests/commerce-flow.test.mjs", symbols: [], intended_change: "real-data and navigation regression coverage"}
    - {file: "frontend/tests/r1.1/commerce.contract.test.mjs", symbols: [], intended_change: "membership lifecycle and presentation contracts"}
  tests:
    - {file: "frontend/tests/commerce-flow.test.mjs", scenarios: ["server catalog -> approved store hierarchy", "active membership -> renewal/upgrade paths"]}
    - {file: "frontend/tests/r1.1/commerce.contract.test.mjs", scenarios: ["three backend plans -> approved comparison", "payment provider implementation remains untouched"]}
  verification_commands:
    - "cd frontend && node --test tests/commerce-flow.test.mjs tests/r1.1/commerce.contract.test.mjs"
    - "cd frontend && npm run lint"
    - "cd frontend && npm run build:static"
  assumptions:
    - "a9e3c33 is the approved visual reference; verify via git show before styling."
    - "Latest backend DTOs and route contracts at 5f78c0b remain authoritative."
  open_questions: []
  avoid:
    - "Do not change payment provider selection, WeChat JSAPI, backend payment modules, or payment environment configuration."
    - "Do not restore hard-coded products, prices, membership status, remaining days, or simulated payment state."
    - "Do not create a second commerce implementation for legacy routes."
```

## Assumptions and Open Questions (§12)

- [assumed] `a9e3c33` remains the approved visual reference; source comparison will be used, not whole-file restoration.
- Explicitly deferred: real payment-channel integration and provider-selection changes.

## Definition of Done (§13)

- Approved store and membership experience is restored without hard-coded business data.
- Membership purchase, renewal and upgrade reach the existing backend-authoritative checkout flow.
- My-page membership and entitlement summary remains backend-derived.
- Existing payment-provider behavior and tests are unchanged.
- Targeted tests, lint and static build pass; commits are atomic and pushed to the integration branch.

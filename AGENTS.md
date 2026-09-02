<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **M-satori** (2735 symbols, 6304 relationships, 228 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/M-satori/context` | Codebase overview, check index freshness |
| `gitnexus://repo/M-satori/clusters` | All functional areas |
| `gitnexus://repo/M-satori/processes` | All execution flows |
| `gitnexus://repo/M-satori/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

## GitHub connectivity on this workstation

- GitHub HTTPS Git traffic is configured to use Clash Verge at `http://127.0.0.1:7897` and HTTP/1.1; use ordinary `git fetch`, `git pull`, and `git push` first.
- If GitHub times out while the website remains reachable, check that `verge-mihomo` is listening on port `7897` and follow `docs/governance/研发与发布SOP.md` instead of repeatedly retrying direct connections.
- `gh` and standalone `curl` do not reliably inherit Git's proxy setting. When they need GitHub network access, scope `HTTPS_PROXY=http://127.0.0.1:7897` to that command only.
- Do not bypass the required pre-commit fetch, remote comparison, or post-push verification because of a network failure.

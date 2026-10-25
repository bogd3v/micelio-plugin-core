# Agent team (micelio-plugin-core)

The main session acts as **tech lead**: it reads the issue, does the work or hands a well-bounded piece to a subagent, integrates the result and owns the final quality. This repository defines no standing subagents of its own; the factory's roles are below.

## Workflow

1. **Understand** — read `AGENTS.md`, the issue and its Progress section, and the ADRs of the area. Ambiguous scope that is expensive to redo goes to the user.
2. **Implement** — the smallest change that satisfies the issue; tests with it.
3. **Verify** — `npm run check`, plus the suites the issue names. Record the real numbers.
4. **Ship** — the main session prepares branch, commits and pull request following section 11 of the standard and the `ship-pr` skill, and asks the user before pushing.
5. **Close** — a summary for the user: what changed, what was tested, what was not verified, decisions pending.

## Factory roles

Work that runs through the Micelio factory ([`docs/factory.md`](https://github.com/bogd3v/micelio-engineering/blob/main/docs/factory.md)) uses the five prompts in `.claude/agents/` (`planner`, `master`, `worker`, `reviewer`, `verifier`), copies of `micelio-engineering/template/`: fix them there, never here.

| Role       | Gate | Hard limits (on top of the list below)                                                                                                                                                       |
| ---------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reviewer` | 3    | A new agent with no context from the worker; reads the diff, never edits or commits, never reads the worker's session; findings are Blocking, Important or Suggestion, each with `path:line` |
| `verifier` | 4    | A new agent with a shell, no context from the worker, never reads the reviewer's findings; works on a clean copy, never in the worktree; never accepts a number it did not produce           |

## Delegation rules

- Subagents start with no context: every delegation gives the goal, the issue number, the relevant paths, the constraints and the definition of done.
- Do not delegate trivia: a one-line edit or a question one file read answers.

## Hard limits (every agent)

- Never push, merge, tag, release, deploy or run anything against production or staging. The agent prepares; the user approves.
- Never read or print `.env`, tokens or anything under `~/.claude/secrets/`. Use `.env.example` to learn variable names.
- Code, identifiers, commits, PR titles and descriptions in English (see `AGENTS.md`).

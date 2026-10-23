# Agent team (micelio-plugin-core)

The main session acts as **tech lead**: it reads the issue, does the work or hands a well-bounded piece to a subagent, integrates the result and owns the final quality. This repository defines no standing subagents; when it does, they live in `.claude/agents/` and this file gets a roster.

## Workflow

1. **Understand** — read `AGENTS.md`, the issue and its Progress section, and the ADRs of the area. Ambiguous scope that is expensive to redo goes to the user.
2. **Implement** — the smallest change that satisfies the issue; tests with it.
3. **Verify** — `npm run check`, plus the suites the issue names. Record the real numbers.
4. **Ship** — the main session prepares branch, commits and pull request following section 11 of the standard, and asks the user before pushing.
5. **Close** — a summary for the user: what changed, what was tested, what was not verified, decisions pending.

## Delegation rules

- Subagents start with no context: every delegation gives the goal, the issue number, the relevant paths, the constraints and the definition of done.
- Do not delegate trivia: a one-line edit or a question one file read answers.

## Hard limits (every agent)

- Never push, merge, tag, release, deploy or run anything against production or staging. The agent prepares; the user approves.
- Never read or print `.env`, tokens or anything under `~/.claude/secrets/`. Use `.env.example` to learn variable names.
- Code, identifiers, commits, PR titles and descriptions in English (see `AGENTS.md`).

# OptiCapture Agent Roster

OptiCapture uses project-specific review agents for repeatable quality checks. Local Claude Code agent definitions live in `.claude/agents/`, which is currently ignored by git. This document tracks the intended responsibilities so the roster can evolve with development.

## Agents

### `opticapture-deep-audit`

Use for major merges, releases, refactors, security-sensitive changes, or any request for a thorough review.

Responsibilities:

- Run the full check suite: TypeScript, ESLint, coverage tests, Playwright e2e, and production build.
- Review core functionality across auth, multi-store behavior, inventory, categories, scanning, imports/exports, audit logs, and protected routes.
- Inspect code reliability, including validation, authorization, tenant scoping, async behavior, database migrations, error handling, and test coverage.
- Identify confirmed and suspected dead, ambiguous, duplicated, or unnecessary code.
- Review usability from the perspective of owners, takers, and super admins.
- Report findings by severity with exact file references, verification steps, and recommended fixes.

### `opticapture-quick-check`

Use after small changes or whenever a fast "does it still run?" pass is enough.

Responsibilities:

- Run quick broad checks: git status, TypeScript, ESLint, and unit/integration tests.
- Add build, e2e, or coverage only when the change risk calls for it or the user asks for full checks.
- Skim changed files for obvious regressions, missing tests, missing authorization, and rough simplification opportunities.
- Return a short pass/fail/blocker report with commands run and recommendations.

## Expansion Notes

Future agents can be added for narrower review areas as OptiCapture grows, for example:

- Security and tenant-isolation audit.
- Scanner/mobile workflow QA.
- Import/export data-quality review.
- UI accessibility and responsive-usability review.
- Database migration and performance review.
- Release-readiness coordinator that delegates to the other agents.

When adding an agent, define:

- When it should be used.
- Commands it should run.
- Functional areas it owns.
- What it should explicitly avoid.
- The expected output format.

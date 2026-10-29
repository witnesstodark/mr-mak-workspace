# Mr. Mak Workspace

Read [AGENTS.md](AGENTS.md) for the repository rules and
[getting started](docs/getting-started.md) for setup.

Complete project skills are available in `.claude/skills/`, including their
scripts and references. `.agents/skills/` is the maintained source shared with
Codex. Cursor Agent reads both folders and does not need `.cursor/skills`.
Edit that source and run `npm run skills:sync` for a change intended for every
agent. Keep project instructions, workflows and knowledge here rather
than in global memory.

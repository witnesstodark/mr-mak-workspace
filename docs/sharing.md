# Sharing your version

Start from this template's clean history. Add only the examples and instructions
you mean to publish. An empty MCP configuration does not hide a token pasted into
a report, so review the actual files you are sharing.

Keep `.env`, `.mrmak`, agent login files, global configuration, raw generation
receipts and private inbox materials local. The supplied `.gitignore` covers
common runtime paths. It cannot recognize private text you put in an ordinary
Markdown file.

Use generic placeholders in `context/`. Remove personal project names, private
links, message drafts and account details from exported cards and skills.
Review media as well as text. Keep third-party licenses and source attribution.

To share selected skills, copy their canonical folders from `.agents/skills`
with every referenced resource. Repository workflows may also depend on
`knowledge/`, `processes/` or `scripts/`; read `docs/skills.md` before copying a
single folder. The complete `.claude/skills` copies can be shared with Claude
users as well. Cursor Agent reads `.agents/skills` and `.claude/skills`, so a
`.cursor/skills` copy is unnecessary. Run `npm run skills:sync` after changing
the maintained source.

An agent preparing a release should run lint, service tests, template checks
and the desktop build. Check the four starter cards in a fresh browser session,
inspect the staged file list, then publish the source and installer checksum.

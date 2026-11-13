---
name: workspace-authoring
description: Create or maintain Workspace cards, report tabs and Markdown deliverables with consistent styling, working media previews and clear project organization.
---

# Workspace authoring

Read `AGENTS.md` and [the workflow](../../../processes/workspace-authoring.md).
Keep authored content in English unless the user explicitly requests another
language. Put related iterations in an existing card rather than creating
several cards for one task. Do not reorganize unrelated projects.

For a gallery or research page that the owner wants to edit directly, use the
versioned `.card.json` format in [editable cards](../../../docs/editable-cards.md).
Register its step with `viewer: "card"`. Keep stable entry IDs, relative local
images and Markdown notes; validate with `desktop/service/card-schema.mjs` before
saving. Reread the source before each edit and update the registry date. The app
provides the view, so do not create a second editable HTML copy of the same data.
Preserve existing custom HTML unless conversion was requested. Browser and phone
previews can read these cards; the desktop Workspace provides editing controls.

For a project's asset library (previews, versions, originals and generation
records), keep the data in the card's `assets.json` and generate `assets.html`
with `workspace/_shared/asset-library/build.mjs`, as described in
[the asset library](../../../docs/asset-library.md). Set the card's `project` in
`workspace/workspace.json` so "Send to chat" reaches a chat of that project.
Never edit the generated page.

Use `workspace/_shared/report.css` and `report.js` in every HTML report, with
`data-mak-report="document"` on the root element. Use the shared tokens and
layout instead of inventing another visual theme. Basic cards and media grids
can use the sample CSS in `workspace/_shared/examples.css`.
Standard reports follow the reader's Dark, Light or System preference. Check
both dark and light when adding custom styles. An intentionally independent
design, such as a game demo, can keep its palette with `data-mak-theme="custom"`
on the root element. Do not invert or recolor media to implement a theme.

Every image must be clickable, preview at full size and offer a download.
Use local output paths, meaningful alt text and lazy loading. Keep motion
studies playable with native video controls. Wide tables must scroll within
the report. Never cover the document close button with the Files rail.

Update `workspace/workspace.json` with a stable ID, category, folder, readable
title, creation date, last updated date and steps. `sample: true` is reserved for
starter examples; ordinary work uses normal archiving behavior.

Open every changed tab at wide and narrow sizes. Check media and links, Markdown
rendering and image close/download controls. Preserve the selected surface during
loading. Report actual verification and any remaining limitations. Prepare
desktop changes without restarting active sessions until the user permits it.

Mobile reports use the same HTML or Markdown as desktop. Include the viewport
meta tag and shared styles; keep the reading order useful in a single column.
Test at 390 px and 768 px as well as desktop width. Verify readable text without
zooming, wrapping tab labels, reachable close/download buttons, and working
image previews with touch. Confine horizontal scrolling to tables and code.
Use relative assets inside the report folder or `workspace/_shared/`.
Reports opened through Mobile Access run in an isolated, read-only preview:
do not depend on the desktop control API, parent-window DOM, local storage or
absolute localhost URLs. Keep a short result summary before lengthy details.

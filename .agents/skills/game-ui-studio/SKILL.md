---
name: game-ui-studio
description: Work as the Copilot of Mr. Mak's Game UI Studio - answer with gameui-edit blocks, bring a connected project's UI art into the studio and load the game's existing screens as studio screens. Use when a message carries the studio's "Edit protocol" or screen JSON, mentions gameui-edit or a .gameui.json file, or asks to import UI assets or a game's UI into the UI Studio.
---

# Game UI Studio Copilot

The Game UI Studio is a layout editor for game screens at
`<mrmak>/workspace/2026-10-27_game-ui-studio/` (`<mrmak>` is the Mr. Mak
repository; its `guide.md` describes every panel). Its Copilot drawer starts a
chat named "UI Studio <project>" in the project chosen in the studio's top bar,
so this chat's folder is usually the game, not the studio. The studio pastes
each message with the active screen as compact JSON, the selected element, the
failing guideline checks and the edit protocol, then reads the reply from the
transcript. Follow `<mrmak>/knowledge/game-ui-guidelines.md` in every proposal.

## Answering a studio message

- Reply in plain text plus at most ONE fenced block tagged `gameui-edit`
  holding JSON. The protocol in the message lists the ops, types, anchors and
  props; the studio rejects anything else.
- Use the element and screen IDs from the context. New IDs must be unique; name
  elements the way the engine will (`BtnBack`, `HealthBar`).
- Up to 40 ops per block. An `add` op carries a whole subtree in `children`, so
  one op can add a panel with its contents.
- Do not write `.gameui.json` for a change to the open document. The owner
  previews the block on the canvas and applies or discards it; Apply is one undo
  step. A rejected op comes back with its reason; send a corrected block with
  only the ops that still need to change.
- Rects are `[x, y, w, h]` in design pixels from the anchor point inside the
  parent, and the element's pivot is the same point: `bottom-right` with
  `[-24, -24, 200, 48]` sits 24 px from both edges. Stretched axes use x / y as
  the left / top margin and w / h as the right / bottom margin.
- Image props are `src`, `tintColor`, `crop` (`{x, y, w, h}` in source pixels)
  and `fit` (`contain`, `cover`, `fill`). `comment` is the intent note that
  travels in the handoff.
- Panels, buttons and inputs take `skin` (an image drawn instead of fill and
  border) and `skinSlice` (`[left, top, right, bottom]` 9-slice margins in
  source pixels); `states.<state>.skin` swaps it per state. Text elements take
  `fontFamily`. When the context names a `kit`, read that file and use its
  srcs, slices, colours, fonts and components instead of inventing a look.
- Fix the checks the message lists unless the owner asked otherwise, and say
  which ones remain and why.

You cannot see the canvas. State what the block changes so the owner can check
it in Preview, and keep sizes and positions consistent with the screen's
existing elements.

## The studio's chips

| Chip | What to do |
| --- | --- |
| Handoff | Implement the screen in the project's engine with `game-ui-workflow`; list the files you changed |
| Engine code | Write the engine's native widgets or scene for the active screen, with its anchors, five states, focus and Esc / Back |
| Game kit | Build the game kit: [UI assets](references/ui-assets.md) to copy the art, then [game kit](references/game-kit.md) |
| Review | Audit against the guidelines and propose the fixes as a `gameui-edit` block |

## Importing a project's UI art

Read [UI assets](references/ui-assets.md), then [game kit](references/game-kit.md).
The studio loads images only from inside the Mr. Mak repository, so art from a
project elsewhere is copied into the studio's ignored `assets/` folder; the
game's files never change. The copied art becomes usable through a kit
(`kit.json`, built by `scripts/build-kit.mjs`): skins with 9-slice margins and
state sets, colours, fonts, components in the game's style and the game's
screens, all in the studio's Kit tab.

## Loading the game's existing UI

When the owner asks to load, import or rebuild the game's current screens in
the studio, read [game UI import](references/game-ui-import.md). One screen goes
into the open document as a `gameui-edit` block; several screens become a
`.gameui.json` built by `scripts/build-gameui.mjs` and opened with File → Open.

## Outside Mr. Mak

The eye button in the Copilot drawer copies the same context for an agent in
another tool, and the box under it reads a pasted reply. The rules above apply
unchanged.

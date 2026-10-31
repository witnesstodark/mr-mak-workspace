---
name: game-ui-workflow
description: Design and implement game HUDs, menus, icons and portrait systems from visual proposals through reusable engine assets and input checks. Use when a game interface needs a coherent visual and behavior contract.
---

# Game UI workflow

Inspect the current game camera, input rules, UI framework and representative
screens. Reuse the project's selected visual language and framework. Establish
the information and actions the player needs before generating decorative art.

## Design against real gameplay

Use a native game capture as the context for a proposal. Keep it intact when
comparing HUD alternatives, so changing the background cannot disguise contrast
or obstruction. Define shared surface, type, spacing and selection tokens;
preserve semantic colours for ownership, health, danger and accepted choices.

Separate visual art from live data. Decide which values come from runtime state,
which actions dispatch existing commands and what remains unimplemented. Show
unavailable data honestly instead of inventing a currency, timer or gameplay rule.
Include hover, selected, disabled, empty and overflow states when relevant.

Review the actual interface scale and aspect ratios. Corner anchors, minimum
sizes, long labels and compact rosters should remain usable at a narrow viewport.
Test the intended selection/grouping rules; unit type and team may be independent
keys. A combined health display and a range of differing stats are different data.

## Prepare reusable assets

Keep approved art and source masters, with stable asset IDs and a manifest of
source paths/hashes. Export icons at their intended display scale. Check alpha
edges on light/dark backgrounds, shared optical weight and silhouette readability.
For stretchable panels, identify border regions explicitly; verify corners at
several sizes before choosing nine-slicing or another rendering approach.
For pixel-art interfaces, follow `pixel-art-workflow`; for vector icon masters
and logos, `vector-graphics-workflow`.

Static and animated portraits need the same crop and a reliable still fallback.
Budget concurrent video decoders/render targets, share identical playback when
appropriate and release hidden views. Portrait art should be data-driven rather
than adding a new UI branch for each character. Preserve GUIDs and existing
bindings when updating imported assets.

## Integrate and prove interaction

Use the engine's existing UI tools or an available editor bridge. State the
required framework/package instead of assuming a particular MCP is installed.
Keep layout and world-input exclusion in agreement: a click over a panel must
not also command the world. Verify hover/click, drag, keyboard focus, selection,
minimap behaviour and pause/return paths that the changed screen owns.

Read current values and cooldowns from their authoritative systems. Avoid
duplicating combat/production timers in presentation code. Reuse views, bound
expensive updates and avoid per-frame texture readback for a minimap.

Save the real assets and check them in a fresh engine session. Deliver the theme,
asset mapping, native captures, tested interactions and open decisions. A browser
mockup approval is a design decision, not a claim of engine integration.

Example request: "Give the existing HUD a compact unit panel and six matching
command icons." Success includes consistent icons, real selection data, working
commands, overflow behaviour and no click-through. Dependencies: the current UI
sources, game captures and target-engine access for implementation.

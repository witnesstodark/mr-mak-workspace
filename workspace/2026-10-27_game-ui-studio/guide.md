# Game UI Studio Guide

**Game UI Studio** is a visual layout and handoff tool for game interfaces in the
Mr. Mak Workspace. You place widgets on a screen, set engine anchors, states,
navigation and focus, check the layout against the
[Game UI Guidelines](../../knowledge/game-ui-guidelines.md), and hand an
agent-ready specification to the engine (Godot, Unreal UMG, Unity, Three.js).
Open it from the Mr. Mak sidebar (**UI Studio**) or at
`workspace/2026-10-27_game-ui-studio/editor.html` over HTTP.

---

## Layout

| Area | What it holds |
| :--- | :--- |
| Top bar | Project picker with **×** to remove the chosen project from the list (**File → Project folders…** restores it; Mr. Mak remembers the list), **File** menu (open and export `.gameui.json`, export PNG, project folders), Undo / Redo, the **Screen / Flow** switch, the checks badge, **Handoff** and **Copilot** |
| Tool strip (left edge) | One tool per widget, each with a key: **V** select, **P** panel, **B** button, **T** text label, **S** slider / gauge, **I** image, **N** text input, **C** toggle, **G** group, plus **Insert template** |
| Layers / Kit | **Layers** is the element tree of the active screen: filter, collapse, drag to reorder or nest (drop on empty space to move to the root), double-click to rename, eye and lock per row. Dots mark elements with check issues; icons mark intent notes, links and the default focus. **Kit** holds the connected game's look (see Game kit) |
| Stage | Screen tabs (double-click to rename, **+** for a new screen from a template) and the design resolution, then the canvas with rulers and a floating view toolbar |
| Properties (right) | Sections that open on demand. Nothing selected shows the screen; a selection shows the element |
| Copilot drawer | The agent chat and its proposed edits. Closed until you open it; it lies over the properties on narrow windows and docks as a column from 1760 px wide |
| Status bar | Screen and resolution, the selection box, snapping, undo depth and the last message |

Only Layout, Text and Intent are open at first. Other sections (Appearance,
States, Navigation & focus, Advanced) open with a click and stay as you left them.

## Placing and editing widgets

1. Press a tool key (or click the tool) and click on the canvas to place the widget
   at its default size, or drag to draw its size. **Enter** places it in the middle
   of the selected panel or the screen; **Esc** cancels.
2. A widget dropped inside a panel or group becomes its child. On the screen root it
   takes the anchor nearest to where it sits, so corner widgets start anchored to
   their corner.
3. Drag to move and drag the handles to resize, both snapped to the grid. A click
   without moving only selects. Arrow keys nudge (Shift for 10 px); a run of nudges
   is one undo step. Locked elements cannot be selected or moved on the canvas;
   select them in Layers.
4. Double-click a button or label on the canvas to edit its text.

## Game kit

The **Kit** tab beside Layers shows the art, colours, fonts, components and
screens of the game chosen in the project picker. Copilot's **Game kit** chip
builds the kit: it copies the game's UI art into `assets/<project>/`, reads how
the game styles its UI and writes `kit.json`. **Reload** reads the kit again.

| Click | Does |
| :--- | :--- |
| An image, with a panel, button or input selected | Makes it the element's **skin**, with the 9-slice margins from the kit. A button set (normal, hover, pressed, disabled) skins every state at once |
| An image, with an image selected | Replaces its picture |
| An image, with nothing selected | Adds it at its native size |
| A component | Inserts the game's ready-made widget (button, panel, tooltip, title…) into the selected panel or the screen |
| A colour | Paints the selection: fill, text colour for labels, fill for gauges. With nothing selected it copies the value. Colour pickers also list the kit's colours |
| A font | Sets the selected text element in it. The **Font** field under Text lists the kit's fonts |
| **Open the game's screens** | Opens the game's own screens as the document (Ctrl + Z returns to the previous one) |

Under Appearance, **Skin image** and **9-slice** (`left, top, right, bottom` in
source pixels, or one number for all four) can also be typed, and each state can
override the skin. Applying art adds `Skin:` or `Asset:` with the game's path to
the element's intent note, so the handoff names the engine file.

## Properties

- **Layout:** a 4 × 4 anchor grid. The 3 × 3 block holds the point anchors; the last
  column stretches horizontally (top, middle, bottom), the last row vertically
  (left, middle, right), and the corner fills the parent. Changing the anchor keeps
  the element where it is. Stretch anchors relabel X / W (or Y / H) as margins.
- **Text / Content:** text, size, weight, colour and alignment, or the slider,
  toggle, input and image fields.
- **Appearance:** fill, border, radius and opacity.
- **States (buttons and inputs):** Normal, Hover, Pressed, Focused and Disabled.
  Picking a state also previews it on the canvas; each state stores its own fill,
  border and text colour, plus the focus ring colour or the disabled opacity.
- **Navigation & focus (interactive elements):** the screen this element opens on
  confirm (or *Back: close this screen*), default focus, and its place in the focus
  order.
- **Intent for agent:** behaviour notes that travel in the handoff.
- **Advanced:** lock, visibility, panel padding, spritesheet crop and the element ID.

With nothing selected, the properties show the **screen**: name, type (main menu,
submenu, modal dialog or HUD; *Auto* guesses from the name), screen notes, the
Esc / B target, the focus order with the default (★), the screen each button opens,
and the reference overlay (a gameplay screenshot to trace over, with opacity).

## View toolbar

- Zoom out / in (Ctrl − / Ctrl =, or Ctrl + wheel); the percentage returns to Fit.
- Grid and snapping (off, 8, 16, 32 px), the 90% action-safe frame, the
  reference overlay and the **intent pins**: every element with an intent note gets
  a numbered pin at its top-right corner, in layer order. Click a pin to select the
  element; hover it to read the note. The pin number also shows in the element's
  Intent section.
- **Aspect preview:** Design, 16:9 at 1280 × 720, 21:9 and 16:10. Anchors are
  recomputed and pixel sizes stay the same, which shows drift and overlap the way an
  engine without UI scaling would. Edits still apply to the design.
- **State preview:** the five states. *Focused* draws the focus ring on the selected
  element (or the default focus) and numbers the focus order.

## Screen and Flow

**Screen** edits one screen on the canvas. **Flow** shows every screen as a card
with its links: solid lines for confirm links from buttons, dashed lines for
Esc / Back, an amber stub for a link to a screen that no longer exists. Screens that
return to the previous screen show *Esc ↩ previous*. Click a card to select the
screen and edit its navigation in the properties; double-click to open it on the
canvas.

## Guideline checks

The badge in the top bar counts the issues on the active screen (all screens in
Flow) and opens the list. **Locate** opens the screen, switches the aspect preview
to the failing ratio and outlines the element. A one-click fix appears only where it
is safe and is undone with Ctrl + Z. The same issues appear at the top of the
element's properties.

| Rule | From the guidelines | Fix |
| :--- | :--- | :--- |
| Off screen, outside its parent | Buttons must fit on the screen | Move inside |
| Outside the action-safe area (HUD) | Safe-zone placement | Move into the safe area, with the widgets drawn on it |
| Anchor drifts across aspect ratios | Responsive anchors, 16:9 / 16:10 / 21:9 | Anchor where it sits |
| Overlapping widgets (HUD, interactive siblings) | No overlapping HUD widgets | Locate only |
| Text does not fit | Text containment | Widen or grow |
| Inconsistent sibling font sizes | Consistent sizing | Use the common size |
| Missing visual states | Five visual states | Add the missing states |
| Gauge without a numeric value (HUD) | Dual readouts | Show value |
| No default focus, unsafe modal focus | Default focus; Cancel focused on modals | Focus the first or the safest button |
| Esc / B does nothing, no Back button | Escape / Cancel navigation | Esc returns to the previous screen |
| Destructive action without confirmation | Confirm quit, restart, main menu, restore defaults | Link to the only modal |
| Link to a missing screen | | Remove the link |

**Ask Copilot to review** sends the guideline audit prompt with these results to the
agent.

## Copilot

The drawer talks to an agent chat in the selected project folder (Antigravity,
Claude, Codex or OpenCode, with an effort level). Ctrl + K opens it and focuses the
message box. The chat starts with your first message, never with bypassed
permissions, and is reused while the agent, folder and effort stay the same. The
line under the pickers shows its state; **Open chat** shows it in Mr. Mak Chats.
When the agent stops on a permission or choice menu, the menu appears in its
reply bubble: click an option, tick boxes and submit, write your own answer, or
cancel. A menu that changed in the meantime is refused, never answered blind.

**What each message carries.** The **Sends** chips attach the active screen as
compact JSON (ids, anchors, rects, props that differ from the defaults, links, focus
and the failing checks) and the selected element with all its props, followed by
the edit protocol. Click a chip to leave it out. The eye button shows exactly what
is added and its size, and a **Handoff** tab with the live Markdown; **Copy** takes
either one, for example to an agent outside Mr. Mak, and the box below reads a
reply pasted back.

**Replies.** The studio reads the agent's reply from its conversation transcript,
the same source as the Conversation view; for an agent without a readable
transcript it shows the end of the terminal instead. Plain text appears as a
message. A fenced `gameui-edit` block becomes a **Proposed changes** card:

- one row per op, with what it changes; ops the studio rejects show why, and
  **Ask to fix** sends those reasons back to the agent
- **Preview** draws the result on the canvas while the card stays open: dashed
  outlines for new and changed elements (with *new*, *moved* or *resized*), hatching
  for removals. Collapsing the card, closing the drawer or Esc hides it. A pill over
  the canvas repeats Apply and Discard
- **Apply** applies the valid ops as one undo step; the applied card offers Undo
  while nothing else has changed since
- **Discard** removes the card

Every card is checked again against the current layout before it previews or
applies, so edits you make in the meantime are respected.

The chips under the thread send the handoff, ask for engine code, build the game
kit, or ask for a guideline review with a fix proposal. A reply is awaited for as
long as the agent works; one that ran long still arrives as cards. Agents follow
the `game-ui-studio` skill (`.agents/skills/game-ui-studio/`), which also covers
loading the game's existing screens into the studio. Art from a project outside
the Mr. Mak repository is copied to `assets/<project>/` here, which Git ignores.

### Edit format

```gameui-edit
{"summary": "Add a Back button", "screen": "<screen id>", "ops": [
  {"op": "add", "parent": "<element id or null>", "index": 0, "node": {"id": "BtnBack", "type": "button", "name": "BtnBack", "anchor": "bottom-left", "rect": [96, -54, 200, 48], "props": {"text": "Back"}, "opens": "@previous"}},
  {"op": "update", "id": "<element id>", "set": {"rect": {"y": 120}, "props": {"fontSize": 18, "comment": null}}},
  {"op": "remove", "id": "<element id>"},
  {"op": "screen", "set": {"onBack": "@previous", "focusDefault": "BtnBack"}},
  {"op": "link", "from": "<button id>", "to": "<screen id>"}
]}
```

| Op | Changes |
| :--- | :--- |
| `add` | A new element (with optional `children`) at the screen root or inside `parent`; a new `id` lets later ops refer to it |
| `update` | `name`, `anchor`, `rect` (`[x, y, w, h]` or some of `x`, `y`, `w`, `h`), `props` (merged; `null` removes one) or `opens`. An anchor without a rect keeps the element where it is |
| `remove` | The element and its children, also from the focus order |
| `screen` | `name`, `role`, `notes`, `resolution`, `onBack`, `focusDefault`, `focusOrder` |
| `link` | What a button opens on confirm: a screen id, `@previous` or `null` |

Ops apply in order; an op that fails changes nothing and the rest still run. The
studio rejects unknown ops, fields or props, ids that do not exist on the screen,
duplicate new ids, invalid types, anchors, colours and ranges, links from elements
that cannot take focus and links to missing screens. `edits.mjs` holds the format
and its checks; `node --test "workspace/2026-10-27_game-ui-studio/test/*.test.mjs"`
runs its tests.

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `V` `P` `B` `T` `S` `I` `N` `C` `G` | Select tool, then panel, button, label, slider, image, input, toggle, group |
| `Enter` (tool armed) | Place the widget in the middle of the selected panel or the screen |
| `Esc` | Close a menu, cancel the tool, then clear the selection |
| `Ctrl + Z` / `Ctrl + Y` / `Ctrl + Shift + Z` | Undo / redo |
| `Ctrl + D` | Duplicate the selected element |
| `Delete` / `Backspace` | Remove the selected element |
| `Arrow Keys` / `Shift + Arrow Keys` | Nudge by 1 / 10 pixels |
| `Ctrl + =` / `Ctrl + −` / `Shift + 1` | Zoom in / out / fit |
| `Ctrl + K` | Open Copilot |

---

## Data Schema & Portability

Layouts export as `.gameui.json`, and the studio keeps a local draft. The schema
records the document and project, screens (resolution, notes, background overlay)
and a tree of elements with stable IDs, anchors, local rects, visual props and
intent comments. Offsets follow screen axes from the anchor point, so right and
bottom anchors use negative offsets to sit inside.

Optional fields, written only when set:

| Field | Meaning |
| :--- | :--- |
| `screen.role` | `menu`, `submenu`, `modal` or `hud`; inferred from the name when absent |
| `screen.nav.onBack` | Screen ID opened by Esc / B, or `@previous` to close and return |
| `screen.focus.default` / `screen.focus.order` | Element focused on open, and the navigation order (missing elements follow in tree order) |
| `node.nav.onConfirm` | Screen ID the element opens, or `@previous` |
| `node.props.states.focused` | Focused colours and `ringColor`, beside `hover`, `pressed` and `disabled` |
| anchors `top-stretch`, `bottom-stretch`, `left-stretch`, `right-stretch` | Edge stretch presets of the 4 × 4 grid |

Files from earlier versions open unchanged; a stale `activeScreen` falls back to
`activeScreenId` or the first screen.

**Handoff** opens the agent-ready Markdown for the active screen: the layout tree
with anchors and links, the element manifest, navigation and focus, and
implementation instructions. Copy it or send it to Copilot. Agents can also read
the `.gameui.json` file directly from the project.

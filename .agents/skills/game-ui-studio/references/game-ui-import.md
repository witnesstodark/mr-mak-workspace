# Loading the game's UI into the studio

Rebuild the game's current screens as studio screens with their real names,
positions, anchors, navigation, focus and art, so the owner can review and
redesign what the game already has. Reading the game changes none of its files.

## Two routes

| Request | Route |
| --- | --- |
| One screen, into the open document | A `gameui-edit` block for the active screen. When it still holds a template, first `remove` its elements in the same block. The owner can add an empty screen with **+** first |
| Several screens, or the whole game | A spec file, `scripts/build-gameui.mjs`, and a `.gameui.json` the owner opens with File → Open |

File → Open replaces the open document (Ctrl + Z returns to it). Tell the owner
to export their current layout first if it holds work.

## Reading the source

Work out each element's box in screen pixels at the design resolution, the
resolution the game's UI scaling targets (Godot's viewport size, Unity's Canvas
Scaler reference resolution, Unreal's DPI curve reference, the web game's design
width). Then map the widget type:

| Studio type | Godot | Unity (uGUI) | Unreal (UMG) | Web |
| --- | --- | --- | --- | --- |
| `panel` | `Panel`, `PanelContainer`, `ColorRect`, `NinePatchRect` | `Image` used as a background | `Border`, `Image` used as a background | `div` with a background |
| `button` | `Button`, `TextureButton` | `Button` | `Button` | `button`, `a` |
| `label` | `Label`, `RichTextLabel` | `Text`, `TMP_Text` | `TextBlock`, `RichTextBlock` | text elements |
| `slider` | `ProgressBar`, `TextureProgressBar`, `HSlider` | `Slider`, a filled `Image` | `ProgressBar`, `Slider` | `progress`, `input[type=range]` |
| `image` | `TextureRect`, `Sprite2D` in UI | `Image`, `RawImage` | `Image` | `img`, `canvas` |
| `input` | `LineEdit`, `TextEdit` | `InputField`, `TMP_InputField` | `EditableTextBox` | `input`, `textarea` |
| `checkbox` | `CheckBox`, `CheckButton` | `Toggle` | `CheckBox` | `input[type=checkbox]` |
| `group` | `Control`, containers | empty `RectTransform` | `CanvasPanel`, `Overlay`, boxes | layout `div` |

Positions by engine:

- **Godot `.tscn`:** a Control's box in its parent is
  `anchor_* × parent size + offset_*` for each edge (`anchors_preset` names the
  common sets). Containers (`VBoxContainer`, `HBoxContainer`, `GridContainer`,
  `MarginContainer`, `CenterContainer`) place children at run time: compute them
  from separation, margins, minimum sizes and size flags, or read them from the
  running game.
- **Unity prefab or scene YAML:** per axis, with parent size `P`,
  `size = sizeDelta + (anchorMax - anchorMin) × P` and
  `pivot position = anchorMin × P + (anchorMax - anchorMin) × P × pivot + anchoredPosition`,
  so `left = pivot position - pivot × size`. Unity's y axis points up: the studio
  top is `P - (bottom + height)`. Layout groups position children at run time.
  UI Toolkit screens come from UXML with USS; read them from the running game.
- **Unreal:** Widget Blueprints are binary. Read the widget tree through the
  editor (an available Unreal MCP or editor Python: each `CanvasPanelSlot`'s
  anchors, offsets, alignment and auto size) or from the C++ that builds it. A HUD
  drawn in `AHUD::DrawHUD` or with Slate takes its boxes from the draw calls.
- **Web and Three.js overlays:** open the game at the design resolution in a
  browser and read each element's `getBoundingClientRect()`.
- **No readable source**, or a layout built at run time: take a native capture at
  the design resolution, set it as the screen's `background` and trace the boxes
  from it. Say which screens are traced.

Keep the engine's anchor when it is one of the studio's (corners, edge centres,
centre, full or edge stretch); otherwise leave `anchor` out and the builder picks
the nearest one. Name elements and use IDs after the engine nodes. Put the
source file in the screen notes and `Source: <node path>` plus the behaviour
(the signal or handler) in each element's comment.

Navigation: a button that opens another screen gets `opens` with that screen's
name; a back or close handler gets `"@previous"`; the screen's Esc / B handler
is `onBack`. Record the default focus and focus order when the engine defines
them (Godot `focus_neighbor_*`, Unity `Navigation`, UMG focus). Art follows
[UI assets](ui-assets.md).

## The builder

`scripts/build-gameui.mjs` takes the screens with absolute boxes and writes a
studio document. It converts each box to the element's anchor, applies every
element through the studio's own edit checks and runs the guideline checks. It
writes nothing when an element is rejected and refuses to replace a file
without `--force`.

```sh
node <mrmak>/.agents/skills/game-ui-studio/scripts/build-gameui.mjs spec.json <project>/ui-studio/<game>.gameui.json
```

Pass `--studio <folder>` when the studio is
not at `<mrmak>/workspace/2026-10-27_game-ui-studio`. Keep the spec in the
scratch folder and the `.gameui.json` in the project, where the studio's handoff
and later agents can read it. Commit it only when the owner asks.

```json
{
  "projectName": "Global Empires",
  "projectPath": "D:/games/global-empires",
  "screens": [
    {
      "name": "Main Menu", "role": "menu", "resolution": [1920, 1080],
      "notes": "Source: res://ui/main_menu.tscn",
      "background": "assets/global-empires/captures/main-menu.png",
      "focusDefault": "BtnPlay", "focusOrder": ["BtnPlay", "BtnOptions"],
      "elements": [
        { "id": "MenuBox", "type": "panel", "name": "MenuBox", "box": [760, 400, 400, 300],
          "props": { "bgColor": "#1e293b" }, "children": [
          { "id": "BtnPlay", "type": "button", "name": "BtnPlay", "box": [800, 440, 320, 60],
            "anchor": "top-center", "props": { "text": "Play", "comment": "Source: MenuBox/BtnPlay; starts a new game" } },
          { "id": "BtnOptions", "type": "button", "name": "BtnOptions", "box": [800, 520, 320, 60],
            "anchor": "top-center", "props": { "text": "Options" }, "opens": "Options" }
        ] }
      ]
    },
    { "name": "Options", "role": "submenu", "onBack": "@previous", "elements": [] }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `box` | `[x, y, w, h]` in screen pixels, for children too; the builder makes them relative to the parent |
| `anchor` | Optional; one of the studio's anchors |
| `props` | The studio's props for that type, as in the edit protocol |
| `opens`, `onBack` | A screen name or ID, `"@previous"` or `null` |
| `role` | `menu`, `submenu`, `modal` or `hud` |
| `background`, `backgroundOpacity` | A reference capture behind the screen, loaded like an image `src` |

## Verifying

The builder lists the guideline issues of each screen. They describe the
game's current UI: report them, and do not fix them in the import unless the
owner asks. Ask the owner to open the file and compare each screen with its
capture (Screen properties → reference overlay). Report the screens and
elements imported, what was traced or approximated (containers, lists filled at
run time, localized text) and the assets that still need an exported PNG.

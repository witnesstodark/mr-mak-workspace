# The game kit

A kit makes a game's look usable in the studio. The owner opens the **Kit** tab
beside Layers and clicks to:

- skin a panel, button or input with the game's art (a button set covers its
  hover, pressed and disabled images);
- swap an image;
- add the game's icons and backgrounds;
- paint with its colours;
- set text in its fonts;
- insert ready-made components in its style;
- open the game's screens.

The studio finds the kit for the folder chosen in its top bar, through
`assets/kits.json`. Each message's context names the kit file (`"kit"`).

## Building it

1. Copy the art as [UI assets](ui-assets.md) says, into
   `<studio>/assets/<project>/`. Keep each file's path inside the project.
2. Read how the game styles its UI, to learn the 9-slice margins, colours,
   fonts and how the widgets are made:
   - Unity: USS, UXML, prefabs and the `.meta` `spriteBorder`;
   - Godot: themes, `StyleBoxTexture` margins and `NinePatchRect`;
   - Unreal: brushes;
   - Web: CSS `border-image`.
3. Write a spec (below), save it as `assets/<project>/kit.spec.json`, and run:

   ```
   node <mrmak>/.agents/skills/game-ui-studio/scripts/build-kit.mjs assets/<project> --project "<name>" --project-path "<project folder>" --spec <spec>
   ```

   `--project-path` is the folder the studio's project picker shows for the game,
   which is also this chat's folder. The script:
   - measures every image;
   - drops duplicates, review boards and `Source`/`Reference` folders;
   - sorts each image into a category by words in its path (English and
     Portuguese);
   - pairs files that differ only by a state word (`btn_normal`, `btn_hover`,
     `botao_pressionado`) into a state set;
   - writes `kit.json` and lists it in `assets/kits.json`.
4. Check what it printed: the category counts and the state sets. Fix a wrong
   category with `categories`, then run it again. The studio reads the kit after
   your reply; **Reload** in the Kit tab reads it again.

## Spec

All fields are optional.

```json
{
  "engine": "Unity UI Toolkit",
  "resolution": [1920, 1080],
  "notes": "How the game's UI is made, in two sentences.",
  "prefer": ["GE-game/"],
  "exclude": ["/thumbnails/"],
  "slices": { "botao_": 16, "painel_principal": [15, 15, 15, 15] },
  "categories": { "contador": "panel", "tecla": "button" },
  "fonts": [{ "file": "EBGaramond", "name": "EB Garamond", "use": "All HUD text" }],
  "colors": [{ "name": "Title gold", "value": "rgb(226, 196, 106)", "use": "Panel titles" }],
  "components": [{ "name": "Button (game skin)", "category": "button", "node": { "type": "button", "name": "BtnGame", "rect": [0, 0, 260, 64], "props": { "text": "Continue", "fontFamily": "EB Garamond", "skin": "assets/<project>/…/botao_normal.png", "skinSlice": [16, 16, 16, 16], "states": { "hover": { "skin": "…/botao_hover.png" } } } } }],
  "screens": "assets/<project>/screens.gameui.json"
}
```

- `prefer`: path parts listed first. A file copied twice keeps the path the
  engine loads, not the one in a delivery folder.
- `slices`: the first path part that matches gives the margins
  `[left, top, right, bottom]` in source pixels. A single number sets all four.
  Read them from the game, never guess.
- `categories`: path part → `button`, `panel`, `background`, `frame`, `bar`,
  `divider`, `icon`, `portrait`, `cursor` or `other`.
- `fonts`: `file` matches a copied font file by a part of its name, and `name`
  is the family the elements use (`fontFamily`).
- `components`: studio nodes in the format of a `gameui-edit` `add` node, with
  real srcs from this kit:
  - name them after the game's widgets;
  - make one for each widget style the game repeats (its button, panel,
    tooltip, title, body text, key badge, bars);
  - use a transparent `bgColor` and `borderWidth` 0 on skinned elements, so the
    look is the art.
  - `skin` and `skinSlice` are the element's own props; `states.<state>.skin`
    swaps the image for one state.

  The script fails when a component points at a missing image.
- `screens`: a `.gameui.json` made with [game UI import](game-ui-import.md) and
  saved in the kit folder. The Kit tab then offers **Open the game's screens**.
  Build it when the game has screens to bring in, or when the owner asks for
  them.

## Replying

Say what the kit holds:
- the counts per category;
- the state sets;
- the components;
- whether the game's screens are included.

Then tell the owner to open **Kit** beside Layers. Do not place 40 images in a
`gameui-edit` block; the kit is how art reaches the studio. A block is still
right for a concrete change to the open screen, such as skinning its buttons
with the kit's set.

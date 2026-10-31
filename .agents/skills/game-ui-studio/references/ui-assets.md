# UI assets in the studio

## How the studio loads an image

Mr. Mak serves the studio page from the Mr. Mak repository, and an image
element's `src` is a URL relative to `editor.html`. So:

- Only files inside `<mrmak>` load. A path with a folder starting with `.`, or a
  `node_modules` or `target` folder, is refused.
- The browser draws PNG, JPEG, WebP, GIF, SVG and BMP. TGA, DDS, PSD, EXR,
  Unreal `.uasset` and Godot `.ctex` do not load.
- `src` holds at most 2000 characters, so an embedded `data:` image does not fit
  in an edit block. Do not point `src` at a remote URL.

| Where the art is | `src` |
| --- | --- |
| A project inside the Mr. Mak repository, such as `<mrmak>/projects/Game/ui/btn.png` | `../../projects/Game/ui/btn.png` |
| Copied into the studio's asset folder | `assets/<project>/ui/btn.png` |

## Finding the art

Search the project folder for UI images, atlases and fonts. Skip engine caches
and build output (`.godot/`, `.import/`, `Library/`, `Temp/`, `Intermediate/`,
`Saved/`, `DerivedDataCache/`, `Binaries/`, `build/`, `dist/`).

| Engine | Where UI art usually is | Atlas or slice data |
| --- | --- | --- |
| Godot | `ui/`, `assets/ui/`, `themes/`; `res://` paths in `.tscn` and `.tres` | `AtlasTexture` regions, `NinePatchRect` patch margins, `Theme` `StyleBoxTexture` |
| Unity | `Assets/**/UI`, `Assets/**/Sprites`, `Assets/**/Textures` | The image's `.meta` (`spriteMode`, `spriteSheet.sprites` rects, `spriteBorder`); a sprite's GUID in a prefab resolves through `.meta` files |
| Unreal | `Content/UI`, `Content/**/Textures`; source PNGs often in `Art/`, `Source/`, `Raw/` | Brush margins in the widget; the `.uasset` itself is binary |
| Web, Three.js | `public/`, `assets/`, `src/assets/` | TexturePacker or Aseprite JSON, CSS `background-position`, `border-image` |

Also copy font files (`.ttf`, `.otf`, `.woff`, `.woff2`): the kit registers
them and text elements use them through `fontFamily`. A bitmap font (`.fnt`)
does not load; name it in the notes and comments.

## Making it loadable

1. A project inside `<mrmak>`: use the file where it is.
2. A project elsewhere: copy the browser-readable files to
   `<mrmak>/workspace/2026-10-27_game-ui-studio/assets/<project>/`, keeping their
   path inside the project (`assets/global-empires/ui/hud/frame.png`). Git
   ignores that folder, so game art stays out of the Mr. Mak repository. Copy;
   never move, rename or edit the game's files.
3. Only an engine format: use the source image the project keeps beside it. When
   there is none, export a PNG copy into the same asset folder (the editor's
   export, an available editor MCP or an image tool for PSD layers) and say it is
   an export.
4. Read each image's pixel size from the file (PNG header or an image tool).

## Reporting and placing

List each asset as name, studio `src`, original path, engine path (`res://…`,
`Assets/…`, `/Game/…`), pixel size and atlas regions. Then propose image
elements in a `gameui-edit` block:

- `rect` at the image's native size, or its crop size for an atlas region, unless
  the screen needs another size; `fit: "fill"` for slices drawn at a set size.
- `crop` with the region in source pixels for a sprite sheet entry.
- `comment` starting with `Asset: <engine path>`, because the handoff carries the
  comment and not `src`.
- A button, panel or input takes the art as `skin` with `skinSlice` margins,
  and `states.<state>.skin` per state; add `Skin: <engine path>` to its comment.

Many assets do not belong in a block: build the [game kit](game-kit.md), which
is how the owner browses and applies them.

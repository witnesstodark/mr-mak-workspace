# Asset library (Acervo)

A card can keep a library of a project's assets: previews, views, audio, earlier
versions, where each original lives and how it was generated. The library is one
data file and one generated page in the card folder:

```text
workspace/<card>/assets.json   the data (edit this)
workspace/<card>/assets.html   the page (generated; do not edit)
workspace/<card>/media/...      previews the data names
```

Build or check the page from the repository root:

```sh
node workspace/_shared/asset-library/build.mjs workspace/<card> --check
node workspace/_shared/asset-library/build.mjs workspace/<card>
```

Nothing is written while the data has an error. The page inlines its own style
and script, and loads only `report.css` and `report.js` from `workspace/_shared`.

Register the page as a step of the card, and name the project the card belongs
to, so "Send to chat" knows which chats work on it:

```json
{ "id": "my-game", "title": "My Game", "folder": "my-game", "project": "projects/My Game",
  "steps": [{ "name": "Assets", "path": "assets.html" }], "...": "..." }
```

`project` is a folder relative to the repository, or an absolute path for a game
kept elsewhere.

## assets.json

```json
{
  "title": "My Game assets",
  "categories": [{ "id": "vehicles", "name": "Vehicles" }],
  "families": { "characters/heroes": "Heroes" },
  "items": [{
    "id": "knight", "name": "Knight", "category": "characters", "family": "heroes",
    "status": "review", "version": 2,
    "thumbnail": "media/characters/heroes/knight-v02.webp",
    "views": [{ "label": "Back", "file": "media/characters/heroes/knight-v02-back.webp" }],
    "original": "Art/Characters/Knight.psd",
    "prompt": "A knight in silver armour",
    "generation": { "provider": "fal", "job": "abc-123", "model": "flux-pro", "date": "2026-11-02", "cost": 4 },
    "history": [{ "version": 1, "thumbnail": "media/characters/heroes/knight-v01.webp", "note": "Helmet too large" }]
  }]
}
```

- `id` and `family`: lowercase letters, digits and hyphens. `id` is unique.
- `category`: `characters`, `environment`, `props`, `interface`, `audio`,
  `key-art`, or an extra one listed in `categories`.
- `status`: `current`, `review` or `discarded`. `version`: 1 to 999; `history`
  keeps only earlier versions.
- Optional: `thumbnailLabel`, `views`, `audio` (a path or a list of
  `{ label, file }`), `model` (GLB, offered as a download), `original` (text:
  where the real file lives), `prompt` (text), `promptFile`, `note`,
  `generation` (`provider` and `job`, plus `model`, `date` as YYYY-MM-DD and
  `cost`).
- Every item needs a `thumbnail`, except an audio item.

Files are paths relative to the card folder, written with `/`, without `..`,
hidden folders, a scheme, a query or a fragment. After links are followed they
must still be inside the card folder. Types and limits: images `.webp`, `.png`,
`.jpg`, `.jpeg`, `.gif`, `.avif` up to 1 MB; audio `.ogg`, `.mp3`, `.wav`,
`.m4a` up to 16 MB; models `.glb` up to 25 MB; prompt files `.md`, `.txt` up to
256 KB. The card keeps previews; the original stays in the project.

## Sending an item to a chat

In the desktop app, each item has **Send to chat** and **Ask for a variation**.
The page sends only the item's id. Mr. Mak then:

1. answers only the card's own frame, on the origin the page actually runs on;
2. reads the item from the card's `assets.json`;
3. picks the chat from the card's `project` in `workspace.json`: the selected
   chat when it works there, otherwise that project's most recently used chat;
4. shows the chat, its folder and the exact message, and sends it only when the
   owner chooses **Send**. Cancel, Escape or leaving the card sends nothing.

A variation request asks the chat to give the estimated cost and wait for
approval before spending credits, then to add the result as the item's next
version and rebuild the page. In a browser or the phone preview the buttons only
explain that sending works in the desktop app.

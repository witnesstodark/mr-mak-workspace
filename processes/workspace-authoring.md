# Authoring a Workspace card

1. Read the current registry and reuse the relevant project or task card.
2. Create a dated folder only for a new independent task. Keep sources and
   output media local to that task or its project folder.
3. Write the result in English by default. Use stable tab names and relative
   paths. Keep one main project pinned when it is the user's working hub.
   For directly editable galleries or research, follow
   [the editable card format](../docs/editable-cards.md). Store content in a
   `.card.json` file and register `viewer: "card"`. Preserve stable entry IDs and
   validate before saving. Keep custom HTML when a task needs its own layout.
   For a project's assets, follow [the asset library](../docs/asset-library.md):
   edit `assets.json`, regenerate `assets.html` and set the card's `project`.
4. Add the shared report CSS and script; use `data-mak-report="document"`.
   Markdown requires no HTML wrapper and opens in the formatted document view.
5. Make every image clickable and downloadable. Videos need native controls.
   Keep source links near claims and label historical model runs as historical.
6. Update the registry's `updated` date after meaningful changes. Preserve the
   original `created` date. Do not mark personal work `sample: true`.
7. Open every changed tab at wide and narrow widths, test links and media,
   then report the outcome. A built installer is not an installed update.

New HTML reports can begin with:

```html
<!doctype html>
<html lang="en" data-mak-report="document">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Project report</title>
  <link rel="stylesheet" href="../_shared/report.css">
  <link rel="stylesheet" href="../_shared/examples.css">
  <script defer src="../_shared/report.js"></script>
</head>
<body><main class="container"><h1>Project report</h1></main></body>
</html>
```

The relative paths above assume a folder immediately inside `workspace/`.
Adjust them for nested reports. All sample pages follow the same shared style.

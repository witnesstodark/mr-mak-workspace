# Authoring a Workspace card

1. Read the current registry and reuse the relevant project or task card.
2. Create a dated folder only for a new independent task. Keep sources and
   output media local to that task or its project folder.
3. Write the result in English by default. Use stable tab names and relative
   paths. Keep one main project pinned when it is the user's working hub.
4. Add the shared report CSS and script; use `data-mak-report="document"`.
   Markdown requires no HTML wrapper and opens in the formatted document view.
5. Make every image clickable and downloadable. Videos need native controls.
   Keep source links near claims and label historical model runs as historical.
6. Update the registry's `updated` date after meaningful changes. Preserve the
   original `created` date. Do not mark personal work `sample: true`.
7. Open every changed tab at wide and narrow widths, test links and media,
   then report the outcome. A built installer is not an installed update.
8. Keep the project's Need Decision tab current (below) whenever you raise or
   settle something the owner has to decide.

## The Need Decision tab

Every project card has a Markdown tab named `Need Decision`, saved as
`need-decision.md` in the card's folder and listed right after the card's
first tab. It holds only what is still waiting on the owner: decisions,
questions, and things to review or listen to.

- Start with `# Need Decision` and one line giving the number of open items
  and the date the tab was last updated.
- Group items under `##` headings by topic.
- Write each item as `### N. A short question`. Don't use a Markdown numbered
  list, because renderers renumber those and the owner answers by number.
  Number items in the order they're added and never reuse a number, even after
  an item is removed.
- Under each item, give enough context to answer it without opening other
  tabs, the options, `**Recommended:** …` when there is a recommendation, and
  `From: <tab>, <section>` for where it came from. Keep items short. Split a
  question whose parts could be answered separately.
- Add an item in the same turn it is raised in chat. Anything in a chat block
  starting `Needs your decision:`, `For your review:` or `Questions for you:`
  belongs here too, and so does a `Flag:` that asks something.
- When the owner answers, record the answer, with its date, where it belongs
  in the card, then delete the item from this tab. Answered items don't stay
  here; the card's other tabs keep the history.
- When nothing is open, the tab says "Nothing is waiting on you."

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

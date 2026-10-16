# A small first task

Ask your agent: "Use fal.ai to make one brass observatory robot concept. Inspect
the live model schema first. Save the result locally with the prompt and request
ID. I will choose whether to make an edit after reviewing it."

The agent selects a model from current discovery, or uses one you named. The
included input is a Nano Banana Pro example, not a standing model preference.
From this skill directory, rehearse locally (on macOS or Linux, use `python3` or
the `.venv/bin/python` from [setup](../references/setup.md) instead of `python`):

```text
python scripts/fal_job.py submit --endpoint fal-ai/nano-banana-pro --input examples/concept.json --out output/robot --dry-run
```

Expected: `dry_run: true`, the endpoint and input field names. No network request
and no generated image. This checks the helper, not your account access.

For a generation you actually requested, omit `--dry-run`. The receipt is
`output/robot/job.json`. Continue without resubmitting:

```text
python scripts/fal_job.py status --job output/robot/job.json
python scripts/fal_job.py result --job output/robot/job.json
```

Result retrieval checks for a completed queue state and then downloads media into
the same task directory. Inspect the object before calling it accepted. To edit
the chosen image, upload that local file, replace the placeholder in `edit.json`
with the saved upload URL, inspect the edit endpoint, and use a new task directory.

Expected visual criteria: one complete robot, telescope head, three feet, blue
body, readable silhouette. For the edit, only the paint changes. There is no
sample render in this package; these criteria are a rehearsal brief, not a claim
that a generation was run for the handoff.

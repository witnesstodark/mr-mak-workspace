# Agent build loop

For assets that agents build in Blender Python and check by eye. Protect each
agent's context.

**Source.** One rerunnable headless script per step (model, rig, clips, export,
review renders), each opening the previous `.blend`. Fix by editing and
rerunning. Copy shared helpers; never modify them.

**Stages.** One fresh agent per stage. It does that stage, updates the handoff
and stops.
- A. Model and concept match: strongest model.
- B. Rig, clips, export, reimport: strongest model. Skip if static.
- C. Engine import, review renders, videos, report: lighter model such as
  Sonnet. It records defects in the handoff for A or B to fix.

**Handoff.** `<asset>/handoff.md`, under 80 lines, is the only memory between
stages: state, rebuild commands in order, key numbers, decisions, open issues,
notes for the next stage. Read it first; do not re-derive it. Continue earlier
partial work rather than restarting. Reply to the coordinator in a few lines.

**Context.**
- Prefer printed numbers (IoU, tris, bones, size) to images; scripts print one
  summary line. Filter Blender output with `grep` or `tail`; read files with
  offsets.
- Render and compare at about 720 px tall. Open only images you must judge,
  one composite per view. Never
  reopen a judged round. Judge motion from one pose sheet, not videos.

**Match loop.** Render each reference view orthographic, same facing,
transparent film. Run `scripts/compare_views.py --concept <sheet> --crop
x0,y0,x1,y1 --render <png> --out <dir>/round_<N>_<view>.png --overlay` for a
side-by-side, an overlay and the IoU. Fix the largest difference first:
silhouette, then parts, colour, detail. Do 3 to 8 rounds and log round, change
and IoU. IoU guides; it does not accept.

**Parallel.** One Blender process per agent. Each agent writes only to its own
asset folders; shared files and commits belong to the coordinator.

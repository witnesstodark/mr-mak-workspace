---
name: sprite-animation-workflow
description: Plan and produce 2D sprite animation, including facing directions, mirroring, frame counts and timing, pivots, gameplay event frames, layered equipment and flipbook effects, with previews and sheet exports.
---

# Sprite animation workflow

Read the art contract (canvas, pivot, directions, timing) and the code that will
play the clips: movement speed, attack timing and the events gameplay expects.
Write the animation list before drawing. For each clip record directions,
frames, per-frame durations, loop or one-shot, event frames (footstep, release,
hit, interrupt window) and the layers it needs. Count clips x directions x
frames x layers; that number is the production cost, so agree it first.

## Directions and canvas

With four directions, draw down, up and one side, and mirror the other side
only where the design allows it. Mirroring swaps the weapon hand, hair parting,
badges, scars and text. List mirror-unsafe details and either keep them
symmetric or give them their own frames. Decide once whether a held weapon
changes hands when mirrored; many top-down games accept it.

Every frame of a clip, in every direction and layer, shares one canvas and one
pivot (the feet contact point for characters). Do not trim frames
individually; use shared-bounds trimming or keep the full canvas. The pivot
stays fixed through idle and walk: weight moves the body, not the anchor. In a
top-down game, code moves the character and clips do not carry root motion.

## Timing

Use per-frame durations rather than a single frame rate when poses need holds:
anticipation, contact, impact and recovery. Gameplay timing is authoritative.
The hit frame must match the moment damage is applied, or the code must read the
event from the clip; record which. A cancelled windup must not show its hit.

For walks, place contacts on frames 1 and 3 of four (or 1 and 4 of six), with a
1 px body drop on contact and rise on passing, arms opposing legs. Keep head and
body volumes constant. Set the cycle from movement speed: one cycle is two
steps, so its duration is about 2 x step length / speed, or feet visibly skate.
A slower movement mode, such as sneaking, needs its own clip rather than a
slowed walk.

## Layered characters

When body, outfit, hair, headgear and held items combine, every layer uses the
same frame layout, canvas and pivot. Record draw order per direction in a
manifest: a far-hand weapon or a backpack goes behind the body when facing up.
Use masks for hair under hats and recolour ramps for variants. Prefer shared
clips, recolours and fewer frames over bespoke frames per combination.

## Flipbook effects

Hit sparks, dust, splinters, coin bursts and smoke are short one-shot flipbooks
with their own canvas and a pivot at the emission point. Keep the art pixel
density and palette. Show speed with smear frames and shape change, not alpha
blur. Follow [game-vfx-workflow](../game-vfx-workflow/SKILL.md) for triggers,
attachment and cleanup.

## Produce and review

Approve one key pose per direction first, then derive frames from it by faithful
edits or hand work. Whole sheets from an image model are rarely consistent;
check identity, proportions and pixel density across frames. Clean frames as in
[pixel-art-workflow](../pixel-art-workflow/SKILL.md).

Use the [2d-asset-prep](../2d-asset-prep/SKILL.md) `sheet.py` helper: `preview`
for a GIF at game zoom and real speed (`--onion` shows spacing), `contact` with a
pixel grid for frame review, and `pack` for the sheet plus its JSON. Review
silhouettes per frame, steady pivot, no 1 px jitter in parts that should be still,
readable contacts and timing against movement in the game. Keep per-frame
masters; a sheet is a rebuildable export.

Example request: "Give the bandit a four-direction walk and a light attack."
Expected result: an animation list with event frames, approved key poses,
frames on the contract canvas, GIF previews, packed sheets with JSON and the
event-frame numbers the gameplay code will use.

Dependencies: the art contract, the playing code and the sibling skills above.

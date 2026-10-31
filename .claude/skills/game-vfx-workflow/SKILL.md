---
name: game-vfx-workflow
description: Develop game effects from visual references and motion studies through an engine handoff, with event timing, lifecycle, readability and native review. Use for combat, status, environment or object effects.
---

# Game VFX workflow

Start from the effect's gameplay meaning, the actual game camera and an existing
capture. Inspect the relevant animation, event and visibility code before
promising a trigger. A diagram can propose appearance; only the engine can prove
event timing, cleanup and rendering cost.

## Establish a reviewable direction

Separate a reference board, proposed motion and implemented effects. Preserve
the user's selected direction and revisions. For a vendor preview, record its
source and what should be borrowed; viewing it does not supply an asset licence.
Use the project's approved provider when new concept art is requested. Do not
generate another batch just to turn a chosen direction into a handoff.

Describe the effect in layers: purpose, shape, colour, attachment, timing and
intensity. Distinguish a continuous state from a one-shot event. A small contact
burst, a spreading death stain and an ongoing damage fire need separate lifecycles.
Make attachment space explicit: a hand glow follows a socket, while a released
trail stays briefly in world space. Changing an emitter must not teleport old
particles.

For an interactive study, expose only useful comparisons: layer isolation,
normal/slow playback, scale, ground contrast and the relevant interruption.
Label its timings as illustrative when they are not verified animation markers.
Keep old versions reachable and use stable option names.

## Write the engine contract

Read [the lifecycle and review checklist](references/implementation.md) when
preparing integration. Record real release/contact markers from the accepted
animation or gameplay clock. A projectile owns its travel; confirmed contact
owns its impact. A cancelled windup must not schedule a later hit effect.

Specify where an effect is spawned, who owns it, how it fades and what removes
it. Include death, cancellation, despawn, scene unload and any game-specific
visibility/storage transitions. Reset trail history on teleport or reuse.
For surface effects, use reviewed anchors or validated surface sampling. A
bounding box alone does not establish a valid wall, roof or ground contact.

For 2D flipbook effects, frame timing and sheets, see `sprite-animation-workflow`.
Use shared materials and bounded pools where appropriate. Restore only this
effect's material contribution; preserve team tint, hit flashes and other active
states. Measure transparent overlap and crowd cost on the actual target. Do not
add gameplay damage, buffs or balance changes as incidental VFX work.

## Deliver and review

Deliver the selected appearance, motion contract, local source references,
editable assets and implementation status. Record concept approval, native
verification and visual acceptance separately. Capture a real OFF/ON comparison
at normal gameplay zoom using the same action and camera; ensure underlying
gameplay is unchanged. Add an implemented effect to the project library with
its trigger, usage and native preview, not a generated illustration.

Example request: "Design a small shield impact that remains readable on pale
ground, then prepare its integration handoff." Success means a selected direction,
confirmed-hit trigger, cleanup contract and native review plan. It does not imply
that a concept preview has already been integrated. Dependencies: the project's
references and engine access for implementation; generation tools are optional.

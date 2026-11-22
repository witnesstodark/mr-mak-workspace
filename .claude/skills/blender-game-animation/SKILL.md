---
name: blender-game-animation
description: Rig and animate supplied characters in Blender, revise motion from references, and deliver editable sources plus a verified game export.
---

# Blender game animation

Build an editable animation project from the supplied mesh and references.
Inspect existing work before changing it. Establish anatomy, skeleton needs,
forward axis, units, frame rate, clips, loop/root-motion behavior and gameplay
events from the task. Do not regenerate a supplied model as an incidental step.
When continuing another artist's file, inventory the rigs, Actions, slots,
constraints, reference media and export settings before editing. Keep a source
copy and distinguish approved clips from experiments.

## Build in code with agents

When agents build and iterate the model in Blender Python, follow the
[agent build loop](references/agent-build-loop.md).

## Rig and skin

Place joints from anatomy and give them stable rolls and bend directions. Keep
global placement separate from local body motion. Use editable contact controls
where they help. Automatic weights are a starting point: inspect disconnected
islands, opposite-side influence, shoulders/hips and rigid items. Normalize after
pruning and respect the destination engine's influence limit. Test joint extremes
before authoring the whole action library. An IK collapse can be a target/reach
problem rather than a weight problem.

## Motion and revisions

Block support changes, contact, impact and recovery before secondary motion.
Assess floor contact using deformed sole geometry. Compare the same event in
the source video and Blender, and inspect angles absent from the reference.
Single-camera depth reconstruction is inferred motion, not measured mocap.

Preserve approved actions while creating revisions. When a frame looks broken,
check nearby frames, interpolation, constraints and playback range before adding
more animation. Stabilize foot support, then add body compression, head response,
follow-through and tail motion where appropriate. Check loops through their seam.
Readability from the game camera and responsive recovery matter more than a
long decorative anticipation. Preserve approved gameplay event times.

## Timing and ordinary playback

Use `duration = (last_frame - first_frame) / fps`. Store duration and contact
times in seconds as well as frames. Changing fps alone changes speed; resample
in time when converting a clip. Keep a source action when making a compact game
variant. Each action needs explicit range and fps metadata. Check scene range,
preview range and NLA settings separately. Test action switching and ordinary
Play after saving and reopening; review scenes do not replace this check.
Bind the intended Action and its compatible slot explicitly. If several rigs
share a scene, playback range ownership must include the rig, Action, slot and
clip metadata, not just an Action name. Returning from an effect rig to a
character must restore the character's range. Suspend automatic range changes
while the user is posing. Save a readable textured viewport and verify it after
reopening; a render alone does not establish a usable authoring file.

## Bake and hand off

Bake evaluated motion onto a separate runtime skeleton, preserving the control
rig. Export intended mesh, runtime bones and clips; exclude helper bones,
unrelated scenes and muted library actions. Record textures, clip names, durations,
loop flags, root motion and events in the manifest.

Reimport from a copied directory into a clean scene. Verify bone count, skin,
textures, duration and sampled poses in a common coordinate system. Account for
UV/normal seam duplicates when comparing geometry. A raw vertex-index comparison
can be misleading after a valid export. Check permanent mesh edits across every
affected action, not just a single pose.
Read [export and integration checks](references/engine-handoff.md) for separate
model/clip files, bind-basis failures and turn-to-locomotion handoff.

Deliver editable source, runtime export, source references, review evidence and
a short engine guide. Distinguish source approval, export verification and actual
engine integration. A valid FBX does not wire a gameplay event or Animator.

Example: one supplied robot with Idle and Walk. Verify all foot contacts, loop
seam, normal action playback and a clean reimport. Dependencies: Blender, the
supplied mesh/references, and target-engine access for an integration check.
This module is a production workflow, not a universal one-click rigging script.

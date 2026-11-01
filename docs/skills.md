# Project skills

Twenty-nine skills live in this project. `.agents/skills` is the maintained source
for Codex; `.claude/skills` contains complete, identical copies for Claude Code,
including scripts and references. Both Skills sections open the full instructions.
These are local project files, not global installations.

Claude reads the instructions in its own `SKILL.md` when a skill is used; a
Markdown link is just a request to read another file, not automatic inheritance.
The template includes full folders so a normal Windows clone needs no symlinks.
See [Claude's skill format](https://code.claude.com/docs/en/skills).

For shared changes, edit `.agents/skills`, then run `npm run skills:sync`.
If you edited a Claude copy directly, first move that intended change into the
maintained source. `npm run test:template` checks that the two copies agree.

| Skill | Use it for |
| --- | --- |
| [2d-asset-prep](../.agents/skills/2d-asset-prep/SKILL.md) | Batch-prepare 2D images: remove backgrounds, trim with shared bounds, place art on fixed canvases with pivots, clean alpha, pack and slice sheets, build previews and generate normal maps. |
| [2d-production-routing](../.agents/skills/2d-production-routing/SKILL.md) | Set up a 2D game's art contract and choose the workflow for pixel art, sprites, animation, tilesets, cutouts, SVG graphics, UI, effects and engine import. |
| [3d-production-routing](../.agents/skills/3d-production-routing/SKILL.md) | Choose a practical workflow for 3D concepts, generated meshes, material maps, procedural Three.js reconstruction and game animation. |
| [blender-game-animation](../.agents/skills/blender-game-animation/SKILL.md) | Rig and animate supplied characters in Blender, revise motion from references, and deliver editable sources plus a verified game export. |
| [character-sheet-pipeline](../.agents/skills/character-sheet-pipeline/SKILL.md) | Prepare strict-front character sheets, isolated parts and optional multiview references for 3D modeling from an approved image. |
| [fal-ai-generation](../.agents/skills/fal-ai-generation/SKILL.md) | Generate and edit images, create video, audio, 3D assets or material maps through fal.ai MCP or the Python queue client. Use for fal model discovery, reference uploads, generation, recovery and local delivery. |
| [feature-handoff](../.agents/skills/feature-handoff/SKILL.md) | Prepare a precise handoff for an agent or developer implementing a feature, continuing a task or reviewing a finished change. |
| [game-animation-integration](../.agents/skills/game-animation-integration/SKILL.md) | Bring approved animation into a game, including clip mapping, turn exits, locomotion phase and gameplay event timing. |
| [game-audio-workflow](../.agents/skills/game-audio-workflow/SKILL.md) | Audition, select and integrate sounds with stable asset IDs, contact events, mixer rules and native listening checks. |
| [game-level-design](../.agents/skills/game-level-design/SKILL.md) | Build reviewable level drafts, validate scale and traversal, and apply accepted changes to the actual scene. |
| [game-ui-workflow](../.agents/skills/game-ui-workflow/SKILL.md) | Take a HUD or menu from a visual study to live game data, input behavior and native review. |
| [game-vfx-workflow](../.agents/skills/game-vfx-workflow/SKILL.md) | Develop effect layers, event timing, attachment, cleanup and in-game visual comparisons. |
| [gameplay-visual-review](../.agents/skills/gameplay-visual-review/SKILL.md) | Verify game changes with controlled native captures and separate implementation, visual review and acceptance. |
| [godot-2d-integration](../.agents/skills/godot-2d-integration/SKILL.md) | Bring 2D art into Godot 4 with pixel-safe imports, SpriteFrames and AnimationPlayer clips, TileSet terrains and metadata, 2D lights with normal maps, palette shaders and headless checks. |
| [higgsfield-workflow](../.agents/skills/higgsfield-workflow/SKILL.md) | Use the official Higgsfield CLI or its Blender integration to discover models, generate requested assets and resume recorded jobs. |
| [image-reference-workflow](../.agents/skills/image-reference-workflow/SKILL.md) | Explore image concepts and make faithful edits of accepted references for 3D or creative production, with explicit model choices and visual review. |
| [img2threejs](../.agents/skills/img2threejs/SKILL.md) | Turn an object or character reference image into a quality-gated, animation-ready procedural Three.js model built in code. Use for image-to-3D reconstruction, detail-accurate object rebuilds, stylized/likeness-maximized human characters, sculpt specs, and staged code generation. |
| [materials-to-game](../.agents/skills/materials-to-game/SKILL.md) | Create or apply material maps and bake a textured high-poly mesh onto a game mesh, with channel, UV and export checks. |
| [motion-reference-workflow](../.agents/skills/motion-reference-workflow/SKILL.md) | Prepare and select character motion references, or transfer approved motion to a human reference for a later mocap workflow. |
| [pixel-art-workflow](../.agents/skills/pixel-art-workflow/SKILL.md) | Make grid-true, palette-locked pixel art from generated or painted sources, design hue-shifted palettes and ramps, and produce recolour variants with review at game scale. |
| [pixel-text-sprites](../.agents/skills/pixel-text-sprites/SKILL.md) | Author pixel art directly as text grids (.pxt) with palettes, frames and animations, and render 1x sheets, manifests, recolour variants and previews headlessly. |
| [plan](../.agents/skills/plan/SKILL.md) | Turn a broad project request into a small actionable plan with concrete deliverables, dependencies and acceptance checks. |
| [sound-effects-workflow](../.agents/skills/sound-effects-workflow/SKILL.md) | Source, generate and prepare game sound effects: library and generator choices, prompt patterns, splitting, trimming, loudness normalisation, loops, visual review and Godot import. |
| [sprite-animation-workflow](../.agents/skills/sprite-animation-workflow/SKILL.md) | Plan and produce 2D sprite animation: directions, mirroring, frame timing, pivots, gameplay event frames, layered equipment and flipbook effects. |
| [tileset-workflow](../.agents/skills/tileset-workflow/SKILL.md) | Build 2D tilesets: terrain autotiles, top-down 3/4 walls, variants, grid props and destructible states with collision, occlusion and navigation metadata. |
| [vector-graphics-workflow](../.agents/skills/vector-graphics-workflow/SKILL.md) | Author, optimise and rasterise SVG icons, logos and menu shapes with exact export sizes, engine-matched rendering and pixel-art-safe conversion. |
| [video-watch](../.agents/skills/video-watch/SKILL.md) | Inspect a local or publicly accessible video through sampled scene frames, timestamps and a visual report, especially for motion and 3D reference analysis. |
| [voice-dictation-setup](../.agents/skills/voice-dictation-setup/SKILL.md) | Help configure optional local Whisper dictation into terminals and other apps, with language, hotkey and CPU or GPU checks. |
| [workspace-authoring](../.agents/skills/workspace-authoring/SKILL.md) | Create or maintain Workspace cards, report tabs and Markdown deliverables with consistent styling, working media previews and clear project organization. |

## 2D production

Eight skills cover 2D games, pixel art in particular. `2d-production-routing`
starts every task from a per-project art contract (view, grid, palette,
canvases, pivots, timing) and points to the right workflow. Pixel art, sprite
animation, tilesets, asset preparation and vector graphics include small
Python helpers (Pillow and numpy) for grid fitting, palette checks and swaps,
background removal, shared-bounds trimming, sheet packing, previews, normal
maps, seam checks and 47-tile blob composition. Godot 2D integration covers
pixel-safe imports, TileSet terrains, 2D lighting and a tested palette-swap
shader, with an import audit and headless checks. Generators are optional; the
skills work with any provider and with hand-made art.

`sound-effects-workflow` prepares sounds before `game-audio-workflow` maps them
to events: library or generator sourcing, prompt patterns, and a helper that
splits takes, trims, normalises loudness (BS.1770) under a true-peak ceiling,
makes loops and draws waveform and spectrogram sheets so an agent can review
what it cannot hear.

## Game production in 0.4.14

The six new game workflows connect concept work to implementation. They describe
how to inspect an existing project, preserve accepted work, hand over exact
event markers and review the result in the engine. They contain no private game
assets, character names, fixed balance values or personal working preferences.
Examples are illustrative; the receiving project's rules remain authoritative.

Blender animation now covers multiple Action owners, slots, bind-basis checks
and portable clip exports. Motion references keep a stable take ledger and
separate appearance transfer from mocap. Handoffs separate a selected proposal,
implementation, agent verification and user acceptance. The routing skill helps
an agent choose among these workflows.

These are instructions for agents, not bundled editor integrations. Use your
existing Unity or Blender connection, and check its available operations.
Generation is optional. A skill does not install an engine, connect an MCP
server or perform paid work by itself.

## Use the skills in another project

The release includes a separate **Mr-Mak-Skills-0.4.14.zip**. Extract it to a
temporary folder, then ask your agent to read `SKILLS-README.md` and copy only
the chosen modules and their dependencies into your project. Keep full skill
folders, including scripts, references and licences. The ZIP includes complete
Codex and Claude copies; no global installation or symlink is required.

The eight original creative modules and six new game workflows can be copied
with their own local resources. Preserve any referenced sibling skill when you
choose to use it. Keep the full img2threejs folder and its licences.

Workspace authoring, video inspection and dictation setup also reference this
repository's processes, knowledge and scripts. Copy those referenced files when
extracting a module; the ZIP includes these support files and shared report
assets. Merge them with an existing project instead of replacing its instructions,
reports or shared styles. Planning and handoff skills use the receiving project's
conventions. The standalone pack contains no Workspace cards or application.

A skill does not authenticate a provider or install a tool. Follow its setup
references and bring your own account. Credentials and raw paid-job receipts
must stay outside a shared skill pack.

For an existing Iaar installation, see the
[update guide](https://github.com/witnesstodark/mr-mak-workspace/blob/main/docs/updating.md). Installing the
desktop update alone does not put new skills into your repository.

# Game UI Guidelines & Design Standards (V2.0)

## Definition
To design and implement consistent, accessible, intuitive, and responsive game UI elements across all platforms and engines.

---

## General Rules

### Quality Assurance & Agent Contract
Every guideline under this document is mandatory unless explicitly overridden by the user. If the agent's technical judgment contradicts any guideline, the agent must state the conflict to the user and request permission before proceeding.

### Input & Interaction
#### Ensure
* **Input Blocking / UI Sink:** Hovering or clicking on UI elements must never propagate clicks or inputs to the game world underneath (e.g., clicking a button must not fire weapons or issue unit movement).
* **Escape / Cancel Navigation:** Every submenu, options screen, and modal popup must support `Escape` (keyboard) or `B / Circle` (gamepad) to back out or close, paired with an explicit on-screen "Back" button.
* **Default Focus:** When opening any menu using keyboard or controller navigation, the primary or first logical button must receive immediate visual focus.
* **Hybrid Navigation:** Support mouse, keyboard (arrow keys / WASD / Tab), and gamepad (D-Pad / analog stick) for all menu screens.
* **Dynamic Button Glyphs:** If gamepad input is detected, update prompt labels dynamically to match the connected controller layout (Xbox, PlayStation, or generic).
* **Clickable Hitboxes:** Button click areas must match or slightly exceed their visible bounding box, never being smaller than the label.

#### Avoid
* Arrow-key-only or mouse-only navigation.
* Confusing selection highlights when only two buttons exist (e.g., swapping colors between buttons without an obvious active indicator like borders, scale, or pointer icons).
* Invisible focus states where keyboard/controller users cannot see which element is active.
* Silent interaction failures: clicking a disabled button should visually explain why it is unavailable or remain unmistakably disabled.

### Layout & Sizing
#### Ensure
* **Consistent Sizing:** Maintain standardized button sizes, padding, and font scales across related elements.
* **Text Containment:** Button text must always fit inside the button boundaries with comfortable margins, accounting for localized text length variations.
* **Responsive Anchors:** Anchor UI elements relative to screen corners or edges (Safe Zones) rather than fixed central pixel coordinates, ensuring usability on 16:9, 16:10, and 21:9 Ultrawide displays.

#### Avoid
* Auto-expanding UI elements unless explicitly requested.
* Inconsistent font sizes across sibling buttons to force text to fit.
* Large verbose text inside action buttons (use concise action verbs: "Start", "Save", "Equip").

---

## Audio-Visual Feedback (UI Polish)

### Ensure
* **Visual State Transitions:** All interactive elements must implement 5 distinct visual states:
  - `Normal` (Default idle state)
  - `Hover` (Subtle highlight, glow, or scale increase)
  - `Pressed` (Visible physical depression, darker tint, or offset)
  - `Focused` (Clear border or icon indicator for keyboard/gamepad navigation)
  - `Disabled` (Reduced opacity, desaturated, no hover reaction)
* **Standard UI Audio Events:** Provide distinct, subtle audio cues for:
  - Hover / Focus
  - Confirm / Click
  - Back / Cancel
  - Error / Disabled Action

### Avoid
* Static buttons that offer zero feedback when hovered or clicked.
* Jarring or overly loud UI sound effects that overpower gameplay audio.

---

## Main Menu & Pause Menu

### Main Menu
#### Ensure
* Buttons must always fit on the screen without vertical or horizontal page scrolling.
* Default recommended buttons (in top-to-bottom logical order):
  1. Continue (enabled only if an existing save state is detected)
  2. New Game
  3. Load Game (when applicable)
  4. Options
  5. Credits (optional)
  6. Quit
* Display current game build/version number discreetly in a corner (e.g., bottom-right).
* Require a confirmation modal before quitting to desktop.

#### Avoid
* Scrollable lists for core main menu navigation.
* Showing an active "Continue" button when no saved progress exists.

### Pause Menu
#### Ensure
* **Simulation Freeze:** The in-game pause menu must freeze all game physics, timers, entity spawners, and gameplay-critical audio (except ambient/menu music), unless multiplayer rules explicitly forbid pausing.
* Recommended button layout:
  1. Resume
  2. Restart / Reload Checkpoint
  3. Options
  4. Main Menu
  5. Quit to Desktop
* Require confirmation before executing destructive actions (Restart, Quit to Main Menu).

---

## Options Menu

### Architecture & Persistence
#### Ensure
* Clear separation into categorized tabs:
  - **General**
  - **Video / Display**
  - **Graphics**
  - **Audio**
  - **Controls**
  - **Accessibility**
* Provide persistent bottom-bar actions on every tab:
  - `Apply Changes`
  - `Discard / Cancel`
  - `Restore Defaults` (with a confirmation prompt)
* Display an automatic 15-second countdown safety prompt when changing display mode or resolution ("Keep changes? Reverting in 15 seconds...").

### Tab Specifications

#### 1. General
* Audio language and text/subtitle language selection.
* Save slot management / Cloud sync status (if applicable).
* Gameplay toggles (e.g., tutorial hints, gore/violence filters).

#### 2. Video / Display
* Display Mode: Fullscreen, Borderless Windowed, Windowed.
* Screen Resolution and Display Monitor selection (multi-monitor setups).
* Graphics Card selection (for multi-GPU systems).
* V-Sync toggle and Maximum Framerate Limiter (30, 60, 120, 144, Unlocked).
* HDR toggle, Brightness / Contrast calibration screen.
* Safe Area / Border calibration slider.

#### 3. Graphics
* Predefined quality presets: Low, Medium, High, Ultra, Custom.
* Texture Quality.
* Shadow Quality and Lighting / Ambient Occlusion.
* Render Distance / Level of Detail (LOD).
* Post-Processing / VFX intensity.
* Anti-Aliasing method (FXAA, TAA, MSAA, or Off) and Upscaling (FSR/DLSS) if supported.

#### 4. Audio
* Volume sliders with real-time audio test feedback per channel:
  - Master Volume
  - Music Volume
  - Sound Effects (SFX) Volume
  - Voice / Dialogue Volume
  - UI Audio Volume
* "Mute on Focus Lost" toggle (silences game when Alt-Tabbed).

#### 5. Controls
* Key remapping table for keyboard and mouse actions.
* Controller layout map and button reassignment.
* Mouse Sensitivity sliders (general and scoped/aiming if applicable).
* Invert Y-axis toggle for camera and flight controls.
* Controller vibration intensity slider / toggle.

#### 6. Accessibility
* Colorblind filters: Protanopia, Deuteranopia, Tritanopia (with severity slider).
* Subtitles: Toggle on/off, text size slider, and solid/semi-transparent background box toggle for high contrast.
* Motion Sickness: Screen shake intensity slider and head-bob toggle.
* UI Scale slider (80% to 150%).

---

## HUD (Heads-Up Display)

### Layout & Hierarchy
#### Ensure
* **Safe Zone Placement:** Anchor primary elements to standard corners:
  - Vitals / Player Status: Top-Left or Bottom-Left.
  - Minimap / Compass / Objectives: Top-Right or Top-Center.
  - Ammo / Abilities / Action Bars: Bottom-Right or Bottom-Center.
* **Dual Readouts:** Critical gauges (Health, Energy, Mana, Shield) should display both a visual bar and exact numerical values (e.g., `85 / 100`).
* **Visual Damage Feedback:** Implement delayed trailing bars ("chip damage" fill that catches up smoothly) for clear feedback on hit impact.
* **Contextual Tooltips:** Tooltips appear on mouseover or button selection with a short, consistent delay (150–250ms).
* **Prototype Icons:** Pair text indicators with clear, readable prototype icons with consistent pixel/vector weights.
* **RTS / Command Cards:** If command cards exist, group actions by category (Move/Attack, Abilities, Stances, Production) with clear shortcut badges on each slot.
* **Notification Queue:** Event toasts and combat logs must have a maximum limit of visible items and auto-fade smoothly over time.

#### Avoid
* Hardcoded absolute pixel coordinates that cause elements to overlap or drift off-screen on different aspect ratios.
* Purely text-only HUD elements when visual symbols or icons improve rapid readability.
* Permanent screen clutter: secondary info (detailed stats, inventory descriptions) should be contextual or toggleable, not permanently occupying gameplay view.
* Overlapping HUD widgets under any standard gameplay condition.

---

## Confirmation & Modal Dialogs

### Ensure
* Modal dialogs must blur or dim the background game screen to maintain visual focus.
* Distinct styling for destructive buttons (e.g., red tint for "Delete Save" or "Quit") versus affirmative actions (e.g., green/accent tint for "Confirm").
* The safest option (e.g., "Cancel") should have default focus when the popup appears.

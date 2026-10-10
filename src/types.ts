export interface WorkspaceStep {
  name: string
  path: string
  /** Read-only builder output configured in the desktop service's local state. */
  source?: string
  /**
   * Omitted = HTML in an iframe, formatted Markdown, or an image preview,
   * selected by file extension. `compare3d` = a Compare3DManifest JSON and
   * the step renders the side-by-side 3D viewer instead.
   */
  viewer?: 'compare3d'
}

export interface WorkspaceEntity {
  id: string
  title: string
  description: string
  /** Optional project emblem, relative to this entity's folder. */
  icon?: string
  type: 'standalone' | 'group'
  category: string
  created: string
  /** Last day an agent touched this entity; dashboard sorts/archives by it. */
  updated?: string
  folder: string
  steps: WorkspaceStep[]
  /** Tab to open for a card link without an explicit step; otherwise use latest. */
  defaultStep?: number
  status: 'active' | 'done' | 'archived'
  pinned?: boolean
  /** Starter examples remain visible until explicitly archived. */
  sample?: boolean
}

export interface WorkspaceState {
  entities: WorkspaceEntity[]
}

/* ─── 3D comparison steps ─────────────────────────────────────────────────
   A manifest lives inside the entity folder next to a models/ directory. Paths
   in `file` are relative to the manifest. Model binaries stay local (gitignored,
   they run to tens of MB) — the manifest and the card are what get versioned. */

export interface Compare3DModel {
  /** Path to the .glb, relative to the manifest file. */
  file: string
  /** Shown above the pane — the generator name and version. */
  label: string
  /** Logo shown next to the label, relative to the manifest file. */
  logo?: string
  /** Optional second line: version, settings, generation time. */
  note?: string
  /** Optional colour for the pane label. */
  accent?: string
  /** Extra yaw in degrees, for exports that come out facing the wrong way. */
  rotationY?: number
  /**
   * Cover name shown instead of `label` while Redact is on. For models under
   * embargo: the card is filmed with the alias up, and the toggle reveals the
   * real name for the user's own use.
   */
  alias?: string
}

export interface Compare3DTest {
  id: string
  name: string
  /** `lowpoly` opens on the wireframe and hides texture-channel modes. */
  kind: 'lowpoly' | 'highpoly'
  /** Overrides the per-kind default opening mode. */
  defaultMode?: 'wire' | 'quads' | 'solid' | 'normals' | 'pbr' | 'albedo' | 'normalMap' | 'rough' | 'metal'
  note?: string
  /**
   * The reference image every model in this test was generated from, relative
   * to the manifest. Rendered as a thumbnail in the bar and full size on click
   * — without it there is no way to judge a result against its input.
   */
  input?: string
  models: Compare3DModel[]
}

export interface Compare3DManifest {
  title?: string
  tests: Compare3DTest[]
}

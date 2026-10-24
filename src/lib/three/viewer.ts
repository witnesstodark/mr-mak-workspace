/**
 * Minimal imperative three.js model viewer.
 *
 * Ported down from the top3d.ai arena viewer (React Three Fiber there, plain
 * three here — the dashboard has no r3f and this needs no reconciler). Keeps
 * the parts that matter for filming a comparison:
 *
 *   • normalise every model into the same 2-unit box so two panes are honestly
 *     comparable regardless of export scale
 *   • the shading set: white wireframe over a near-black body, clay solid,
 *     geometry normals, textured PBR, and raw texture-map channels
 *   • one shared Draco decoder, preloaded, worker-bounded
 *   • camera state in/out so two panes can be locked together
 *
 * Everything is disposed on unmount — the dashboard mounts and unmounts these
 * on every tab switch.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

export type ShadingMode =
  | 'wire'
  | 'solid'
  | 'normals'
  | 'pbr'
  | 'albedo'
  | 'normalMap'
  | 'rough'
  | 'metal'

export interface ViewerStats {
  vertices: number
  triangles: number
  meshes: number
  materials: number
  hasNormalMap: boolean
  hasRoughMap: boolean
  hasMetalMap: boolean
  hasBaseMap: boolean
  /** Largest texture dimension found, in pixels. 0 when the model is untextured. */
  textureSize: number
}

/**
 * Recover polygons from a triangulated glTF.
 *
 * glTF has no polygon primitive — a quad mesh always arrives as triangles. But
 * FB_ngon_encoding (Tripo declares it) is a convention rather than extra data:
 * the triangles of one polygon are consecutive and share the same FIRST index.
 * So the original faces are readable straight off the index buffer.
 *
 * Within a group, an edge used twice is an internal diagonal and an edge used
 * once is the polygon outline — which is exactly the quad wireframe. Groups are
 * tiny (a quad is 2 triangles), so the dedupe stays local and cheap even on a
 * two-million-triangle mesh.
 */
function ngonGroups(geo: THREE.BufferGeometry): number[] {
  const index = geo.index
  const pos = geo.attributes.position
  const triCount = index ? index.count / 3 : (pos?.count ?? 0) / 3
  const at = index
    ? (i: number) => index.getX(i)
    : (i: number) => i
  const sizes: number[] = []
  let i = 0
  while (i < triCount) {
    const first = at(i * 3)
    let j = i + 1
    while (j < triCount && at(j * 3) === first) j++
    sizes.push(j - i)
    i = j
  }
  return sizes
}

function ngonEdgeGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const index = geo.index
  const pos = geo.attributes.position as THREE.BufferAttribute
  const at = index ? (i: number) => index.getX(i) : (i: number) => i
  const sizes = ngonGroups(geo)

  const out: number[] = []
  const ea: number[] = []
  const eb: number[] = []
  const used: number[] = []
  let tri = 0
  for (const size of sizes) {
    ea.length = eb.length = used.length = 0
    for (let t = tri; t < tri + size; t++) {
      const a = at(t * 3)
      const b = at(t * 3 + 1)
      const c = at(t * 3 + 2)
      for (const [u, v] of [[a, b], [b, c], [c, a]] as [number, number][]) {
        const lo = Math.min(u, v)
        const hi = Math.max(u, v)
        let found = -1
        for (let k = 0; k < ea.length; k++) {
          if (ea[k] === lo && eb[k] === hi) {
            found = k
            break
          }
        }
        if (found >= 0) used[found]++
        else {
          ea.push(lo)
          eb.push(hi)
          used.push(1)
        }
      }
    }
    for (let k = 0; k < ea.length; k++) {
      if (used[k] !== 1) continue // internal diagonal of the polygon
      out.push(
        pos.getX(ea[k]), pos.getY(ea[k]), pos.getZ(ea[k]),
        pos.getX(eb[k]), pos.getY(eb[k]), pos.getZ(eb[k]),
      )
    }
    tri += size
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3))
  return g
}

export interface CameraState {
  pos: [number, number, number]
  target: [number, number, number]
}

/** Single shared Draco decoder — same reasoning as the arena: two panes decode
 *  at once, and per-instance decoders churn workers and can split versions. */
const DRACO_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/'
let sharedDraco: DRACOLoader | null = null
function draco(): DRACOLoader {
  if (!sharedDraco) {
    sharedDraco = new DRACOLoader()
    sharedDraco.setDecoderPath(DRACO_PATH)
    sharedDraco.setWorkerLimit(2)
    sharedDraco.preload()
  }
  return sharedDraco
}

const CLAY = 0xc2c2c6
const WIRE_BODY = 0x0b0b0d
const WIRE_LINE = 0xffffff

export class ModelViewer {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls

  /** Fired whenever the user moves this camera (for pane-to-pane sync). */
  onCameraChange: ((s: CameraState) => void) | null = null
  onStats: ((s: ViewerStats) => void) | null = null

  private container: HTMLElement
  private pmrem: THREE.PMREMGenerator
  private envRT: THREE.WebGLRenderTarget | null = null
  private root = new THREE.Group()
  private lightsPbr = new THREE.Group()
  private lightsClay = new THREE.Group()
  private originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
  private ownedMaterials = new Set<THREE.Material>()
  private wireOverlays = new Set<THREE.LineSegments>()
  /** Wireframe geometry per mesh, built on first use and kept — rebuilding it
   *  on a 2M-triangle mesh is not free. */
  private ngonEdges = new Map<THREE.Mesh, THREE.BufferGeometry>()
  private ngonDeclared = false
  private ro: ResizeObserver
  private raf = 0
  private dirty = true
  private disposed = false
  private applying = false
  private autoRotate = true
  private homeDist = 4
  private mode: ShadingMode = 'solid'

  constructor(container: HTMLElement) {
    this.container = container

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    container.appendChild(this.renderer.domElement)
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored)

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 200)
    this.camera.position.set(0, 0.4, 4)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.minDistance = 0.4
    this.controls.maxDistance = 40
    this.controls.autoRotateSpeed = 0.9
    this.controls.addEventListener('change', () => {
      this.dirty = true
      if (this.applying || !this.onCameraChange) return
      this.onCameraChange(this.cameraState())
    })
    // Any manual grab kills auto-rotate — nothing worse on camera than the model
    // creeping while you are trying to hold an angle.
    this.controls.addEventListener('start', () => this.setAutoRotate(false))

    this.pmrem = new THREE.PMREMGenerator(this.renderer)

    // Clay / matcap-ish rig: flat, shadowless, identical on both panes.
    this.lightsClay.add(new THREE.HemisphereLight(0xffffff, 0x1a1a20, 1.15))
    const key = new THREE.DirectionalLight(0xffffff, 1.1)
    key.position.set(4, 7, 5)
    this.lightsClay.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.35)
    fill.position.set(-5, 2, -4)
    this.lightsClay.add(fill)

    this.lightsPbr.add(new THREE.AmbientLight(0xffffff, 0.35))
    const pk = new THREE.DirectionalLight(0xffffff, 1.1)
    pk.position.set(6, 8, 5)
    this.lightsPbr.add(pk)
    const pr = new THREE.DirectionalLight(0xffffff, 0.4)
    pr.position.set(-6, -3, -5)
    this.lightsPbr.add(pr)

    this.scene.add(this.root)

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()
    this.tick()
  }

  // ── loading ──────────────────────────────────────────────────────────────

  /** Extra yaw applied to the loaded model, in degrees. Some exports come out
   *  facing sideways and a comparison is worthless if the two face different
   *  ways; set per model in the manifest. */
  async load(url: string, rotationY = 0): Promise<void> {
    const loader = new GLTFLoader()
    loader.setDRACOLoader(draco())
    loader.setMeshoptDecoder(MeshoptDecoder)

    const gltf = await loader.loadAsync(url)
    if (this.disposed) return

    this.clearModel()

    const declared: string[] =
      (gltf.parser as unknown as { json?: { extensionsUsed?: string[] } })?.json?.extensionsUsed ?? []
    this.ngonDeclared = declared.includes('FB_ngon_encoding')

    const model = gltf.scene
    // Normalise: scale the longest axis to 2 units, then centre on the origin.
    // Order matters — `position` is applied outside the object's own scale, so
    // subtracting a pre-scale centre leaves the model off by centre*(scale-1).
    // That is invisible when a model happens to export near 1:1 and obvious when
    // it does not (Tripo's fox floated above Meshy's). Measure again after
    // scaling and centre on that.
    // Yaw first so the box (and therefore the centring) is measured on the
    // orientation actually shown.
    if (rotationY) model.rotation.y += (rotationY * Math.PI) / 180
    model.updateMatrixWorld(true)
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z) || 1
    model.scale.setScalar(2 / maxDim)
    model.updateMatrixWorld(true)
    const centre = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3())
    model.position.sub(centre)

    this.root.add(model)

    let vertices = 0
    let triangles = 0
    let meshes = 0
    const mats = new Set<THREE.Material>()
    let hasNormalMap = false
    let hasRoughMap = false
    let hasMetalMap = false
    let hasBaseMap = false
    let textureSize = 0

    model.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      meshes++
      const geo = mesh.geometry as THREE.BufferGeometry
      if (!geo.attributes.normal) geo.computeVertexNormals()
      const pos = geo.attributes.position
      if (pos) vertices += pos.count
      triangles += geo.index ? geo.index.count / 3 : (pos?.count ?? 0) / 3

      // Keep the authored materials so PBR can be restored without reloading.
      this.originalMaterials.set(mesh, mesh.material)
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of list) {
        if (!m) continue
        mats.add(m)
        const s = m as THREE.MeshStandardMaterial
        if (s.map) hasBaseMap = true
        if (s.normalMap) hasNormalMap = true
        if (s.roughnessMap) hasRoughMap = true
        if (s.metalnessMap) hasMetalMap = true
        // Texture budget is a real difference between generators and it is
        // invisible in the viewport, so surface it next to the poly counts.
        for (const t of [s.map, s.normalMap, s.roughnessMap, s.metalnessMap]) {
          const img = t?.image as { width?: number; height?: number } | undefined
          if (img?.width) textureSize = Math.max(textureSize, img.width, img.height ?? 0)
        }
      }
    })

    this.onStats?.({
      vertices: Math.round(vertices),
      triangles: Math.round(triangles),
      meshes,
      materials: mats.size,
      hasBaseMap,
      hasNormalMap,
      hasRoughMap,
      hasMetalMap,
      textureSize,
    })

    this.frame()
    this.setMode(this.mode)
  }

  // ── shading ──────────────────────────────────────────────────────────────

  setMode(mode: ShadingMode): void {
    this.dirty = true
    this.mode = mode
    this.releaseOwned()

    const needsEnv = mode === 'pbr'
    if (needsEnv && !this.envRT) {
      // Procedural room instead of an HDRI: no network fetch, so the card still
      // works with the laptop offline.
      const room = new RoomEnvironment()
      this.envRT = this.pmrem.fromScene(room, 0.04)
      room.dispose()
    }
    this.scene.environment = needsEnv ? (this.envRT?.texture ?? null) : null

    this.lightsPbr.removeFromParent()
    this.lightsClay.removeFromParent()
    if (mode === 'pbr') this.scene.add(this.lightsPbr)
    else if (mode === 'solid' || mode === 'wire') this.scene.add(this.lightsClay)

    for (const [mesh, original] of this.originalMaterials) {
      const first = (Array.isArray(original) ? original[0] : original) as THREE.MeshStandardMaterial

      switch (mode) {
        case 'pbr':
          mesh.material = original
          break

        case 'solid':
          mesh.material = this.own(
            new THREE.MeshStandardMaterial({
              color: CLAY,
              metalness: 0,
              roughness: 0.85,
              side: THREE.DoubleSide,
            }),
          )
          break

        case 'normals':
          mesh.material = this.own(new THREE.MeshNormalMaterial({ side: THREE.DoubleSide }))
          break

        case 'wire': {
          // Unlit near-black body so the white edges are the only thing you read.
          // polygonOffset pushes the fill back a hair so the lines sit on top
          // without z-fighting; the body still occludes edges on the far side,
          // which is the whole point — a see-through wireframe reads as noise.
          mesh.material = this.own(
            new THREE.MeshBasicMaterial({
              color: WIRE_BODY,
              side: THREE.DoubleSide,
              polygonOffset: true,
              polygonOffsetFactor: 1,
              polygonOffsetUnits: 1,
            }),
          )
          // Quad wireframe when the file states its polygons, plain triangle
          // wireframe when it does not. Never merged on a hunch — inventing
          // quads on a triangle-only export would hide real edges.
          let wireGeo = this.ngonEdges.get(mesh)
          if (!wireGeo) {
            wireGeo = this.ngonDeclared
              ? ngonEdgeGeometry(mesh.geometry as THREE.BufferGeometry)
              : new THREE.WireframeGeometry(mesh.geometry)
            this.ngonEdges.set(mesh, wireGeo)
          }
          // Opaque on purpose: a transparent line material moves the overlay into
          // the sorted transparent pass and hidden edges start bleeding through.
          const wf = new THREE.LineSegments(
            wireGeo,
            this.own(new THREE.LineBasicMaterial({ color: WIRE_LINE })),
          )
          wf.renderOrder = (mesh.renderOrder || 0) + 1
          wf.userData.__wire = true
          mesh.add(wf)
          this.wireOverlays.add(wf)
          break
        }

        // Raw channel views — the map itself, unlit, so a flat or missing map is
        // immediately obvious instead of being hidden by lighting.
        case 'albedo':
          mesh.material = this.own(
            new THREE.MeshBasicMaterial({
              map: first?.map ?? null,
              color: first?.map ? 0xffffff : first?.color ?? 0xffffff,
              side: THREE.DoubleSide,
            }),
          )
          break

        case 'normalMap':
          mesh.material = this.own(
            first?.normalMap
              ? new THREE.MeshBasicMaterial({ map: first.normalMap, side: THREE.DoubleSide })
              : new THREE.MeshBasicMaterial({ color: 0x8080ff, side: THREE.DoubleSide }),
          )
          break

        case 'rough':
          mesh.material = this.own(
            first?.roughnessMap
              ? new THREE.MeshBasicMaterial({ map: first.roughnessMap, side: THREE.DoubleSide })
              : new THREE.MeshBasicMaterial({
                  color: new THREE.Color().setScalar(first?.roughness ?? 1),
                  side: THREE.DoubleSide,
                }),
          )
          break

        case 'metal':
          mesh.material = this.own(
            first?.metalnessMap
              ? new THREE.MeshBasicMaterial({ map: first.metalnessMap, side: THREE.DoubleSide })
              : new THREE.MeshBasicMaterial({
                  color: new THREE.Color().setScalar(first?.metalness ?? 0),
                  side: THREE.DoubleSide,
                }),
          )
          break
      }
    }
  }

  // ── camera ───────────────────────────────────────────────────────────────

  /** Pull the camera back to a framing that fits the (normalised) model.
   *  Deliberately does not broadcast: the heavy pane finishes loading seconds
   *  after the light one, and its framing must not yank a camera you have
   *  already set by hand. Both models normalise to the same box, so the framings
   *  agree anyway. */
  frame(): void {
    this.dirty = true
    const box = new THREE.Box3().setFromObject(this.root)
    if (box.isEmpty()) return
    this.applying = true
    const size = box.getSize(new THREE.Vector3())
    const centre = box.getCenter(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z) || 1
    const fov = (this.camera.fov * Math.PI) / 180
    const dist = (maxDim / 2 / Math.tan(fov / 2)) * 1.6
    this.homeDist = dist
    this.camera.position.set(centre.x, centre.y + size.y * 0.12, centre.z + dist)
    this.controls.target.copy(centre)
    this.controls.update()
    this.applying = false
  }

  cameraState(): CameraState {
    const p = this.camera.position
    const t = this.controls.target
    return { pos: [p.x, p.y, p.z], target: [t.x, t.y, t.z] }
  }

  /** Apply another pane's camera without echoing a change event back at it. */
  applyCamera(s: CameraState): void {
    this.dirty = true
    this.applying = true
    this.camera.position.set(...s.pos)
    this.controls.target.set(...s.target)
    this.controls.update()
    this.applying = false
  }

  setAutoRotate(on: boolean): void {
    this.dirty = true
    this.autoRotate = on
    this.controls.autoRotate = on
  }

  get autoRotating(): boolean {
    return this.autoRotate
  }

  get homeDistance(): number {
    return this.homeDist
  }

  // ── plumbing ─────────────────────────────────────────────────────────────

  private own<T extends THREE.Material>(m: T): T {
    this.ownedMaterials.add(m)
    return m
  }

  /** Drop every material/overlay this viewer created; never touch loaded assets. */
  private releaseOwned(): void {
    const cached = new Set(this.ngonEdges.values())
    for (const wf of this.wireOverlays) {
      wf.removeFromParent()
      // Quad outlines are cached across mode switches — disposing them here
      // would silently rebuild a 2M-triangle mesh on every toggle.
      if (!cached.has(wf.geometry)) wf.geometry.dispose()
    }
    this.wireOverlays.clear()
    for (const m of this.ownedMaterials) m.dispose()
    this.ownedMaterials.clear()
  }

  private clearModel(): void {
    this.dirty = true
    this.releaseOwned()
    for (const g of this.ngonEdges.values()) g.dispose()
    this.ngonEdges.clear()
    this.originalMaterials.clear()
    for (const child of [...this.root.children]) {
      this.root.remove(child)
      child.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.geometry?.dispose()
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const m of list) {
          if (!m) continue
          for (const key of Object.keys(m) as (keyof THREE.Material)[]) {
            const v = (m as unknown as Record<string, unknown>)[key as string]
            if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose()
          }
          m.dispose()
        }
      })
    }
  }

  private resize(): void {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.dirty = true
  }

  private tick = (): void => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    // Render only when the camera moved or the scene changed: a still model
    // costs no GPU time.
    if (this.controls.update() || this.dirty) {
      this.dirty = false
      this.renderer.render(this.scene, this.camera)
    }
  }

  // An idle viewer no longer renders every frame. Once the browser rebuilds
  // the WebGL context, redraw its contents even if the camera has not moved.
  private onContextRestored = (): void => {
    this.dirty = true
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.controls.dispose()
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored)
    this.clearModel()
    this.envRT?.dispose()
    this.pmrem.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}

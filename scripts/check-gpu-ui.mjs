// Exercise real canvas drawing and WebGL in an isolated browser, without chats.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { expect } from '@playwright/test';
import { launchBrowser } from '../desktop/service/test/browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await import('./ensure-workspace-link.mjs');
const output = path.join(root, '.cache/gpu-previews');
await mkdir(output, { recursive: true });
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false, watch: null, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await launchBrowser({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference' });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.canvasDraws = new WeakMap();
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      window.canvasDraws.set(this.canvas, (window.canvasDraws.get(this.canvas) || 0) + 1);
      return clear.apply(this, args);
    };
    window.animationFrames = async count => {
      for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame);
    };
  });
  await page.goto(server.resolvedUrls.local[0]);
  const logo = page.locator('.brand-text canvas');
  await logo.waitFor();
  await page.evaluate(() => document.fonts.ready);
  const sampleLogo = () => logo.evaluate(async canvas => {
    const before = window.canvasDraws.get(canvas) || 0;
    const start = performance.now();
    await window.animationFrames(30);
    return { frames: (window.canvasDraws.get(canvas) || 0) - before, ms: performance.now() - start };
  });
  const animated = await sampleLogo();
  assert.ok(animated.frames > 0, 'The visible logo still animates');
  assert.ok(animated.frames <= Math.ceil(animated.ms / (1000 / 24)) + 1, 'Logo drawing is capped at 24 fps');
  await page.locator('.sidebar-brand').screenshot({ path: path.join(output, 'sidebar.png') });
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, value: true }));
  assert.equal((await sampleLogo()).frames, 0, 'A hidden document does not redraw the logo');
  await page.evaluate(() => { delete document.hidden; });
  assert.ok((await sampleLogo()).frames > 0, 'Logo drawing resumes when visible');

  // Use the real model loader. Serve its decoder from the installed dependency,
  // so this test never needs the external Draco CDN.
  await page.route('https://www.gstatic.com/draco/versioned/decoders/1.5.7/**', route => route.fulfill({
    path: path.join(root, 'node_modules/three/examples/jsm/libs/draco/gltf', path.basename(new URL(route.request().url()).pathname)),
  }));
  await page.evaluate(async () => {
    const { ModelViewer } = await import('/src/lib/three/viewer.ts');
    const vertices = [], normals = [];
    for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
      const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
      for (const index of sign > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) {
        const point = [0, 0, 0], normal = [0, 0, 0];
        point[axis] = sign * 0.5;
        point[(axis + 1) % 3] = corners[index][0];
        point[(axis + 2) % 3] = corners[index][1];
        normal[axis] = sign;
        vertices.push(...point); normals.push(...normal);
      }
    }
    const position = new Float32Array(vertices), normal = new Float32Array(normals);
    const bytes = new Uint8Array(position.byteLength + normal.byteLength);
    bytes.set(new Uint8Array(position.buffer), 0);
    bytes.set(new Uint8Array(normal.buffer), position.byteLength);
    const encoded = btoa(String.fromCharCode(...bytes));
    const gltf = {
      asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] }],
      materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.8, 0.25, 0.35, 1], metallicFactor: 0, roughnessFactor: 0.8 } }],
      buffers: [{ byteLength: bytes.length, uri: 'data:application/octet-stream;base64,' + encoded }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: position.byteLength }, { buffer: 0, byteOffset: position.byteLength, byteLength: normal.byteLength }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: position.length / 3, type: 'VEC3', min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
        { bufferView: 1, componentType: 5126, count: normal.length / 3, type: 'VEC3' },
      ],
    };
    window.modelUrl = URL.createObjectURL(new Blob([JSON.stringify(gltf)], { type: 'model/gltf+json' }));
    const host = document.createElement('div');
    host.id = 'gpu-test-viewer';
    host.style.cssText = 'position:fixed;inset:100px auto auto 380px;width:500px;height:500px;background:#181820;z-index:9999';
    document.body.append(host);
    window.viewer = new ModelViewer(host);
    window.viewer.setAutoRotate(false);
    window.viewer.onStats = stats => { window.modelStats = stats; };
    await window.viewer.load(window.modelUrl);
  });
  assert.equal(await page.evaluate(() => window.modelStats.triangles), 12, 'The fixture was loaded as real geometry');
  const frame = () => page.evaluate(() => window.viewer.renderer.info.render.frame);
  const settle = async () => {
    await expect.poll(() => page.evaluate(async () => {
      const before = window.viewer.renderer.info.render.frame;
      await window.animationFrames(10);
      return window.viewer.renderer.info.render.frame - before;
    }), { timeout: 15000 }).toBe(0);
  };
  const canvas = page.locator('#gpu-test-viewer canvas');
  await settle();
  const initial = await canvas.screenshot();
  await canvas.screenshot({ path: path.join(output, 'solid.png') });
  const idleFrame = await frame();
  await page.evaluate(() => window.animationFrames(30));
  assert.equal(await frame(), idleFrame, 'An idle 3D model submits no new frames');
  for (const mode of ['wire', 'normals', 'pbr', 'solid']) {
    const before = await frame();
    await page.evaluate(mode => window.viewer.setMode(mode), mode);
    await expect.poll(frame).toBeGreaterThan(before);
    await settle();
    if (mode !== 'solid') assert.notDeepEqual(await canvas.screenshot(), initial, `${mode} changes the displayed image`);
    await canvas.screenshot({ path: path.join(output, `${mode}.png`) });
  }
  const beforeDrag = await page.evaluate(() => window.viewer.cameraState());
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + 200, bounds.y + 200);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 310, bounds.y + 245, { steps: 8 });
  await page.mouse.up();
  await settle();
  assert.notDeepEqual(await page.evaluate(() => window.viewer.cameraState()), beforeDrag, 'Orbit input still moves the camera');
  const beforeResize = await frame();
  await page.locator('#gpu-test-viewer').evaluate(node => { node.style.width = '360px'; });
  await expect.poll(frame).toBeGreaterThan(beforeResize);
  await expect(canvas).toHaveCSS('width', '360px');
  for (const action of ['sync', 'frame', 'reload']) {
    const before = await frame();
    await page.evaluate(async action => {
      if (action === 'sync') window.viewer.applyCamera({ pos: [3, 1, 4], target: [0, 0, 0] });
      if (action === 'frame') window.viewer.frame();
      if (action === 'reload') await window.viewer.load(window.modelUrl, 45);
    }, action);
    await expect.poll(frame).toBeGreaterThan(before);
    await settle();
  }
  const beforeRotate = await frame();
  await page.evaluate(() => window.viewer.setAutoRotate(true));
  await expect.poll(frame).toBeGreaterThan(beforeRotate + 3);
  await page.evaluate(() => window.viewer.setAutoRotate(false));
  await settle();
  // OrbitControls keeps tiny damping deltas below its change-event threshold.
  // Finish that decay before comparing the pixels across context restoration.
  await page.evaluate(() => {
    window.viewer.controls.enableDamping = false;
    window.viewer.applyCamera(window.viewer.cameraState());
  });
  await settle();
  const beforeLoss = await canvas.screenshot({ path: path.join(output, 'orbit.png') });
  // Browsers can discard an idle WebGL context under memory pressure. The
  // restored viewer must repaint without waiting for user input or a resize.
  await page.evaluate(async () => {
    const canvas = window.viewer.renderer.domElement;
    const extension = window.viewer.renderer.getContext().getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('WEBGL_lose_context is required to check viewer recovery');
    const lost = new Promise(resolve => canvas.addEventListener('webglcontextlost', resolve, { once: true }));
    extension.loseContext();
    await lost;
    const restored = new Promise(resolve => canvas.addEventListener('webglcontextrestored', resolve, { once: true }));
    // Context restoration is permitted after the loss event has been handled.
    setTimeout(() => extension.restoreContext(), 100);
    await restored;
  });
  await expect.poll(frame, { timeout: 5000, message: 'A restored idle WebGL context must repaint' }).toBeGreaterThan(0);
  await settle();
  assert.deepEqual(await canvas.screenshot({ path: path.join(output, 'restored.png') }), beforeLoss, 'Context restoration preserves the displayed model');
  await page.evaluate(() => { window.viewer.dispose(); URL.revokeObjectURL(window.modelUrl); });
  await expect(canvas).toHaveCount(0);
  const disposedFrame = await frame();
  await page.evaluate(() => window.animationFrames(10));
  assert.equal(await frame(), disposedFrame, 'Disposed viewers stop rendering');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await logo.waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal((await sampleLogo()).frames, 0, 'Reduced-motion preference keeps the logo static');
  assert.deepEqual(errors, []);
  console.log('GPU UI passed: capped/hidden/static logo; idle rendering; shading; orbit; resize; camera sync; reload; auto-rotate; WebGL recovery; disposal. Previews: .cache/gpu-previews.');
} finally { await browser?.close(); await server.close(); }

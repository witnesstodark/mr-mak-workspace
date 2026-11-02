"""Render a 3D subject in Blender into 2D sprite frames: directions x clips x frames.

Run headless inside Blender (written for the Blender 5.x Python API):

  blender -b model.blend --factory-startup --python-exit-code 1 -P render_sprites.py -- \
      --config sprites.json --out build/hero
  blender -b --factory-startup --python-exit-code 1 -P render_sprites.py -- --demo --out build/demo

An orthographic camera at the view's elevation and a fixed scale in pixels
per unit puts the subject's ground point on the same canvas pixel in every
frame. The subject turns on a pivot for each direction while camera and
light stay fixed, so light falls from the same screen side on every
facing. Passes: colour (realistic, toon or pixel look), camera-space normals
for 2D lights (green up), depth, and a shadow kept apart on a shadow
catcher (Cycles). Frames go to <out>/frames/<clip>/<direction>/; the
manifest <out>/sprites.json records camera, pivot, directions, clips,
fps, events and files. pack_sprites.py turns them into sheets.

The .blend file is never saved: every change exists only in this run.
"""
import argparse
import json
import math
import sys
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sprite_config as sc  # noqa: E402

CAMERA_DISTANCE = 50.0


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser(prog='render_sprites.py', description=__doc__.split('\n\n')[0])
    parser.add_argument('--config', help='JSON settings (see sprite_config.DEFAULTS); optional with --demo')
    parser.add_argument('--out', required=True, help='output folder')
    parser.add_argument('--demo', action='store_true', help='build a primitive test figure with idle and walk clips')
    parser.add_argument('--only', nargs='*', default=[], help='render only these clips')
    parser.add_argument('--dry-run', action='store_true', help='report the plan without rendering')
    return parser.parse_args(argv)


def node_tree_of(datablock):
    """The node tree of a material or world. Blender 5 creates it with the
    datablock (and deprecates use_nodes); older versions need it switched on."""
    if datablock.node_tree is None:
        datablock.use_nodes = True
    return datablock.node_tree


def srgb_to_linear(hex_colour):
    value = hex_colour.lstrip('#')
    channels = [int(value[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels) + (1.0,)


# ---------------------------------------------------------------- demo figure

DEMO_CONFIG = {
    'canvas': [72, 72], 'pixels_per_unit': 26.0, 'anchor': [36, 63], 'view': 'three-quarter', 'directions': 8,
    'engine': 'eevee', 'look': 'toon', 'samples': 8, 'passes': ['color', 'normal', 'depth', 'shadow'],
    'light': {'azimuth': -40.0, 'elevation': 62.0},
    'clips': {'idle': {'start': 1, 'end': 24, 'step': 6, 'fps': 6, 'loop': True},
              'walk': {'start': 25, 'end': 48, 'step': 3, 'fps': 12, 'loop': True,
                       'events': {'contact': [25, 37]}}},
}


def _material(name, hex_colour, roughness=0.6):
    mat = bpy.data.materials.new(name)
    bsdf = node_tree_of(mat).nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = srgb_to_linear(hex_colour)
    bsdf.inputs['Roughness'].default_value = roughness
    return mat


def _part(kind, name, size, location, material, parent, rotation=(0.0, 0.0, 0.0)):
    if kind == 'sphere':
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=1.0)
    elif kind == 'cylinder':
        bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=1.0, depth=1.0)
    elif kind == 'cone':
        bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=1.0, depth=1.0)
    else:
        bpy.ops.mesh.primitive_cube_add(size=1.0)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.location = location
    obj.rotation_euler = rotation
    obj.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    obj.parent = parent
    return obj


def _joint(name, location, parent):
    joint = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(joint)
    joint.location = location
    joint.parent = parent
    return joint


def build_demo():
    """A small figure from primitives: a hat and nose show where it faces, a
    pack shows its back, and the left arm carries a short staff so mirrored
    directions can be told apart. Idle (frames 1-24) and walk (25-48) loop."""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    scene = bpy.context.scene
    scene.render.fps = 24
    skin, tunic = _material('Skin', '#e0a080'), _material('Tunic', '#3c7a5a')
    cloth, boots = _material('Trousers', '#4a4060'), _material('Boots', '#4a3020')
    hat, pack, wood = _material('Hat', '#b03a2e'), _material('Pack', '#8a6a3a'), _material('Staff', '#a07840')
    root = bpy.data.objects.new('Figure', None)
    scene.collection.objects.link(root)
    body = _joint('Body', (0, 0, 0.0), root)
    _part('sphere', 'Torso', (0.24, 0.17, 0.32), (0, 0, 1.12), tunic, body)
    _part('sphere', 'Head', (0.17, 0.17, 0.18), (0, 0, 1.6), skin, body)
    _part('cone', 'Hat', (0.2, 0.2, 0.22), (0, 0.02, 1.8), hat, body)
    _part('cone', 'Nose', (0.04, 0.04, 0.1), (0, -0.18, 1.6), skin, body, rotation=(math.radians(90), 0, 0))
    _part('cube', 'Pack', (0.3, 0.14, 0.34), (0, 0.2, 1.15), pack, body)
    limbs = {}
    for side, x in (('L', 0.12), ('R', -0.12)):
        hip = _joint('Hip_' + side, (x, 0, 0.82), root)
        _part('cylinder', 'Leg_' + side, (0.075, 0.075, 0.7), (0, 0, -0.38), cloth, hip)
        _part('cube', 'Boot_' + side, (0.14, 0.24, 0.1), (0, -0.04, -0.76), boots, hip)
        shoulder = _joint('Shoulder_' + side, (x * 2.2, 0, 1.36), body)
        _part('cylinder', 'Arm_' + side, (0.055, 0.055, 0.55), (0, 0, -0.27), tunic, shoulder)
        if side == 'L':
            _part('cylinder', 'Staff', (0.025, 0.025, 1.1), (0.0, -0.12, -0.45), wood, shoulder,
                  rotation=(math.radians(80), 0, 0))
        limbs[side] = (hip, shoulder)
    for frame in range(1, 49):
        if frame <= 24:
            phase = 2 * math.pi * (frame - 1) / 24.0
            body.location.z = 0.012 * math.sin(phase)
            swing, arm = 0.0, 0.05 * math.sin(phase)
        else:
            phase = 2 * math.pi * (frame - 25) / 24.0
            body.location.z = 0.03 * abs(math.sin(phase))
            swing, arm = 0.5 * math.sin(phase), 0.4 * math.sin(phase)
        body.keyframe_insert('location', frame=frame)
        for side, sign in (('L', 1.0), ('R', -1.0)):
            hip, shoulder = limbs[side]
            hip.rotation_euler.x = sign * swing
            shoulder.rotation_euler.x = -sign * arm
            hip.keyframe_insert('rotation_euler', frame=frame)
            shoulder.keyframe_insert('rotation_euler', frame=frame)
    return root


# ---------------------------------------------------------------- scene set-up

def subject_objects(name):
    scene = bpy.context.scene
    if name is None:
        objects = [o for o in scene.objects if o.type not in ('CAMERA', 'LIGHT')]
    elif name in bpy.data.collections:
        objects = list(bpy.data.collections[name].all_objects)
    elif name in bpy.data.objects:
        root = bpy.data.objects[name]
        objects = [root] + list(root.children_recursive)
    else:
        raise SystemExit('subject %r is neither an object nor a collection in this file' % name)
    if not any(o.type == 'MESH' for o in objects):
        raise SystemExit('the subject has no mesh to render')
    return objects


def make_pivot(objects):
    """An empty at the world origin that every top-level subject object hangs
    from, so turning it turns the whole subject about its ground point."""
    pivot = bpy.data.objects.new('SpritePivot', None)
    bpy.context.scene.collection.objects.link(pivot)
    members = set(objects)
    for obj in objects:
        if obj.parent is None or obj.parent not in members:
            world = obj.matrix_world.copy()
            obj.parent = pivot
            obj.matrix_world = world
    return pivot


def make_camera(cfg):
    geometry = sc.camera(cfg, CAMERA_DISTANCE)
    data = bpy.data.cameras.new('SpriteCamera')
    data.type = 'ORTHO'
    data.sensor_fit = 'AUTO'
    data.ortho_scale = geometry['ortho_scale']
    data.shift_x, data.shift_y = geometry['shift_x'], geometry['shift_y']
    data.clip_start, data.clip_end = 0.1, CAMERA_DISTANCE * 3
    camera = bpy.data.objects.new('SpriteCamera', data)
    bpy.context.scene.collection.objects.link(camera)
    camera.location = geometry['location']
    camera.rotation_euler = geometry['rotation']
    bpy.context.scene.camera = camera
    return camera, geometry


def make_light(cfg, geometry, use_scene_lights):
    """One sun fixed relative to the camera: azimuth 0 shines from the camera's
    side, -90 from the screen's left, 180 from behind the subject; plus an
    even ambient from the world."""
    light = cfg['light']
    if not use_scene_lights:
        for obj in bpy.context.scene.objects:
            if obj.type == 'LIGHT':
                obj.hide_render = True
    a = math.radians(geometry['azimuth'])
    toward_camera = Vector((math.sin(a), -math.cos(a), 0.0))
    screen_right = Vector((math.cos(a), math.sin(a), 0.0))
    phi, rise = math.radians(light['azimuth']), math.radians(light['elevation'])
    ground = toward_camera * math.cos(phi) + screen_right * math.sin(phi)
    direction = (ground * math.cos(rise) + Vector((0.0, 0.0, math.sin(rise)))).normalized()
    data = bpy.data.lights.new('SpriteSun', 'SUN')
    data.energy = light['strength']
    data.angle = math.radians(light['soft'])
    sun = bpy.data.objects.new('SpriteSun', data)
    bpy.context.scene.collection.objects.link(sun)
    sun.rotation_euler = direction.to_track_quat('Z', 'Y').to_euler()
    world = bpy.data.worlds.new('SpriteWorld')
    background = node_tree_of(world).nodes.get('Background')
    background.inputs['Color'].default_value = (1.0, 1.0, 1.0, 1.0)
    background.inputs['Strength'].default_value = light['ambient']
    bpy.context.scene.world = world
    return [round(c, 4) for c in direction]


def configure_output(cfg):
    scene, render = bpy.context.scene, bpy.context.scene.render
    width, height = cfg['canvas']
    render.resolution_x, render.resolution_y, render.resolution_percentage = width, height, 100
    render.film_transparent = True
    render.use_compositing = False
    render.use_sequencer = False
    if hasattr(render.image_settings, 'media_type'):  # Blender 5
        render.image_settings.media_type = 'IMAGE'
    render.image_settings.file_format = 'PNG'
    render.image_settings.color_mode = 'RGBA'
    render.image_settings.color_depth = '8'
    render.filter_size = 0.0 if cfg['look'] == 'pixel' else 1.5
    if hasattr(scene, 'cycles'):
        scene.cycles.device = 'CPU'
        scene.cycles.use_denoising = False
        scene.cycles.seed = 0
        scene.cycles.filter_width = 0.01 if cfg['look'] == 'pixel' else 1.5


def set_engine(cfg, engine, samples, view_transform):
    scene = bpy.context.scene
    try:
        scene.render.engine = sc.ENGINES[engine]
    except TypeError:  # Blender 4.2 to 4.4 call EEVEE 'BLENDER_EEVEE_NEXT'
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    if engine == 'eevee':
        scene.eevee.taa_render_samples = samples
        scene.eevee.use_shadows = True
    elif engine == 'cycles':
        scene.cycles.samples = samples
    scene.view_settings.view_transform = view_transform
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0


# ---------------------------------------------------------------- looks

def base_colour_source(material):
    """The Principled BSDF's base colour: a linked socket or a constant."""
    if material is None or material.node_tree is None:
        return None, (0.8, 0.8, 0.8, 1.0)
    bsdf = next((n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        return None, (0.8, 0.8, 0.8, 1.0)
    socket = bsdf.inputs['Base Color']
    return (socket.links[0].from_socket if socket.is_linked else None), tuple(socket.default_value)


def toon_material(material, cfg):
    """A copy of the material shaded in flat bands: diffuse lighting read back
    as a colour (Shader to RGB, EEVEE only), stepped by a constant ramp from
    the shadow level to full light, times the original base colour."""
    toon = material.copy() if material else bpy.data.materials.new('Toon')
    toon.name = (material.name if material else 'Default') + '_toon'
    tree = node_tree_of(toon)
    nodes, links = tree.nodes, tree.links
    linked, constant = base_colour_source(toon)
    output = next((n for n in nodes if n.type == 'OUTPUT_MATERIAL'), None) or nodes.new('ShaderNodeOutputMaterial')
    diffuse = nodes.new('ShaderNodeBsdfDiffuse')
    to_rgb = nodes.new('ShaderNodeShaderToRGB')
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'CONSTANT'
    bands, shadow = max(2, int(cfg['toon']['bands'])), float(cfg['toon']['shadow'])
    elements = ramp.color_ramp.elements
    while len(elements) < bands:
        elements.new(0.5)
    for i, element in enumerate(elements):
        element.position = i / bands * 0.9
        level = shadow + (1.0 - shadow) * i / (bands - 1)
        element.color = (level, level, level, 1.0)
    multiply = nodes.new('ShaderNodeMix')
    multiply.data_type = 'RGBA'
    multiply.blend_type = 'MULTIPLY'
    multiply.inputs['Factor'].default_value = 1.0
    emission = nodes.new('ShaderNodeEmission')
    links.new(diffuse.outputs['BSDF'], to_rgb.inputs['Shader'])
    links.new(to_rgb.outputs['Color'], ramp.inputs['Fac'])
    colour_a = next(s for s in multiply.inputs if s.identifier == 'A_Color')
    colour_b = next(s for s in multiply.inputs if s.identifier == 'B_Color')
    result = next(s for s in multiply.outputs if s.identifier == 'Result_Color')
    links.new(ramp.outputs['Color'], colour_a)
    if linked is not None:
        links.new(linked, colour_b)
    else:
        colour_b.default_value = constant
    links.new(result, emission.inputs['Color'])
    links.new(emission.outputs['Emission'], output.inputs['Surface'])
    return toon


def outline_material(cfg):
    mat = bpy.data.materials.new('SpriteOutline')
    mat.use_backface_culling = True
    nodes = node_tree_of(mat).nodes
    for node in list(nodes):
        if node.type != 'OUTPUT_MATERIAL':
            nodes.remove(node)
    emission = nodes.new('ShaderNodeEmission')
    emission.inputs['Color'].default_value = srgb_to_linear(cfg['toon']['outline_color'])
    mat.node_tree.links.new(emission.outputs['Emission'], nodes.get('Material Output').inputs['Surface'])
    return mat


def apply_look(cfg, meshes):
    """Returns the outline modifiers, which data passes switch off."""
    if cfg['look'] == 'realistic':
        return []
    if cfg['engine'] != 'eevee':
        raise SystemExit('the %s look needs engine eevee (Shader to RGB is EEVEE only)' % cfg['look'])
    copies = {}
    for obj in meshes:
        for slot in obj.material_slots:
            if slot.material not in copies:
                copies[slot.material] = toon_material(slot.material, cfg)
            slot.material = copies[slot.material]
        if not obj.material_slots:
            obj.data.materials.append(toon_material(None, cfg))
    style = cfg['toon']['outline']
    modifiers = []
    if style == 'hull':
        line = outline_material(cfg)
        thickness = cfg['toon']['outline_px'] / cfg['pixels_per_unit']  # in world units
        for obj in meshes:
            obj.data.materials.append(line)
            hull = obj.modifiers.new('SpriteOutline', 'SOLIDIFY')
            scale = sum(abs(v) for v in obj.matrix_world.to_scale()) / 3.0  # the modifier works in local units
            hull.thickness = thickness / max(scale, 1e-6)
            hull.offset = 1.0
            hull.use_flip_normals = True
            hull.use_rim = False
            hull.material_offset = len(obj.material_slots) - 1
            modifiers.append(hull)
    elif style == 'freestyle':
        render = bpy.context.scene.render
        render.use_freestyle = True
        render.line_thickness_mode = 'ABSOLUTE'
        render.line_thickness = cfg['toon']['outline_px']
        settings = bpy.context.view_layer.freestyle_settings
        for lineset in settings.linesets:
            lineset.show_render = False
        lineset = settings.linesets.new('SpriteOutline')
        lineset.select_silhouette = lineset.select_border = lineset.select_crease = True
        lineset.linestyle.color = srgb_to_linear(cfg['toon']['outline_color'])[:3]
    elif style != 'none':
        raise SystemExit('toon outline is hull, freestyle or none')
    return modifiers


def data_material(kind, near, far):
    """Override materials for the data passes, written as raw values: camera-
    space normals mapped to 0..1 (x right, y up, z toward the viewer: the
    green-up convention Godot's 2D lights use), or depth with near = 1.
    Blender's camera space has z pointing away from the viewer, so z is flipped."""
    mat = bpy.data.materials.new('SpritePass_' + kind)
    tree = node_tree_of(mat)
    nodes, links = tree.nodes, tree.links
    for node in list(nodes):
        if node.type != 'OUTPUT_MATERIAL':
            nodes.remove(node)
    emission = nodes.new('ShaderNodeEmission')
    if kind == 'normal':
        geometry = nodes.new('ShaderNodeNewGeometry')
        to_camera = nodes.new('ShaderNodeVectorTransform')
        to_camera.vector_type, to_camera.convert_from, to_camera.convert_to = 'NORMAL', 'WORLD', 'CAMERA'
        scale = nodes.new('ShaderNodeVectorMath')
        scale.operation = 'MULTIPLY_ADD'
        scale.inputs[1].default_value = (0.5, 0.5, -0.5)
        scale.inputs[2].default_value = (0.5, 0.5, 0.5)
        links.new(geometry.outputs['Normal'], to_camera.inputs['Vector'])
        links.new(to_camera.outputs['Vector'], scale.inputs[0])
        links.new(scale.outputs['Vector'], emission.inputs['Color'])
    else:
        camera_data = nodes.new('ShaderNodeCameraData')
        remap = nodes.new('ShaderNodeMapRange')
        remap.inputs['From Min'].default_value, remap.inputs['From Max'].default_value = near, far
        remap.inputs['To Min'].default_value, remap.inputs['To Max'].default_value = 1.0, 0.0
        links.new(camera_data.outputs['View Z Depth'], remap.inputs['Value'])
        links.new(remap.outputs['Result'], emission.inputs['Color'])
    links.new(emission.outputs['Emission'], nodes.get('Material Output').inputs['Surface'])
    return mat


def subject_radius(meshes, frames):
    """How far the subject reaches from its ground point over the frames it is rendered at."""
    scene = bpy.context.scene
    radius = 0.1
    for frame in frames:
        scene.frame_set(frame)
        depsgraph = bpy.context.evaluated_depsgraph_get()
        for obj in meshes:
            evaluated = obj.evaluated_get(depsgraph)
            for corner in evaluated.bound_box:
                radius = max(radius, (evaluated.matrix_world @ Vector(corner)).length)
    return radius


# ---------------------------------------------------------------- checks

def frame_check(path, alpha_floor=0.0, opacity=1.0):
    """Opaque bounds and whether anything touches the canvas edge (clipped).
    With `alpha_floor`, fainter pixels are cleared and the rest scaled by
    `opacity`, and the file is rewritten: a shadow catcher leaves faint
    sampling noise across the ground, and a full shadow should not be black."""
    image = bpy.data.images.load(str(path), check_existing=False)
    width, height = image.size
    pixels = np.empty(width * height * 4, np.float32)
    image.pixels.foreach_get(pixels)
    if alpha_floor > 0:
        rgba = pixels.reshape(-1, 4)
        rgba[rgba[:, 3] < alpha_floor] = 0.0
        rgba[:, 3] *= opacity
        image.pixels.foreach_set(pixels)
        image.save()
    bpy.data.images.remove(image)
    alpha = pixels.reshape(height, width, 4)[::-1, :, 3]  # rows from the top
    opaque = alpha > 0.02
    if not opaque.any():
        return {'empty': True}
    rows, cols = np.flatnonzero(opaque.any(axis=1)), np.flatnonzero(opaque.any(axis=0))
    edge = bool(opaque[0].any() or opaque[-1].any() or opaque[:, 0].any() or opaque[:, -1].any())
    return {'empty': False, 'bounds': [int(cols[0]), int(rows[0]), int(cols[-1]), int(rows[-1])], 'touches_edge': edge}


def projected_pivot(camera, cfg):
    """Where the world origin lands on the canvas, in pixels from the top-left."""
    from bpy_extras.object_utils import world_to_camera_view
    point = world_to_camera_view(bpy.context.scene, camera, Vector((0.0, 0.0, 0.0)))
    width, height = cfg['canvas']
    return [round(point.x * width, 3), round((1.0 - point.y) * height, 3)]


# ---------------------------------------------------------------- render

def main():
    args = parse_args()
    raw = dict(DEMO_CONFIG) if args.demo else {}
    if args.config:
        raw.update(json.loads(Path(args.config).read_text(encoding='utf-8')))
    elif not args.demo:
        raise SystemExit('give --config, or --demo for the test figure')
    cfg = sc.load(raw)
    clips = {k: v for k, v in cfg['clips'].items() if not args.only or k in args.only}
    if not clips:
        raise SystemExit('no clips match --only %s' % ' '.join(args.only))
    if args.demo:
        build_demo()
    out = Path(args.out).resolve()
    plan = {name: sc.clip_frames(name, clip) for name, clip in clips.items()}
    renders = len(cfg['passes']) * len(cfg['directions']) * sum(len(f) for f in plan.values())
    if args.dry_run:
        print('SPRITE_REPORT ' + json.dumps({'dry_run': True, 'renders': renders, 'frames': plan,
                                              'camera': sc.camera(cfg, CAMERA_DISTANCE)}))
        return
    started = time.time()
    objects = subject_objects(None if args.demo else cfg['subject'])
    meshes = [o for o in objects if o.type == 'MESH']
    pivot = make_pivot(objects)
    camera, geometry = make_camera(cfg)
    light_direction = make_light(cfg, geometry, cfg['use_scene_lights'])
    configure_output(cfg)
    radius = subject_radius(meshes, sorted({f for frames in plan.values() for f in frames}))
    outlines = apply_look(cfg, meshes)
    ground = None
    if 'shadow' in cfg['passes']:
        bpy.ops.mesh.primitive_plane_add(size=max(20.0, radius * 8.0), location=(0.0, 0.0, 0.0))
        ground = bpy.context.active_object
        ground.name = 'SpriteShadowCatcher'
        ground.is_shadow_catcher = True
        ground.hide_render = True
    scene = bpy.context.scene
    files = {name: {p: {d: [] for d in cfg['directions']} for p in cfg['passes']} for name in clips}
    warnings = []
    for pass_name in cfg['passes']:
        scene.view_layers[0].material_override = None
        for modifier in outlines:
            modifier.show_render = pass_name == 'color'
        scene.render.use_freestyle = pass_name == 'color' and cfg['toon']['outline'] == 'freestyle' \
            and cfg['look'] != 'realistic'
        if ground is not None:
            ground.hide_render = pass_name != 'shadow'
        # Only the sun's shadow is caught: ambient light occluded by the subject
        # would darken the ground softly out to the canvas edges.
        scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = \
            0.0 if pass_name == 'shadow' else cfg['light']['ambient']
        for obj in meshes:
            obj.visible_camera = pass_name != 'shadow'
        if pass_name == 'color':
            set_engine(cfg, cfg['engine'], 1 if cfg['look'] == 'pixel' else cfg['samples'], 'Standard')
        elif pass_name == 'shadow':
            set_engine(cfg, 'cycles', max(32, cfg['samples']), 'Standard')
        else:
            engine = 'cycles' if cfg['engine'] == 'cycles' else 'eevee'
            set_engine(cfg, engine, 1 if cfg['look'] == 'pixel' else 4, 'Raw')
            scene.view_layers[0].material_override = data_material(
                pass_name, CAMERA_DISTANCE - radius, CAMERA_DISTANCE + radius)
        for clip_name, frames in plan.items():
            for direction in cfg['directions']:
                pivot.rotation_euler = (0.0, 0.0, math.radians(sc.facing(cfg, direction)))
                folder = out / 'frames' / clip_name / direction
                folder.mkdir(parents=True, exist_ok=True)
                for index, frame in enumerate(frames):
                    scene.frame_set(frame)
                    target = folder / sc.frame_name(clip_name, direction, index, sc.PASS_SUFFIX[pass_name])
                    scene.render.filepath = str(target)
                    bpy.ops.render.render(write_still=True)
                    files[clip_name][pass_name][direction].append(target.relative_to(out).as_posix())
                    if pass_name in ('color', 'shadow'):
                        if pass_name == 'shadow':
                            check = frame_check(target, 6.0 / 255.0, float(cfg['shadow_opacity']))
                        else:
                            check = frame_check(target)
                        if check['empty'] and pass_name == 'color':
                            warnings.append('%s is empty' % target.name)
                        elif not check['empty'] and check['touches_edge']:
                            hint = ' or raise the light' if pass_name == 'shadow' else ''
                            warnings.append('%s touches the canvas edge: enlarge the canvas or lower '
                                            'pixels_per_unit%s' % (target.name, hint))
    manifest = {
        'blender': bpy.app.version_string, 'file': Path(bpy.data.filepath).name if bpy.data.filepath else
        ('demo figure' if args.demo else 'unsaved scene'),
        'rendered': time.strftime('%Y-%m-%dT%H:%M:%S'), 'seconds': round(time.time() - started, 1),
        'canvas': cfg['canvas'], 'pixels_per_unit': cfg['pixels_per_unit'], 'pivot': cfg['anchor'],
        'pivot_projected': projected_pivot(camera, cfg), 'camera': {k: v for k, v in geometry.items()
                                                                    if k not in ('location', 'rotation')},
        'engine': cfg['engine'], 'look': cfg['look'], 'light_direction': light_direction,
        'passes': cfg['passes'], 'suffixes': {p: sc.PASS_SUFFIX[p] for p in cfg['passes']},
        'directions': [{'name': d, 'turn_deg': sc.facing(cfg, d)} for d in cfg['directions']],
        'clips': {name: {'frames': frames, 'fps': clips[name].get('fps', scene.render.fps / clips[name].get('step', 1)),
                         'loop': bool(clips[name].get('loop', True)), 'events': sc.clip_events(name, clips[name]),
                         'files': files[name]} for name, frames in plan.items()},
        'renders': renders, 'warnings': warnings, 'config': cfg,
    }
    out.mkdir(parents=True, exist_ok=True)
    (out / 'sprites.json').write_text(json.dumps(manifest, indent=1) + '\n', encoding='utf-8')
    print('SPRITE_REPORT ' + json.dumps({'out': str(out), 'renders': renders, 'seconds': manifest['seconds'],
                                         'pivot': cfg['anchor'], 'pivot_projected': manifest['pivot_projected'],
                                         'warnings': warnings}))


if __name__ == '__main__':
    main()

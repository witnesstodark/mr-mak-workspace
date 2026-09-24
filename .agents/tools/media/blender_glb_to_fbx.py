#!/usr/bin/env python3
"""Convert a GLB mesh into a Unity-friendly FBX using Blender.

Run through Blender, not standalone:
    blender -b --python blender_glb_to_fbx.py -- --in a.glb --out a.fbx

Meshes only: lights, cameras and animation are dropped. Axis conversion is the
Blender FBX default for Unity (-Z forward, Y up).
"""
import argparse
import sys

import bpy


def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="src", required=True)
    parser.add_argument("--out", dest="dst", required=True)
    parser.add_argument("--scale", type=float, default=1.0)
    parser.add_argument("--no-textures", action="store_true")
    return parser.parse_args(argv)


def main():
    args = parse_args()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=args.src)

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        print("error: no mesh objects found in the GLB", file=sys.stderr)
        return 2

    if args.scale != 1.0:
        for obj in meshes:
            obj.scale = (obj.scale[0] * args.scale, obj.scale[1] * args.scale, obj.scale[2] * args.scale)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    kwargs = {
        "filepath": args.dst,
        "use_selection": False,
        "object_types": {"MESH"},
        "axis_forward": "-Z",
        "axis_up": "Y",
        "apply_scale_options": "FBX_SCALE_NONE",
        "mesh_smooth_type": "FACE",
        "use_mesh_modifiers": True,
        "path_mode": "COPY",
    }
    if not args.no_textures:
        kwargs["embed_textures"] = True

    bpy.ops.export_scene.fbx(**kwargs)

    verts = sum(len(o.data.vertices) for o in meshes)
    tris = sum(len(o.data.loop_triangles) if o.data.loop_triangles else 0 for o in meshes)
    print(f"mesh-stats meshes={len(meshes)} verts={verts} tris={tris}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

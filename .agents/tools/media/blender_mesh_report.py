#!/usr/bin/env python3
"""Relatorio de uma malha gerada, para validar antes de entrar em Assets/.

Conta vertices, triangulos, materiais e — o numero que importa — as ilhas
conectadas depois de soldar vertices duplicados. Uma malha fragmentada tem
dezenas de ilhas; uma peca unica tem uma.

Rodar via blender:
    blender -b --factory-startup --python blender_mesh_report.py -- --in a.fbx
"""
import argparse
import math
import sys

import bpy
import mathutils


def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="src", required=True)
    parser.add_argument("--render", dest="render", default="")
    parser.add_argument("--merge", type=float, default=0.0001)
    return parser.parse_args(argv)


def import_mesh(path):
    if path.lower().endswith((".glb", ".gltf")):
        bpy.ops.import_scene.gltf(filepath=path)
    else:
        bpy.ops.import_scene.fbx(filepath=path)


def main():
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    import_mesh(args.src)

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        print("relatorio: nenhuma malha encontrada")
        return 2

    verts = sum(len(o.data.vertices) for o in meshes)
    tris = sum(len(o.data.loop_triangles) if o.data.loop_triangles else 0 for o in meshes)
    materials = sum(len(o.data.materials) for o in meshes)

    mins = mathutils.Vector((1e9, 1e9, 1e9))
    maxs = mathutils.Vector((-1e9, -1e9, -1e9))
    for obj in meshes:
        for corner in obj.bound_box:
            world = obj.matrix_world @ mathutils.Vector(corner)
            mins = mathutils.Vector((min(mins[i], world[i]) for i in range(3)))
            maxs = mathutils.Vector((max(maxs[i], world[i]) for i in range(3)))
    dims = maxs - mins

    # Soldar vertices duplicados antes de contar: o export duplica vertices por
    # normais e UVs, o que infla o numero de ilhas num falso positivo.
    for obj in meshes:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.remove_doubles(threshold=args.merge)
        bpy.ops.object.mode_set(mode="OBJECT")

    welded_verts = sum(len(o.data.vertices) for o in meshes)

    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.mesh.separate(type="LOOSE")

    islands = sorted((len(o.data.vertices) for o in bpy.context.scene.objects if o.type == "MESH"), reverse=True)
    largest_share = (islands[0] / welded_verts * 100) if islands and welded_verts else 0

    print(f"relatorio: arquivo={args.src}")
    print(f"relatorio: malhas={len(meshes)} verts={verts} tris={tris} materiais={materials}")
    print(f"relatorio: verts_soldados={welded_verts} (era {verts})")
    print(f"relatorio: dimensoes={dims.x:.3f}x{dims.y:.3f}x{dims.z:.3f}")
    print(f"relatorio: ILHAS={len(islands)} maior={islands[0] if islands else 0} "
          f"({largest_share:.0f}% dos vertices) top5={islands[:5]}")
    if len(islands) > 3:
        print("relatorio: veredito=FRAGMENTADO (mais de 3 ilhas conectadas)")
    elif len(islands) == 1:
        print("relatorio: veredito=PECA UNICA")
    else:
        print("relatorio: veredito=QUASE (2 a 3 ilhas)")

    if args.render:
        center = (mins + maxs) / 2
        size = dims.length
        cam_data = bpy.data.cameras.new("cam")
        cam = bpy.data.objects.new("cam", cam_data)
        bpy.context.scene.collection.objects.link(cam)
        distance = size * 1.15
        cam.location = center + mathutils.Vector((distance, -distance, distance * 0.75))
        cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
        bpy.context.scene.camera = cam
        for name, energy, rot in (("key", 4.0, (55, 0, 35)), ("fill", 1.5, (60, 0, -140))):
            light_data = bpy.data.lights.new(name, "SUN")
            light_data.energy = energy
            light = bpy.data.objects.new(name, light_data)
            bpy.context.scene.collection.objects.link(light)
            light.rotation_euler = (math.radians(rot[0]), math.radians(rot[1]), math.radians(rot[2]))
        world = bpy.data.worlds.new("w")
        bpy.context.scene.world = world
        world.use_nodes = True
        world.node_tree.nodes["Background"].inputs[0].default_value = (0.06, 0.06, 0.09, 1)
        scene = bpy.context.scene
        try:
            scene.render.engine = "BLENDER_EEVEE_NEXT"
        except Exception:
            scene.render.engine = "BLENDER_EEVEE"
        scene.render.resolution_x = 700
        scene.render.resolution_y = 700
        scene.render.filepath = args.render
        bpy.ops.render.render(write_still=True)
        print(f"relatorio: render={args.render}")

    return 0


if __name__ == "__main__":
    sys.exit(main())

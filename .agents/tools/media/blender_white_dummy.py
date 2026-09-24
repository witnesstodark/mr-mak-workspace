"""Boneco branco andando: blockout humanoide com rig e walk cycle.

Gera um humanoide de 1,80 m a partir de primitivas, um armature com hierarquia
minima, skinning automatico e um walk cycle de 4 poses-chave espelhadas, e
exporta FBX com a animacao. Deterministico: rodar de novo produz o mesmo asset.

Uso:
    blender -b --factory-startup --python white_dummy.py -- --out caminho.fbx
"""
import argparse
import math
import sys

import bpy

# ---------------------------------------------------------------- proporcoes
HEIGHT = 1.80
HIP_Z = 0.95
KNEE_Z = 0.50
ANKLE_Z = 0.08
CHEST_Z = 1.48
SHOULDER_X = 0.19
HIP_X = 0.09

FPS = 30
CYCLE_FRAMES = 28  # ~0.93 s por ciclo completo (dois passos)


def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--height", type=float, default=HEIGHT)
    return parser.parse_args(argv)


# ------------------------------------------------------------------- geometria
def build_body():
    parts = []

    def sphere(radius, location, name):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=location, segments=16, ring_count=8)
        obj = bpy.context.active_object
        obj.name = name
        parts.append(obj)

    def box(size, location, name):
        bpy.ops.mesh.primitive_cube_add(size=1, location=location)
        obj = bpy.context.active_object
        obj.name = name
        obj.scale = size
        bpy.ops.object.transform_apply(scale=True)
        parts.append(obj)

    def limb(radius, depth, location, name):
        bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, location=location, vertices=12)
        obj = bpy.context.active_object
        obj.name = name
        parts.append(obj)

    sphere(0.115, (0, 0, 1.665), "head")
    limb(0.048, 0.09, (0, 0, 1.555), "neck")
    box((0.30, 0.17, 0.32), (0, 0, 1.32), "chest")
    box((0.26, 0.16, 0.16), (0, 0, 1.10), "hips")

    for side, sx in (("L", 1), ("R", -1)):
        limb(0.052, 0.34, (sx * SHOULDER_X, 0, 1.31), f"arm_upper_{side}")
        limb(0.045, 0.30, (sx * SHOULDER_X, 0, 0.99), f"arm_lower_{side}")
        sphere(0.055, (sx * SHOULDER_X, 0, 0.82), f"hand_{side}")
        limb(0.072, 0.45, (sx * HIP_X, 0, 0.725), f"leg_upper_{side}")
        limb(0.060, 0.42, (sx * HIP_X, 0, 0.29), f"leg_lower_{side}")
        box((0.11, 0.26, 0.07), (sx * HIP_X, -0.05, 0.035), f"foot_{side}")

    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    body = bpy.context.active_object
    body.name = "WhiteDummy"

    material = bpy.data.materials.new("WhiteDummy")
    material.use_nodes = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
    bsdf.inputs["Roughness"].default_value = 0.8
    body.data.materials.append(material)
    return body


# ----------------------------------------------------------------------- rig
BONES = [
    # nome, head, tail, parent
    ("root", (0, 0, 0), (0, 0, 0.12), None),
    ("hips", (0, 0, HIP_Z), (0, 0, 1.12), "root"),
    ("spine", (0, 0, 1.12), (0, 0, 1.34), "hips"),
    ("chest", (0, 0, 1.34), (0, 0, 1.55), "spine"),
    ("head", (0, 0, 1.55), (0, 0, 1.78), "chest"),
]


def build_armature():
    armature_data = bpy.data.armatures.new("WhiteDummyRig")
    rig = bpy.data.objects.new("WhiteDummyRig", armature_data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")

    created = {}
    for name, head, tail, parent in BONES:
        bone = armature_data.edit_bones.new(name)
        bone.head = head
        bone.tail = tail
        created[name] = bone

    for side, sx in (("L", 1), ("R", -1)):
        created[f"shoulder.{side}"] = armature_data.edit_bones.new(f"shoulder.{side}")
        created[f"shoulder.{side}"].head = (sx * 0.05, 0, 1.46)
        created[f"shoulder.{side}"].tail = (sx * SHOULDER_X, 0, 1.48)
        created[f"shoulder.{side}"].parent = created["chest"]

        created[f"upper_arm.{side}"] = armature_data.edit_bones.new(f"upper_arm.{side}")
        created[f"upper_arm.{side}"].head = (sx * SHOULDER_X, 0, 1.48)
        created[f"upper_arm.{side}"].tail = (sx * SHOULDER_X, 0, 1.14)
        created[f"upper_arm.{side}"].parent = created[f"shoulder.{side}"]

        created[f"forearm.{side}"] = armature_data.edit_bones.new(f"forearm.{side}")
        created[f"forearm.{side}"].head = (sx * SHOULDER_X, 0, 1.14)
        created[f"forearm.{side}"].tail = (sx * SHOULDER_X, 0, 0.84)
        created[f"forearm.{side}"].parent = created[f"upper_arm.{side}"]

        created[f"thigh.{side}"] = armature_data.edit_bones.new(f"thigh.{side}")
        created[f"thigh.{side}"].head = (sx * HIP_X, 0, HIP_Z)
        created[f"thigh.{side}"].tail = (sx * HIP_X, 0, KNEE_Z)
        created[f"thigh.{side}"].parent = created["hips"]

        created[f"shin.{side}"] = armature_data.edit_bones.new(f"shin.{side}")
        created[f"shin.{side}"].head = (sx * HIP_X, 0, KNEE_Z)
        created[f"shin.{side}"].tail = (sx * HIP_X, 0, ANKLE_Z)
        created[f"shin.{side}"].parent = created[f"thigh.{side}"]

        created[f"foot.{side}"] = armature_data.edit_bones.new(f"foot.{side}")
        created[f"foot.{side}"].head = (sx * HIP_X, 0, ANKLE_Z)
        created[f"foot.{side}"].tail = (sx * HIP_X, -0.18, 0.03)
        created[f"foot.{side}"].parent = created[f"shin.{side}"]

    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def bind(body, rig):
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")


# ------------------------------------------------------------------ animacao
# Pose base de caminhada. Angulos em graus no eixo X local.
# contact = perna esquerda a frente; as outras poses derivam dela.
def walk_poses():
    def pose(thigh_l, shin_l, thigh_r, shin_r, arm_l, fore_l, arm_r, fore_r, spine=0):
        return {
            "thigh.L": (thigh_l, 0, 0), "shin.L": (shin_l, 0, 0),
            "thigh.R": (thigh_r, 0, 0), "shin.R": (shin_r, 0, 0),
            "upper_arm.L": (arm_l, 0, 0), "forearm.L": (fore_l, 0, 0),
            "upper_arm.R": (arm_r, 0, 0), "forearm.R": (fore_r, 0, 0),
            "spine": (spine, 0, 0),
        }

    return [
        # frame, pose                                   (contact: esquerda a frente)
        (0, pose(25, -5, -22, -18, -28, -18, 28, -22, 2)),
        (4, pose(10, -20, -12, -10, -14, -14, 14, -16, 3)),      # down
        (7, pose(-8, -28, 8, -6, 0, -12, 0, -12, 3)),            # passing
        (11, pose(-20, -14, 22, -4, 16, -16, -16, -14, 2)),      # up
        (14, pose(-22, -18, 25, -5, 28, -22, -28, -18, 2)),      # contact espelhado
        (18, pose(-12, -10, 10, -20, 14, -16, -14, -14, 3)),
        (21, pose(8, -6, -8, -28, 0, -12, 0, -12, 3)),
        (25, pose(22, -4, -20, -14, -16, -14, 16, -16, 2)),
        (28, pose(25, -5, -22, -18, -28, -18, 28, -22, 2)),      # fecha o ciclo
    ]


def animate(rig):
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    for bone in rig.pose.bones:
        bone.rotation_mode = "XYZ"

    for frame, pose in walk_poses():
        for bone_name, rotation in pose.items():
            bone = rig.pose.bones.get(bone_name)
            if bone is None:
                continue
            bone.rotation_euler = tuple(math.radians(value) for value in rotation)
            bone.keyframe_insert("rotation_euler", frame=frame)

    bpy.ops.object.mode_set(mode="OBJECT")
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start = 0
    scene.frame_end = CYCLE_FRAMES
    if rig.animation_data and rig.animation_data.action:
        rig.animation_data.action.name = "Walk"


def main():
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)

    body = build_body()
    rig = build_armature()
    bind(body, rig)
    animate(rig)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.fbx(
        filepath=args.out,
        use_selection=False,
        object_types={"MESH", "ARMATURE"},
        axis_forward="-Z",
        axis_up="Y",
        apply_scale_options="FBX_SCALE_NONE",
        mesh_smooth_type="FACE",
        path_mode="COPY",
        bake_anim=True,
        bake_anim_use_all_bones=True,
        bake_anim_force_startend_keying=True,
    )

    tris = sum(len(o.data.loop_triangles) if o.data.loop_triangles else 0
               for o in bpy.context.scene.objects if o.type == "MESH")
    dims = body.dimensions
    bones = len(rig.data.bones)
    stride = 0.70  # passo aproximado de um humanoide de 1,80 m
    speed = (2 * stride) / (CYCLE_FRAMES / FPS)
    print(f"dummy: malha tris={tris} dimensoes={dims.x:.2f}x{dims.y:.2f}x{dims.z:.2f}")
    print(f"dummy: ossos={bones} frames={CYCLE_FRAMES} fps={FPS} ciclo={CYCLE_FRAMES/FPS:.2f}s")
    print(f"dummy: velocidade_estimada={speed:.2f} m/s (passo {stride} m, 2 passos por ciclo)")
    print(f"dummy: exportado={args.out}")


if __name__ == "__main__":
    main()

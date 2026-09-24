#!/usr/bin/env python3
"""Convert a ComfyUI UI workflow (nodes/links) into API prompt format.

The UI format stores the graph the canvas edits; the /prompt API needs the
flattened form. ComfyUI's own converter lives in the browser frontend, so this
reproduces it from the node definitions the server exposes at /object_info.

Handled beyond plain scalars:
  - COMBO and legacy list options are widgets, not connections.
  - COMFY_DYNAMICCOMBO_V3 expands into extra inputs for the selected key.
  - COLOR and LOAD_3D are widgets.
  - The canvas injects a control value after generate-style integers.
  - Nodes with no server class (Note, MarkdownNote) and muted/bypassed nodes are
    dropped.

Usage:
    comfyui_workflow_to_api.py --workflow ui.json --out api.json [--url URL]
"""
import argparse
import json
import sys
import urllib.request

SCALAR_WIDGETS = {"INT", "FLOAT", "STRING", "BOOLEAN", "COMBO", "COLOR", "LOAD_3D"}
CONTROL_VALUES = {"fixed", "increment", "decrement", "randomize"}
SKIP_TYPES = {"Note", "MarkdownNote", "Reroute"}


def fetch_object_info(base):
    with urllib.request.urlopen(f"{base.rstrip('/')}/object_info", timeout=120) as resp:
        return json.loads(resp.read().decode())


def spec_options(spec):
    return spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}


def spec_kind(spec):
    kind = spec[0] if isinstance(spec, list) and spec else spec
    return "LIST" if isinstance(kind, list) else str(kind)


def is_widget(spec):
    if spec_options(spec).get("forceInput"):
        return False
    kind = spec_kind(spec)
    return kind == "LIST" or kind in SCALAR_WIDGETS or kind.startswith("COMFY_DYNAMICCOMBO")


def declared_inputs(info, class_type):
    entry = info.get(class_type)
    if entry is None:
        return None
    declared = entry.get("input", {})
    result = []
    for group in ("required", "optional"):
        for name, spec in declared.get(group, {}).items():
            result.append((name, spec))
    return result


def dynamic_expansion(parent, spec, value):
    """Extra widget inputs a COMFY_DYNAMICCOMBO_V3 adds for the selected key.

    ComfyUI prefixes nested inputs with the parent id, so a child of `sign_mode`
    is addressed as `sign_mode.qef` in the API prompt.
    """
    extra = []
    for option in spec_options(spec).get("options", []):
        if not isinstance(option, dict) or option.get("key") != value:
            continue
        groups = option.get("inputs") or {}
        for group in ("required", "optional"):
            for name, child in (groups.get(group) or {}).items():
                if is_widget(child):
                    extra.append((f"{parent}.{name}", child))
    return extra


def map_widgets(info, class_type, values):
    """Return (mapped_inputs, leftover_values, defaulted_names)."""
    queue = [(name, spec) for name, spec in (declared_inputs(info, class_type) or []) if is_widget(spec)]
    mapped = {}
    index = 0
    cursor = 0

    while cursor < len(queue) and index < len(values):
        name, spec = queue[cursor]
        cursor += 1
        value = values[index]
        index += 1
        mapped[name] = value

        extra = dynamic_expansion(name, spec, value)
        if extra:
            queue[cursor:cursor] = extra

        if index < len(values) and isinstance(values[index], str) and values[index] in CONTROL_VALUES:
            index += 1

    # A widget declared by the server but absent from the saved canvas (usually a
    # newer or advanced input) takes the server default instead of failing.
    defaulted = []
    for name, spec in queue[cursor:]:
        default = spec_options(spec).get("default")
        if default is not None:
            mapped[name] = default
            defaulted.append(name)

    return mapped, values[index:], defaulted


VALUE_CLASSES = {"PrimitiveBoolean", "PrimitiveInt", "PrimitiveFloat", "PrimitiveString"}


def resolve_literal(prompt, node_id, depth=0):
    """Follow primitive value nodes to a constant, if the chain is constant."""
    if depth > 8:
        return None
    node = prompt.get(str(node_id))
    if node is None or node["class_type"] not in VALUE_CLASSES:
        return None
    value = node["inputs"].get("value")
    if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str):
        return resolve_literal(prompt, value[0], depth + 1)
    return value


def unselected_inputs(prompt, node):
    if node["class_type"] not in ("ComfySwitchNode", "ComfySoftSwitchNode"):
        return set()
    value = node["inputs"].get("switch")
    if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str):
        value = resolve_literal(prompt, value[0])
    if value is True:
        return {"on_false"}
    if value is False:
        return {"on_true"}
    return set()


def prune(prompt, info):
    """Drop nodes the selected path cannot reach.

    Switch inputs are lazy, so an unselected branch never executes - but the
    server still validates it, which would demand both 3D backbones on disk.
    """
    roots = [nid for nid, node in prompt.items() if (info.get(node["class_type"]) or {}).get("output_node")]
    if not roots:
        return prompt, []

    keep = set()
    stack = list(roots)
    while stack:
        nid = stack.pop()
        if nid in keep:
            continue
        keep.add(nid)
        node = prompt[nid]
        skip = unselected_inputs(prompt, node)
        for name, value in node["inputs"].items():
            if name in skip:
                continue
            if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str):
                stack.append(value[0])

    dropped = sorted((nid for nid in prompt if nid not in keep), key=lambda item: int(item))

    result = {}
    for nid, node in prompt.items():
        if nid not in keep:
            continue
        skip = unselected_inputs(prompt, node)
        if skip:
            # The unselected input is optional; removing it also removes the
            # reference to the pruned branch.
            result[nid] = {
                "class_type": node["class_type"],
                "inputs": {name: value for name, value in node["inputs"].items() if name not in skip},
                "_meta": node.get("_meta", {}),
            }
        else:
            result[nid] = node
    return result, dropped


def convert(workflow, info):
    links = {link[0]: (link[1], link[2]) for link in workflow.get("links", [])}
    prompt = {}
    notes = []

    for node in workflow.get("nodes", []):
        class_type = node.get("type")
        if class_type in SKIP_TYPES or node.get("mode", 0) in (2, 4):
            continue
        if info.get(class_type) is None:
            notes.append(f"node {node.get('id')}: class '{class_type}' unknown to the server - skipped")
            continue

        inputs, leftover, defaulted = map_widgets(info, class_type, list(node.get("widgets_values") or []))
        if defaulted:
            notes.append(f"node {node.get('id')} ({class_type}): defaulted {defaulted}")
        if leftover:
            notes.append(f"node {node.get('id')} ({class_type}): ignored frontend-only value(s) {leftover!r}")

        for entry in node.get("inputs", []):
            link_id = entry.get("link")
            if link_id is None:
                continue
            origin = links.get(link_id)
            if origin is None:
                notes.append(f"node {node.get('id')}: dangling link {link_id} on '{entry.get('name')}'")
                continue
            inputs[entry["name"]] = [str(origin[0]), origin[1]]

        prompt[str(node["id"])] = {
            "class_type": class_type,
            "inputs": inputs,
            "_meta": {"title": node.get("title") or class_type},
        }

    prompt, dropped = prune(prompt, info)
    if dropped:
        notes.append(f"pruned {len(dropped)} node(s) on an unselected switch branch: {dropped}")

    return prompt, notes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workflow", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--url", default="http://127.0.0.1:8188")
    args = parser.parse_args()

    with open(args.workflow, "r", encoding="utf-8") as handle:
        workflow = json.load(handle)

    prompt, notes = convert(workflow, fetch_object_info(args.url))

    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(prompt, handle, indent=1)

    print(f"converted {len(prompt)} nodes -> {args.out}")
    for note in notes:
        print("  note: " + note)
    return 0


if __name__ == "__main__":
    sys.exit(main())

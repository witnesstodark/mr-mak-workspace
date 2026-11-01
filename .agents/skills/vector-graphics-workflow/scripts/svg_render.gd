# Rasterize an SVG with Godot's own ThorVG renderer, so the PNG matches what
# Godot's SVG import produces at the same scale.
#
# Usage (paths may be absolute or relative to the current directory):
#   godot --headless --script svg_render.gd -- IN.svg OUT.png [--scale S | --size WxH]
#
# --scale multiplies the SVG's intrinsic size (default 1). --size picks the
# largest uniform scale that fits WxH; the report gives the actual size.
# Prints one JSON line and exits 0, or exits 1 with an error message.
extends SceneTree


func _fail(message: String) -> void:
	printerr("svg_render: " + message)
	quit(1)


func _absolute(path: String) -> String:
	# Without --path, res:// is the current directory.
	if path.is_absolute_path():
		return path
	return ProjectSettings.globalize_path("res://").path_join(path)


func _init() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() < 2:
		_fail("usage: -- IN.svg OUT.png [--scale S | --size WxH]")
		return
	var source := _absolute(args[0])
	var target := _absolute(args[1])
	var scale := 1.0
	var size := Vector2i.ZERO
	var i := 2
	while i < args.size():
		if args[i] == "--scale" and i + 1 < args.size():
			scale = float(args[i + 1])
			i += 2
		elif args[i] == "--size" and i + 1 < args.size():
			var parts := args[i + 1].to_lower().split("x")
			if parts.size() != 2:
				_fail("--size expects WxH")
				return
			size = Vector2i(int(parts[0]), int(parts[1]))
			i += 2
		else:
			_fail("unknown argument " + args[i])
			return
	if source == target:
		_fail("refusing to overwrite the input")
		return
	var text := FileAccess.get_file_as_string(source)
	if text.is_empty():
		_fail("cannot read " + source)
		return
	var image := Image.new()
	if size != Vector2i.ZERO:
		var base := Image.new()
		if base.load_svg_from_string(text, 1.0) != OK:
			_fail("cannot parse " + source)
			return
		scale = minf(float(size.x) / base.get_width(), float(size.y) / base.get_height())
	if scale <= 0.0:
		_fail("scale must be positive")
		return
	if image.load_svg_from_string(text, scale) != OK:
		_fail("cannot parse " + source)
		return
	if image.save_png(target) != OK:
		_fail("cannot write " + target)
		return
	print(JSON.stringify({"command": "svg_render", "input": source, "output": target,
		"scale": scale, "size": [image.get_width(), image.get_height()]}))
	quit(0)

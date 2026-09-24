import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// Local media tooling. Every tool shells out to a script under the workspace
// root's .agents/tools/media/ (resolved from this file), which validates paths
// and arguments. Scripts run in the session's project directory, and
// MEDIA_PROJECT_ROOT points them at <project>/Assets/ and <project>/Artifacts/.
// No credentials, no network except the optional local ComfyUI at COMFYUI_URL.
//
// The object is a plain Promise plugin: `Plugin.define` is the identity
// function, so this keeps the plugin dependency-free (no @opencode/plugin).

const scriptsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  ".agents",
  "tools",
  "media",
)

type Args = Record<string, unknown>
type Tool = { script: string; python?: boolean }

function runScript(root: string, tool: Tool, argv: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const file = join(scriptsDir, tool.script)
    const env = { ...process.env, MEDIA_PROJECT_ROOT: root }
    const child = tool.python
      ? spawn("python3", [file, ...argv], { cwd: root, env, signal })
      : spawn(file, argv, { cwd: root, env, signal })
    let out = ""
    let err = ""
    child.stdout.on("data", (chunk) => (out += chunk))
    child.stderr.on("data", (chunk) => (err += chunk))
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) resolve(out.trim() || "ok")
      else reject(new Error(`${tool.script} exited ${code}${err.trim() ? `: ${err.trim()}` : ""}`))
    })
  })
}

function push(argv: string[], flag: string, value: unknown): void {
  if (value === undefined || value === null || value === "") return
  argv.push(flag, String(value))
}

function pushFlag(argv: string[], flag: string, enabled: unknown): void {
  if (enabled === true) argv.push(flag)
}

const stringSchema = { type: "string" } as const

const tools = [
  {
    name: "image_convert",
    description:
      "Resize, fit, convert format, trim transparent margins, or reduce colors of an image. Output must be inside Assets/, Artifacts/, or /tmp/opencode/.",
    input: {
      type: "object",
      properties: {
        input: { ...stringSchema, description: "Source image path" },
        output: { ...stringSchema, description: "Destination image path" },
        width: { type: "integer", description: "Target width in pixels" },
        height: { type: "integer", description: "Target height in pixels" },
        fit: { type: "string", enum: ["contain", "cover", "stretch"] },
        format: { type: "string", enum: ["png", "jpg", "webp"] },
        quality: { type: "integer", description: "Encode quality 1-100" },
        max_colors: { type: "integer", description: "Palette size, minimum 2" },
        trim_alpha: { type: "boolean", description: "Trim uniform transparent margins" },
      },
      required: ["input", "output"],
      additionalProperties: false,
    },
    build: (a: Args) => {
      const argv: string[] = []
      push(argv, "--in", a.input)
      push(argv, "--out", a.output)
      push(argv, "--width", a.width)
      push(argv, "--height", a.height)
      push(argv, "--fit", a.fit)
      push(argv, "--format", a.format)
      push(argv, "--quality", a.quality)
      push(argv, "--max-colors", a.max_colors)
      pushFlag(argv, "--trim-alpha", a.trim_alpha)
      return argv
    },
    script: "image-convert.sh",
  },
  {
    name: "image_edit",
    description:
      "Apply deterministic image effects in order: border, pad, shadow, outline, tint, saturate, grayscale, flip, flop. Each effect is a string such as border:4:#101018.",
    input: {
      type: "object",
      properties: {
        input: { ...stringSchema, description: "Source image path" },
        output: { ...stringSchema, description: "Destination image path" },
        effects: {
          type: "array",
          items: { type: "string" },
          description: "Effects applied in order, e.g. outline:3:#000000",
        },
      },
      required: ["input", "output", "effects"],
      additionalProperties: false,
    },
    build: (a: Args) => {
      const argv: string[] = []
      push(argv, "--in", a.input)
      push(argv, "--out", a.output)
      const effects = (a.effects as string[] | undefined) ?? []
      for (const effect of effects) argv.push("--effect", effect)
      return argv
    },
    script: "image-edit.sh",
  },
  {
    name: "image_generate",
    description:
      "Generate an image from a text prompt through the local ComfyUI backend. Requires ComfyUI running at COMFYUI_URL.",
    input: {
      type: "object",
      properties: {
        prompt: { ...stringSchema, description: "Positive prompt" },
        output: { ...stringSchema, description: "Destination PNG path" },
        negative: stringSchema,
        width: { type: "integer" },
        height: { type: "integer" },
        steps: { type: "integer" },
        cfg: { type: "number" },
        seed: { type: "integer", description: "Use -1 for a random seed" },
        checkpoint: { ...stringSchema, description: "Checkpoint name; auto-detected when omitted" },
        sampler: stringSchema,
        scheduler: stringSchema,
      },
      required: ["prompt", "output"],
      additionalProperties: false,
    },
    build: (a: Args) => {
      const argv: string[] = []
      push(argv, "--prompt", a.prompt)
      push(argv, "--out", a.output)
      push(argv, "--negative", a.negative)
      push(argv, "--width", a.width)
      push(argv, "--height", a.height)
      push(argv, "--steps", a.steps)
      push(argv, "--cfg", a.cfg)
      push(argv, "--seed", a.seed)
      push(argv, "--checkpoint", a.checkpoint)
      push(argv, "--sampler", a.sampler)
      push(argv, "--scheduler", a.scheduler)
      return argv
    },
    script: "comfyui_client.py",
    python: true,
  },
  {
    name: "audio_process",
    description:
      "Trim, normalize, gain, fade, loop, resample, and encode audio with FFmpeg. Output must be inside Assets/, Artifacts/, or /tmp/opencode/.",
    input: {
      type: "object",
      properties: {
        input: { ...stringSchema, description: "Source audio path" },
        output: { ...stringSchema, description: "Destination audio path" },
        start: { type: "number", description: "Start offset in seconds" },
        duration: { type: "number", description: "Segment length in seconds" },
        normalize: { type: "boolean", description: "Loudness-normalize to target LUFS" },
        target_lufs: { type: "number", description: "Integrated loudness target, default -16" },
        gain: { type: "number", description: "Gain in dB" },
        fade_in: { type: "number", description: "Fade-in seconds" },
        fade_out: { type: "number", description: "Fade-out seconds" },
        loop: { type: "integer", description: "Repeat count, minimum 1" },
        sample_rate: { type: "integer" },
        channels: { type: "integer" },
        format: { type: "string", enum: ["ogg", "wav", "mp3", "flac"] },
        quality: { type: "integer", description: "Vorbis/MP3 quality 1-10" },
      },
      required: ["input", "output"],
      additionalProperties: false,
    },
    build: (a: Args) => {
      const argv: string[] = []
      push(argv, "--in", a.input)
      push(argv, "--out", a.output)
      push(argv, "--start", a.start)
      push(argv, "--duration", a.duration)
      pushFlag(argv, "--normalize", a.normalize)
      push(argv, "--target-lufs", a.target_lufs)
      push(argv, "--gain", a.gain)
      push(argv, "--fade-in", a.fade_in)
      push(argv, "--fade-out", a.fade_out)
      push(argv, "--loop", a.loop)
      push(argv, "--sample-rate", a.sample_rate)
      push(argv, "--channels", a.channels)
      push(argv, "--format", a.format)
      push(argv, "--quality", a.quality)
      return argv
    },
    script: "audio-process.sh",
  },
  {
    name: "sound_generate",
    description:
      "Synthesize a short sound procedurally with SoX: tone, sweep, noise, impact, chime, or blip. Deterministic and offline.",
    input: {
      type: "object",
      properties: {
        output: { ...stringSchema, description: "Destination audio path" },
        type: { type: "string", enum: ["tone", "sweep", "noise", "impact", "chime", "blip"] },
        duration: { type: "number", description: "Length in seconds" },
        freq: { type: "number", description: "Base frequency in Hz" },
        freq2: { type: "number", description: "End frequency for a sweep" },
        waveform: { type: "string", enum: ["sine", "square", "sawtooth", "triangle"] },
        decay: { type: "number", description: "Decay time in seconds" },
        volume: { type: "number", description: "Volume 0-1" },
        noise: { type: "string", enum: ["white", "pink", "brown"] },
        lowpass: { type: "number", description: "Low-pass cutoff in Hz" },
        normalize: { type: "boolean" },
        sample_rate: { type: "integer" },
      },
      required: ["output", "type", "duration"],
      additionalProperties: false,
    },
    build: (a: Args) => {
      const argv: string[] = []
      push(argv, "--out", a.output)
      push(argv, "--type", a.type)
      push(argv, "--duration", a.duration)
      push(argv, "--freq", a.freq)
      push(argv, "--freq2", a.freq2)
      push(argv, "--waveform", a.waveform)
      push(argv, "--decay", a.decay)
      push(argv, "--volume", a.volume)
      push(argv, "--noise", a.noise)
      push(argv, "--lowpass", a.lowpass)
      pushFlag(argv, "--normalize", a.normalize)
      push(argv, "--sample-rate", a.sample_rate)
      return argv
    },
    script: "sound-generate.sh",
  },
] as const

export default {
  id: "ashenhold.media-tools",
  async setup(ctx) {
    const root = ctx.location.directory

    await ctx.tool.transform((editor) => {
      editor.namespace({ name: "media", description: "Ashenhold TD local media tools" })
      for (const tool of tools) {
        editor.add({
          name: tool.name,
          description: tool.description,
          input: tool.input as unknown as Record<string, unknown>,
          options: { namespace: "media", codemode: true },
          execute: async (input: unknown, context: { signal?: AbortSignal }) => {
            const argv = tool.build((input ?? {}) as Args)
            const content = await runScript(root, tool as Tool, argv, context?.signal)
            return { content }
          },
        })
      }
    })
  },
}

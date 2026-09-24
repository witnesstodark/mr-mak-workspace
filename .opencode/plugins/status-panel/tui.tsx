import { existsSync, readFileSync, readdirSync, readlinkSync, statSync } from "node:fs"
import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Plugin } from "@opencode/plugin/tui"

// The side panel carries what changes during a session: the task from the
// board, the usage of this conversation, the Docker services of the AI stack,
// and the state of the Unity editor. The footer carries the working branch,
// which the server half of this plugin (`index.ts`, same folder) keeps equal
// to the checkout.
//
// MCP health is deliberately absent: the terminal already shows the MCP
// servers in its own health row, and repeating it here only spends a line.

const GREEN = "#4FC08D"
const RED = "#E5484D"
const YELLOW = "#E6C34A"
const CYAN = "#4FC1D6"
const BLUE = "#5A8DEE"
const DIM = "#8A8A8A"

const PROJECT_ID = 86633647
const BOARD_STATES = ["In Development", "In Review", "Backlog", "Done"]

// The service list comes from the compose: a new service in
// `infra/docker/compose.yml` shows up here with no code change. The compose
// lives at the workspace root, next to this plugin, so the panel reads it from
// there regardless of the session's directory. The state comes from Docker,
// with `docker ps -a` on both engines and matched by the compose service label
// — asking both means the panel never has to decide how a service reaches
// Docker Desktop, which a Compose file cannot say.
const COMPOSE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "infra",
  "docker",
  "compose.yml",
)
const ENGINE_CONTEXTS = ["default", "desktop-linux"]
const PS_FORMAT = [
  '{{.Label "com.docker.compose.project"}}',
  '{{.Label "com.docker.compose.service"}}',
  "{{.State}}",
  '{{.Label "com.gitlab.gitlab-runner.type"}}',
  "{{.Names}}",
].join("|")
const run = promisify(execFile)

// Which compose service is the CI runner. The compose does not say it and nothing else in
// the files does either, so it is declared here instead of guessed at render time.
const RUNNER_SERVICE = "gitlab-runner"

// A job of this pipeline lasts 5–7 seconds, measured in the runner's own log, so a poll can
// never see it: the panel listens to Docker's event stream instead and counts the job
// containers as they start and die. The periodic `docker ps` still runs and corrects any
// drift, so a missed event cannot leave the count wrong forever.
const EVENTS_FORMAT = "{{.Action}}|{{.Actor.Attributes.name}}"

function watchJobEvents(context, onJob) {
  const child = spawn(
    "docker",
    ["--context", context, "events", "--filter", "type=container", "--format", EVENTS_FORMAT],
    { stdio: ["ignore", "pipe", "ignore"] },
  )

  let buffer = ""
  child.stdout.on("data", (chunk) => {
    buffer += chunk
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      const [action, name] = line.split("|")
      // Only job containers: they carry the runner's naming, which the runner's log
      // confirms (`runner-ds3qwpyng-project-…-build`). `die` fires once; `destroy` would
      // double-count it.
      if (!name || !/^runner-/.test(name)) continue
      if (action === "start") onJob(1)
      else if (action === "die") onJob(-1)
    }
  })
  child.on("error", () => undefined)

  return () => child.kill()
}

function readCompose(path) {
  const services = []
  let project = ""
  let section = null
  let compose = ""
  try {
    compose = readFileSync(path, "utf8")
  } catch {
    return { project, services }
  }

  for (const line of compose.split("\n")) {
    const named = /^name:\s*(\S+)\s*$/.exec(line)
    if (named) project = named[1]
    const top = /^([a-z]+):\s*$/.exec(line)
    if (top) {
      section = top[1]
      continue
    }
    if (section !== "services") continue
    const service = /^  ([a-z0-9][a-z0-9-]*):\s*$/.exec(line)
    if (service) services.push({ name: service[1] })
  }

  return { project, services }
}

async function readDocker(project) {
  const states = {}
  let jobs = 0
  for (const context of ENGINE_CONTEXTS) {
    try {
      const { stdout } = await run("docker", ["--context", context, "ps", "-a", "--format", PS_FORMAT], {
        timeout: 4000,
      })
      for (const line of String(stdout).split("\n")) {
        const [owner, service, state, kind, name] = line.split("|")
        if (!state) continue

        // A job container is not a compose service: it has no project and no service label,
        // only GitLab's own. Counting the running ones is how the panel knows the runner is
        // working on something. The type value is `build`, not `job` — that mistake is worth
        // remembering, because the wrong string fails silently.
        // Two independent signals, so a wrong label string cannot zero the count in
        // silence: GitLab's own label, or the name convention of a job container.
        if (kind === "build" || /^runner-/.test(name ?? "")) {
          if (state.trim() === "running") jobs++
          continue
        }

        if (!service) continue
        // Other compose projects keep containers under the same service names — this machine
        // has two `gitlab-runner` and two `postgres` — so the project label is what tells
        // ours apart, never the service name.
        if (project && owner !== project) continue
        // Several containers of one service: a running one wins over a stopped one.
        if (states[service] === "running") continue
        states[service] = state.trim()
      }
    } catch {
      /* this engine is down, or docker is not on the PATH: the other one still answers */
    }
  }
  return { states, jobs }
}

function usageOf(messages) {
  let tokens = 0
  let cost = 0
  for (const message of messages) {
    if (message?.type !== "assistant") continue
    const used = message.tokens
    if (used) tokens += (used.input ?? 0) + (used.output ?? 0) + (used.reasoning ?? 0)
    if (typeof message.cost === "number") cost += message.cost
  }
  return { tokens, cost }
}

const compact = (value) => (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value))
const short = (text, limit) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text)

// Who holds the Unity project, read from procfs. The executable decides whether a process
// is Unity — matching the command line would also match the shell commands that mention
// Unity, which is exactly the false positive this avoids. The flags then say what the run
// is: `-runTests` is a test, `-executeMethod …Build` is a build, and the import worker
// carries `-batchMode` without being either.
function unityProcesses() {
  let count = 0
  let test = false
  let build = false
  let platform = ""
  let startedAt = 0
  try {
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue
      try {
        const exe = readlinkSync(`/proc/${entry}/exe`)
        // The editor binary, however it was launched: a direct run is `Editor/Unity`, and
        // Unity Hub launches the same binary as `Editor/unityhub-unity-editor-<version>`.
        // Everything else under the installation (`Data/DotNetSdk/dotnet`, the shader
        // compiler, the licensing client) lives longer than the editor and is not it.
        if (!/\/Editor\/(Unity|unityhub-unity-editor[^/]*)$/.test(exe)) continue
        count++
        // The arguments are NUL-separated, not space-separated: normalising keeps the
        // `-name AssetImportWorker` test from failing on the separator.
        const cmd = readFileSync(`/proc/${entry}/cmdline`, "utf8").replace(/\0/g, " ")
        // A test or a build, never the import worker: Unity spawns that one with
        // `-batchMode` too, so the flags have to be the specific ones. A build is told
        // apart from a test by the method it runs — the CI builds through
        // `-executeMethod …ProjectBuild.BuildLinux`.
        const isTest =
          /-runTests/.test(cmd) ||
          (/-batchmode/i.test(cmd) && !/-name\s*AssetImportWorker/i.test(cmd))
        const isBuild = /-executeMethod/.test(cmd) && /\.Build(\w+)/.test(cmd)
        if (isTest) test = true
        if (isBuild) {
          build = true
          const named = /\.Build(\w+)/.exec(cmd)
          if (named && named[1] !== "All") platform = named[1]
        }
        // The process directory's mtime is its start, verified against `ps -o lstart`.
        // The earliest job is the one that has been running longest, and that is the number
        // worth showing.
        if (isTest || isBuild) {
          try {
            const started = statSync(`/proc/${entry}`).mtimeMs
            if (startedAt === 0 || started < startedAt) startedAt = started
          } catch {
            /* the process ended while we looked */
          }
        }
      } catch {
        /* another user's process, or it ended while we looked */
      }
    }
  } catch {
    /* no procfs: the caller falls back to the lock file alone */
  }
  return { count, test, build, platform, startedAt }
}

// Available: nothing holds the project. Editing: the editor holds it. Testing: a batch run
// does. Locked: the lock stayed behind without an owner — a lock file nobody holds, or a
// process with no lock — so the project is blocked with nobody working in it, and the
// state asks for a human to look. `Down` is deliberately not used here: the Docker group
// above already speaks Up/Down, and a second Down would read as "Unity crashed".
function unityState(lockFileExists) {
  const { count, test, build, platform, startedAt } = unityProcesses()
  if (count === 0) return { state: lockFileExists ? "locked" : "available", platform: "", elapsed: "" }

  // Both can run at once — the host runner has two slots — and the build is the one that
  // produces an artifact, so it wins the label when they overlap.
  const state = build ? "building" : test ? "testing" : lockFileExists ? "editing" : "locked"
  const elapsed = (() => {
    if (startedAt === 0 || !(build || test)) return ""
    const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000))
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
  })()
  return { state, platform: build ? platform : "", elapsed }
}

const UNITY_STATE = {
  available: { label: "Available", color: GREEN },
  editing: { label: "Editing", color: CYAN },
  building: { label: "Building", color: BLUE },
  testing: { label: "Testing", color: YELLOW },
  locked: { label: "Locked", color: RED },
}

export default Plugin.define({
  id: "workspace.status-panel.tui",
  setup(context) {
    // `context.location` is optional in the TUI context: without a fallback the first read
    // throws, `setup` aborts, and no slot mounts at all — the whole panel disappears rather
    // than one row. The default location is the same checkout this plugin was loaded from.
    const location = context.location ?? context.data.location.default()

    // The service list is read once, when the plugin loads: the compose changes with a
    // merge, and a plugin reload follows it. Probing is what repeats.
    const panelCompose = readCompose(COMPOSE_PATH)

    // The key changes with the shape of the state on purpose: the memory store outlives a
    // plugin reload, and a value from an older shape would render as-is forever.
    const [status, setStatus] = context.storage.memory("panel6", {
      initial: { task: "", services: [], jobs: 0, unity: { state: "available", platform: "", elapsed: "" }, branch: "", open: {} },
    })

    // Three cadences, because the three costs are different: the Unity state is a file test
    // and a walk over /proc (3 ms measured on this machine), the service checks are three
    // local fetches, and the board is the only call that leaves the machine.
    const refreshUnity = () => {
      setStatus((draft) => {
        draft.unity = unityState(existsSync(`${location.directory}/Temp/UnityLockfile`))
        draft.branch = context.data.location.vcs.info(location)?.branch.current ?? ""
      })
    }

    const refreshServices = async () => {
      const { states, jobs } = await readDocker(panelCompose.project)

      setStatus((draft) => {
        draft.jobs = jobs
        draft.services = panelCompose.services.map((service) => {
          const state = states[service.name]
          return {
            name: service.name,
            state: state === undefined ? "absent" : state === "running" ? "up" : "down",
          }
        })
      })
    }

    const refreshBoard = async () => {
      // The checkout names the task: branch `147-…` is issue #147.
      const iid = /^(\d+)/.exec(status.branch)?.[1]
      const token = process.env.GITLAB_TOKEN
      if (!iid || !token) return
      try {
        const response = await fetch(`https://gitlab.com/api/v4/projects/${PROJECT_ID}/issues/${iid}`, {
          headers: { "PRIVATE-TOKEN": token },
          signal: AbortSignal.timeout(8000),
        })
        if (!response.ok) return
        const issue = await response.json()
        const state = (issue.labels ?? []).find((label) => BOARD_STATES.includes(label)) ?? issue.state
        const title = String(issue.title ?? "").replace(/^\[[^\]]+\]\s*/, "")
        setStatus((draft) => {
          draft.task = `#${issue.iid} ${short(title, 34)} · ${state}`
        })
      } catch {
        /* the board is a convenience: a failed read changes nothing on screen */
      }
    }

    // Unity and the branch every second: a file test and a walk over /proc, 3 ms measured on
    // this machine, so a second is 0.3% of a core and no visible hitch. The two that cost
    // more are deliberately slower — the services are two `docker ps` (15 s) and the board is
    // the one call that leaves the machine (30 s). Subprocesses are what a short cadence
    // cannot afford, not file reads.
    refreshUnity()

    const unityTimer = setInterval(refreshUnity, 1000)
    const servicesTimer = setInterval(() => {
      void refreshServices().catch((error) => {
        // The panel is a convenience; a failed refresh must not take the footer with it,
        // but it belongs in the log instead of dying silent.
        console.error("[status-panel] service refresh failed", error)
      })
    }, 15000)
    const boardTimer = setInterval(() => void refreshBoard().catch(() => undefined), 30000)

    void refreshServices().catch(() => undefined)
    void refreshBoard().catch(() => undefined)

    // Expanded is the default, so a fresh session opens with the group already showing.
    // The choice is kept per session: the memory store lives in the TUI process, and a
    // single flag would leak one session's collapse into the next.
    const toggleDocker = (sessionID) =>
      setStatus((draft) => {
        draft.open[sessionID] = !(draft.open[sessionID] ?? true)
      })

    context.ui.slot({
      append: "prompt.footer.status",
      render: ({ sessionID }) => {
        // The branch comes from the checkout, which the panel already reads once a second; the
        // session title is renamed only on the next model request, so reading it here left the
        // footer showing the branch the session started on until the user sent something.
        const branch = status.branch || (context.data.session.get(sessionID)?.title ?? "")
        return <text fg={context.theme.text.base}>{branch}</text>
      },
    })

    const row = (label, value, color) => (
      <text fg={color ?? DIM}>{`${label.padEnd(13)} ${value}`}</text>
    )

    // The task and the usage sit above the panel's own content, so they read before the
    // branch name; the environment block stays below it, with the group it belongs to.
    context.ui.slot({
      prepend: "sidebar.content",
      render: ({ sessionID }) => {
        const { tokens, cost } = usageOf(context.data.session.message.list(sessionID) ?? [])
        return (
          <box flexDirection="column">
            {row("tarefa", status.task || "—")}
            {row("sessão", `${compact(tokens)} tok · $${cost.toFixed(3)}`)}
          </box>
        )
      },
    })

    context.ui.slot({
      append: "sidebar.content",
      render: ({ sessionID }) => {
        // The group header names every state that is present, so `(1 Up • 2 Down)` says what
        // is wrong without opening it; one state alone stays short. Each count carries its
        // own colour, which means the header is a row of runs rather than one text.
        const expanded = status.open[sessionID] ?? true
        // `Building · Linux · 1:24`, `Testing · 0:37`, `Available` — the platform only exists
        // for a build and the clock only while something is running.
        const unityLabel = () => {
          const unity = status.unity ?? {}
          return [UNITY_STATE[unity.state]?.label ?? String(unity.state ?? ""), unity.platform, unity.elapsed]
            .filter(Boolean)
            .join(" · ")
        }
        const services = status.services
        const upCount = services.filter((service) => service.state === "up").length
        const downCount = services.filter((service) => service.state === "down").length
        const counts = []
        if (upCount > 0) counts.push({ label: `${upCount} Up`, color: GREEN })
        if (downCount > 0) counts.push({ label: `${downCount} Down`, color: RED })

        // A job lasts five seconds, so `Up` in green would barely register: while the runner
        // has jobs, its own state is `Running` with the count, and the colour says so.
        const busyRunner = (service) => service.name === RUNNER_SERVICE && status.jobs > 0

        const SERVICE_STATE = {
          up: { label: "Up", color: GREEN },
          down: { label: "Down", color: RED },
          absent: { label: "—", color: DIM },
        }

        const header = [
          <text fg={context.theme.text.base} bold>
            {`${expanded ? "▼" : "▶"} Docker`}
          </text>,
        ]
        counts.forEach((count, index) => {
          header.push(
            <text fg={context.theme.text.base} bold>
              {index === 0 ? " (" : " • "}
            </text>,
          )
          header.push(
            <text fg={count.color} bold>
              {count.label}
            </text>,
          )
        })
        if (counts.length > 0) {
          header.push(
            <text fg={context.theme.text.base} bold>
              {")"}
            </text>,
          )
        }

        return (
          <box flexDirection="column">
            <box flexDirection="row" onMouseDown={() => toggleDocker(sessionID)}>
              {header}
            </box>
            {expanded &&
              services.map((service) => (
                <box flexDirection="row" justifyContent="space-between" width="100%">
                  <box flexDirection="row">
                    <text fg={SERVICE_STATE[service.state].color}>•</text>
                    <text fg={context.theme.text.base}>{` ${service.name}`}</text>
                  </box>
                  <text fg={busyRunner(service) ? YELLOW : SERVICE_STATE[service.state].color}>
                    {busyRunner(service)
                      ? `Running · ${status.jobs} job${status.jobs > 1 ? "s" : ""}`
                      : SERVICE_STATE[service.state].label}
                  </text>
                </box>
              ))}
            <text>{" "}</text>
            <box flexDirection="row" justifyContent="space-between" width="100%">
              <text fg={DIM}>Unity Editor</text>
              <text fg={UNITY_STATE[status.unity?.state]?.color ?? DIM}>{unityLabel()}</text>
            </box>
          </box>
        )
      },
    })

    // The event streams turn a 5-second job into something the panel can see. The periodic
    // `docker ps` keeps the count honest if an event is missed — a stream that dies with the
    // daemon, for instance.
    const onJob = (delta) =>
      setStatus((draft) => {
        draft.jobs = Math.max(0, draft.jobs + delta)
      })
    const stopWatchers = ENGINE_CONTEXTS.map((context) => watchJobEvents(context, onJob))

    return () => {
      clearInterval(unityTimer)
      clearInterval(servicesTimer)
      clearInterval(boardTimer)
      for (const stop of stopWatchers) stop()
    }
  },
})

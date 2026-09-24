import { readFileSync } from "node:fs"

// Session title = the working checkout's branch: the terminal window title
// answers "where am I" with `fix-pipeline-fast-forward-merge` and nothing
// else. Read from `.git/HEAD` on every model request, renamed only when the
// branch actually changes. A worktree keeps its HEAD in the directory its
// `.git` file points at.
//
// The side panel (board task, usage, Docker services, Unity state) lives in
// `tui.tsx` in this same folder.
//
// Plain Promise plugin: `Plugin.define` is the identity function, so this keeps
// the plugin dependency-free (no @opencode/plugin).

export default {
  id: "workspace.status-panel",
  async setup(ctx) {
    const currentBranch = () => {
      const git = `${ctx.location.directory}/.git`
      const fromHead = (path) => {
        const match = /^ref:\s*refs\/heads\/(.+)$/.exec(readFileSync(path, "utf8").trim())
        return match ? match[1].trim() : ""
      }
      try {
        return fromHead(`${git}/HEAD`)
      } catch {
        try {
          const pointer = /^gitdir:\s*(.+)$/.exec(readFileSync(git, "utf8").trim())
          return pointer ? fromHead(`${pointer[1].trim()}/HEAD`) : ""
        } catch {
          return ""
        }
      }
    }

    let lastBranch

    await ctx.session.hook("context", async (event) => {
      try {
        const sessionID = event?.sessionID
        if (!sessionID) return

        const branch = currentBranch()
        if (!branch || branch === lastBranch) return
        lastBranch = branch
        await ctx.session.rename({ sessionID, title: branch })
      } catch (error) {
        console.error("[status-panel] session title failed", error)
      }
    })
  },
}

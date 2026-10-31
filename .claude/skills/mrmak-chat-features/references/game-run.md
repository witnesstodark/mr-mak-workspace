# Run game

The Game panel beside a chat starts a project's game with no agent turn. The
game belongs to a project folder, not to the chat: a chat runs the game of its
own folder unless the owner chose another project in the panel (kept per chat,
so chats that share the Workspace folder each run their own game). It reads
`.agents/game.json` in that project folder:

```json
{
  "command": "godot --path . res://scenes/main.tscn",
  "cwd": "game",
  "url": "http://localhost:5173"
}
```

| Field | Required | Rule |
| --- | --- | --- |
| `command` | Yes | One line, at most 2000 characters, run through the system shell (`cmd.exe` on Windows, `sh` elsewhere) from `cwd` |
| `cwd` | No | A folder relative to the project and inside it |
| `url` | No | A local `http://localhost`, `127.0.0.1` or `[::1]` address, previewed in the panel while the game runs |

Mr. Mak keeps only these fields and refuses a file with control characters, an
outside folder or a remote URL. The owner presses Run game and Stop game; Stop
ends the command's whole process tree.

## Setting it up

1. Find how this project starts its game from its own files: README, build
   scripts, `package.json` scripts, engine project files, existing launch
   configurations. Prefer the command the project already documents.
2. Choose a command that opens a playable game in its own window, or a dev
   server for a browser game with its `url`. It should not need an editor UI,
   a prompt or an interactive login.
3. Use paths the command can resolve from `cwd`. Use an absolute engine path
   only when the engine is not on `PATH`, and check that path exists.
4. Write `.agents/game.json` with 2-space indentation in the game's project
   folder: the one the setup request names. When the chat runs in the shared
   Workspace folder, never write the Workspace's own `.agents/game.json` for a
   game that lives elsewhere; every chat there would show it. Do not start the
   game.
5. Tell the owner the command and anything it needs first, such as a build.

When the start command changes later (new engine version, renamed scene, new
script), update the file in the same change.

## Starting points by engine

Check each against the project before using it.

| Project | Typical command |
| --- | --- |
| Web game with Vite or similar | `npm run dev -- --port 5173 --strictPort` plus `url` |
| Static HTML game | `npx --yes http-server -p 8080 -c-1 .` plus `url` |
| Godot 4 | `godot --path . ` plus the main scene when it is not the project's default |
| Unity | A built player (`Builds/Windows/<Game>.exe`); the Editor is not a game window |
| Unreal Engine | `"<engine>/Engine/Binaries/Win64/UnrealEditor.exe" "<project>.uproject" -game -windowed` |
| Minecraft mod (NeoForge, Fabric) | `gradlew.bat runClient` on Windows, `./gradlew runClient` elsewhere |
| Rust (Bevy, macroquad) | `cargo run --release` |
| Python (pygame) | `python main.py` with the project's virtual environment interpreter |
| Tauri or Electron | The project's own dev script, such as `npm run tauri dev` |

When the project has no runnable game yet, say so instead of writing a
placeholder command.

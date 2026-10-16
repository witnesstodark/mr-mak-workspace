#!/usr/bin/env bash
# macOS counterpart of "Start Mr. Mak.cmd": opens the app on this repository.
root="$(cd "$(dirname "$0")" && pwd)"
built="$root/src-tauri/target/release/bundle/macos/Mr. Mak Workspace.app"
for app in "/Applications/Mr. Mak Workspace.app" "$HOME/Applications/Mr. Mak Workspace.app" "$built"; do
  if [ -d "$app" ]; then
    stale=false
    # ditto and Finder keep modification times, so a newer build means the installed copy was not replaced.
    if [ "$app" != "$built" ] && [ "$built/Contents/MacOS/mrmak-workspace" -nt "$app/Contents/MacOS/mrmak-workspace" ]; then
      stale=true
      echo "The app built in this repository is newer than $app."
      echo "To use it, quit Mr. Mak, then drag the new app over the installed one in Finder (Replace), or run:"
      echo "  rm -rf \"$app\" && ditto \"$built\" \"$app\""
    fi
    open -a "$app" --args --repo "$root" || { read -r -p "Press Return to close." _; exit 1; }
    if [ "$stale" = true ]; then read -r -p "Press Return to close." _; exit 0; fi
    # Terminal keeps a finished .command window open ("[Process completed]") by default. Close only
    # this launcher's own single-tab window, and only once its shell has exited, so nothing is interrupted.
    if [ "${TERM_PROGRAM:-}" = Apple_Terminal ] && own_tty="$(tty 2>/dev/null)"; then
      osascript - "$own_tty" >/dev/null 2>&1 <<'EOF' &
on run argv
  tell application "Terminal"
    repeat 50 times
      delay 0.2
      repeat with w in windows
        if (count of tabs of w) is 1 and tty of tab 1 of w is item 1 of argv then
          if busy of tab 1 of w then exit repeat
          close w
          return
        end if
      end repeat
    end repeat
  end tell
end run
EOF
    fi
    exit 0
  fi
done
echo "Build the app first: ./setup.sh desktop  (see docs/getting-started.md)"
read -r -p "Press Return to close." _

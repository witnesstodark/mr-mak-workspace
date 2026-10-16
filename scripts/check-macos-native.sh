#!/bin/bash
# Native macOS checks for the running Mr. Mak Workspace app (menus, shortcuts,
# Dock reopen, global recall shortcut). It drives the real app through
# Accessibility and reads results from the accessibility tree; no screenshots.
#
# Needs: the app running, Accessibility permission for the calling terminal,
# and the screen to itself for ~30 s (keyboard shortcuts only reach the
# frontmost app). Every keystroke first checks that Mr. Mak is frontmost and is
# skipped otherwise, so it never types into another application.
#
#   ./scripts/check-macos-native.sh            # all checks
#   ./scripts/check-macos-native.sh --passive  # background-only checks (no focus)
set -u
APP="Mr. Mak Workspace"; PROC="mrmak-workspace"
pass=0; fail=0; skip=0
ok()   { echo "PASS  $1"; pass=$((pass+1)); }
bad()  { echo "FAIL  $1${2:+ — $2}"; fail=$((fail+1)); }
skp()  { echo "SKIP  $1${2:+ — $2}"; skip=$((skip+1)); }
as()   { osascript -e "tell application \"System Events\" to tell process \"$APP\"" -e "$1" -e 'end tell' 2>&1; }
front(){ osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'; }
windows(){ as 'get name of every window'; }
tabs() { as 'set out to ""
  set w to first window whose name ends with "— Chats"
  set es to entire contents of w
    repeat with e in es
    try
      if role of e is "AXRadioButton" then set out to out & (description of e) & "|" & (value of attribute "AXSelected" of e as text) & linefeed
    end try
  end repeat
  return out'; }
selected(){ tabs | awk -F'|' '$2=="true"{print $1}' | sed 's/ · .*//'; }
tabcount(){ tabs | grep -c '|'; }
# Activate Mr. Mak, raise a window, and send one key combo only if it is frontmost.
key() { # key <window-suffix> <keycode> <modifiers e.g. "command down, shift down">
  osascript -e "tell application \"$APP\" to activate" -e 'delay 0.5' \
    -e "tell application \"System Events\" to tell process \"$APP\" to perform action \"AXRaise\" of (first window whose name ends with \"$1\")" >/dev/null 2>&1
  sleep 0.3
  [ "$(front)" = "$PROC" ] || { echo "focus:$(front)"; return 1; }
  osascript -e "tell application \"System Events\" to key code $2 using {$3}"; sleep 0.8
}

pgrep -qf "MacOS/$PROC" || { echo "Start $APP first."; exit 2; }
echo "== passive checks (no focus needed)"
items=$(as 'set out to ""
  repeat with mi in menu items of menu 1 of menu bar item "Chats" of menu bar 1
    set out to out & (name of mi) & "=" & (value of attribute "AXMenuItemCmdChar" of mi) & ","
  end repeat
  return out')
[ "$items" = "Chat 1=1,Chat 2=2,Chat 3=3,Chat 4=4,Chat 5=5,Chat 6=6,Chat 7=7,Chat 8=8,Chat 9=9," ] && ok "Chats menu has Chat 1–9 on ⌘1–⌘9" || bad "Chats menu" "$items"
if [[ "$(windows)" != *Chats* ]]; then skp "chat tabs readable" "Chats window is closed (the interactive run reopens it)"
else [ -n "$(selected)" ] && ok "chat tabs readable ($(tabcount) open, selected: $(selected))" || bad "chat tabs readable"; fi
[ "${1:-}" = "--passive" ] && { echo "== $pass passed, $fail failed, $skip skipped"; exit $((fail>0)); }

echo "== interactive checks (Mr. Mak needs the screen for ~30 s)"
[[ "$(windows)" == *Chats* ]] || { open -a "$APP"; sleep 1.5; }
n=$(tabcount)
if [ "$n" -ge 2 ]; then
  first=$(tabs | sed -n 1p | sed 's/ · .*//'); second=$(tabs | sed -n 2p | sed 's/ · .*//')
  r=$(key "— Chats" 18 "command down") && [ "$(selected)" = "$first" ] && ok "⌘1 selects '$first'" || { [ -n "$r" ] && skp "⌘1" "$r" || bad "⌘1" "selected: $(selected)"; }
  r=$(key "— Chats" 19 "command down") && [ "$(selected)" = "$second" ] && ok "⌘2 selects '$second'" || { [ -n "$r" ] && skp "⌘2" "$r" || bad "⌘2" "selected: $(selected)"; }
  as 'click menu item "Chat 1" of menu 1 of menu bar item "Chats" of menu bar 1' >/dev/null; sleep 0.8
  [ "$(selected)" = "$first" ] && ok "menu Chats › Chat 1 selects '$first'" || bad "menu Chat 1" "selected: $(selected)"
else skp "⌘1–⌘9" "needs at least two open chats"; fi

# ⌘⇧W closes the selected chat: only ever close the checker's own test chats.
for name in "Quote test" "Drop test"; do
  tabs | grep -q "^$name ·" || continue
  idx=$(tabs | grep -n "^$name ·" | cut -d: -f1)
  as "click menu item \"Chat $idx\" of menu 1 of menu bar item \"Chats\" of menu bar 1" >/dev/null; sleep 0.8
  [ "$(selected)" = "$name" ] || { bad "select '$name' before ⌘⇧W" "selected: $(selected)"; continue; }
  before=$(tabcount)
  r=$(key "— Chats" 13 "command down, shift down") && [ "$(tabcount)" -eq $((before-1)) ] && ! tabs | grep -q "^$name ·" \
    && ok "⌘⇧W closes '$name'" || { [ -n "$r" ] && skp "⌘⇧W '$name'" "$r" || bad "⌘⇧W '$name'" "$(tabcount) tabs"; }
done

# Dock reopen: hide every window, then reopen the app like a Dock click.
for i in 1 2; do as 'click (first button of window 1 whose subrole is "AXCloseButton")' >/dev/null; sleep 0.5; done
[ -z "$(windows)" ] && ok "closing windows hides them (app keeps running)" || bad "close windows" "$(windows)"
open -a "$APP"; sleep 1.5
w=$(windows); [[ "$w" == *Chats* && "$w" == *Workspace* ]] && ok "Dock reopen restores both windows" || bad "Dock reopen" "$w"

# Global recall shortcut: enable, hide, press ⌃⌥⌘Space from Finder, restore the setting.
pref="$HOME/Library/Application Support/com.mrmak.workspace/windows-key.json"
was=$(cat "$pref" 2>/dev/null || echo false)
# The toggle lives in Workspace › Settings (rail checkbox "Toggle settings").
press() { as "set w to first window whose name ends with \"— Workspace\"
  set es to entire contents of w
  repeat with e in es
    try
      if role of e is \"AXCheckBox\" and ((description of e) & \" \" & (title of e)) contains \"$1\" and (\"${2:-}\" is \"\" or (value of e as text) is \"${2:-}\") then
        perform action \"AXPress\" of e
        return \"pressed\"
      end if
    end try
  end repeat
  return \"not found\""; }
toggle() { r=$(press "shows Mr. Mak"); [ "$r" = pressed ] && { echo pressed; return; }
  [ "$(press "Toggle settings" 0)" = pressed ] && opened_settings=1; sleep 0.8; press "shows Mr. Mak"; }
if [ "$was" != true ]; then t=$(toggle); sleep 0.8; fi
if [ "$(cat "$pref" 2>/dev/null)" = true ]; then
  for i in 1 2; do as 'click (first button of window 1 whose subrole is "AXCloseButton")' >/dev/null; sleep 0.5; done
  osascript -e 'tell application "Finder" to activate'; sleep 0.8
  if [ "$(front)" = Finder ]; then
    osascript -e 'tell application "System Events" to key code 49 using {control down, option down, command down}'; sleep 1.5
    w=$(windows); [[ "$w" == *Chats* && "$w" == *Workspace* && "$(front)" == "$PROC" ]] && ok "⌃⌥⌘Space recalls both windows from Finder" || bad "⌃⌥⌘Space" "front=$(front) windows=$w"
  else skp "⌃⌥⌘Space" "focus:$(front)"; open -a "$APP"; fi
  [ "$was" != true ] && { toggle >/dev/null; sleep 0.8; }
  [ "$(cat "$pref")" = "$was" ] && ok "recall shortcut setting restored ($was)" || bad "restore recall setting" "$(cat "$pref")"
  [ -n "${opened_settings:-}" ] && press "Toggle settings" 1 >/dev/null
else skp "⌃⌥⌘Space" "could not enable it (Settings toggle: ${t:-n/a}; open Workspace › Settings once)"; fi

echo "== $pass passed, $fail failed, $skip skipped"
exit $((fail>0))

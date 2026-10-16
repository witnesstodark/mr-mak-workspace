# Mobile access

Mobile access connects a phone to the agent chats running in Mr. Mak Desktop.
The computer keeps the CLI processes, their sign-ins and project files. The
phone can read conversations, dictate drafts, send messages and images, resume a saved chat,
start an installed agent, and read Workspace reports.

## First connection

1. Install [Tailscale](https://tailscale.com/download) on your computer and phone.
   Sign in to the same Tailscale account on both and keep them connected.
2. Open Mr. Mak **Chats** and select the **phone icon** in the top bar.
3. Choose **Enable & show QR code**. If Tailscale requests HTTPS permission,
   follow its [Serve setup](https://tailscale.com/docs/features/tailscale-serve)
   and try again. On Windows, Tailscale may require administrator permission
   to configure Serve. You do not need to run agent chats as administrator.
4. Open your phone camera or QR scanner and point it at the code on the computer
   screen. Tap the detected link to open your browser. Name the device and
   select **Request connection**.
5. Compare the six-digit confirmation code on both screens, then choose
   **Connect phone** in Chats. A QR code alone does not grant access.
6. After connecting, tap Install when the browser makes installation available, or open Phone settings for Install Mr. Mak. Not now dismisses the invitation for this browser session; the settings button remains available. You can also use your browser’s Install app or Add to Home Screen menu (Safari’s Share menu on iPhone). If the installed
   web app asks to connect again, enter the eight-digit connection code shown
   under a fresh desktop QR code and confirm it on the computer.

Every owner connects their own devices. Typed chat access needs no shared Mr. Mak
server, public domain or new model API key. Existing CLI account limits still apply.
The optional microphone button uses a separately billed transcription API.
Mr. Mak configures a private Tailscale Serve route on an available HTTPS port
between 8443 and 8446. It preserves existing routes and never enables Funnel.

## Using the phone

- **Active / History:** select a conversation. Pinned chats come first.
- **Conversation:** recent user and assistant messages from Codex or Claude's
  local history. Tool output stays in the terminal. The view is bounded to the
  recent transcript; native CLI history remains on the computer.
- **Terminal:** the real CLI screen for any supported agent, with scrolling,
  copy and buttons for Enter, Escape, all four arrows, Tab and Stop. Use left
  and right to change choices in CLI menus, including reasoning effort. Wide lines scroll
  sideways so opening a phone does not resize the desktop terminal.
- **Close chat:** use the cross in the chat header and confirm. This also
  closes its desktop tab and stops that CLI process. The conversation stays
  in **History**, where you can open it and choose **Resume chat**. Other chats
  keep running; your unsent phone draft is kept.
- **Send:** sends a complete prompt to the selected CLI. Enter in the phone's
  text field adds a line break; use Send to submit. Your keyboard's dictation
  works in the same field.
- **Microphone:** record a thought, tap Stop, then review the transcription in
  your draft. It does not send a message or start an agent task automatically.
- **Attach images:** uploads an image to the computer's `inbox/attachments`
  and inserts its path with the message. Other file types and a full remote
  file manager are not part of this version.
- **Results:** read active Workspace cards and their HTML or Markdown tabs.
  HTML previews are isolated and can read only their own report folder and
  the shared report styling. Desktop-only API calls, external embedded frames
  and reports outside the repository are not available in this viewer.

Selecting a tab, scrolling or opening a report on the phone does not select a
different tab on the desktop. Conversation contents and task activity are shared.
Reading a completed turn marks it seen across devices.

## Voice input

1. On the computer, complete the optional [local voice setup](#local-voice-setup-on-the-computer), or select your existing paid provider in Phone settings.
2. Open a chat on the phone and tap the microphone beside the attachment button.
   Allow microphone access. Use the private HTTPS page in Chrome or Safari.
3. Speak, then tap **Stop**. Each recording is limited to two minutes.
4. Review or edit the text, then press **Send** yourself.

Fresh installations default to free local Whisper on your computer, using CPU int8.
Updates retain your previous provider and model. The phone
uploads audio over the paired private connection; transcription runs offline on
the computer after setup. No transcription API key or credit is needed. The PC
must remain running and reachable. Temporary server audio is removed after each
attempt. Recordings that have not yet become text remain recoverable on the
recording device until transcribed or discarded.

### Local voice setup on the computer

Install Python 3.10-3.12 (3.12 recommended). From the repository folder on
Windows, use these commands:

```sh
python scripts/setup-local-voice.py dictation
python scripts/setup-local-voice.py read-aloud
```

On macOS, call Python 3.12 by its versioned name. The system `/usr/bin/python3`
is 3.9 and Homebrew's default `python3` is usually newer than 3.12. When either
runs the script, it switches to an installed Python 3.10-3.12 (Homebrew or
uv-managed) by itself, or stops with the install command. It also handles the
python.org installer's missing certificates. With [Homebrew](https://brew.sh)
(or the python.org 3.12 installer instead of the first line):

```sh
brew install python@3.12
python3.12 scripts/setup-local-voice.py dictation
python3.12 scripts/setup-local-voice.py read-aloud
```

On Linux, use any Python 3.10-3.12, for example `python3` or `python3.12`.

On a Mac with Apple Silicon, local dictation needs macOS 14 or later and Read
aloud needs macOS 13 or later; the script stops with this message on older versions.

Each command is optional. It creates a separate environment under `.cache`,
installs pinned Python packages and verifies the model files against SHA-256
checksums. Whisper's model download is about 486 MB; the reading model and
voices total about 142 MB, plus Python dependencies. Setup checks that the
model can load on your computer. It does not restart Mr. Mak. Refresh Phone
settings afterward and select your provider. Windows PowerShell wrappers
`setup-local-dictation.ps1` and `setup-local-read-aloud.ps1` call the same setup.
Nothing is downloaded automatically by opening the app.

Desktop chats offer a microphone in the chat toolbar. Transcription pastes
directly into the terminal input without pressing Enter. The Workspace's Mak composer
also supports dictation; its Send button remains a separate action. No hotkeys
are rebound. This feature is separate from conversational Talk to Mak.

Local transcription preserves the detected language; it does not translate.
Test names and mixed-language phrases on your own microphone before relying on
it. Optional `MRMAK_WHISPER_PYTHON` and `MRMAK_WHISPER_MODEL` point to an existing
Python executable and downloaded model directory.

To switch between Free and Paid, open the **phone icon at the top right**.
On desktop this opens **Phone settings**, combining pairing, devices and
speech-to-text. On mobile it opens the same provider choice alongside install
and disconnect controls. Desktop **Settings → Speech-to-text** also has it.
Choose **Local Whisper · Free**, **OpenAI · Paid**, **OpenRouter · Paid**, or **Off**.
The saved choice is shared by desktop and all paired phones, updates immediately,
and applies to the next transcription. An in-progress request finishes using
its existing provider. Missing setup or API keys are shown beside the choice;
keys are entered only in the computer's ignored `.env`.

Paid providers remain opt-in. There is no automatic fallback to a cloud provider:

```dotenv
MRMAK_TRANSCRIBE_PROVIDER=openrouter
MRMAK_TRANSCRIBE_MODEL=openai/gpt-4o-transcribe
```

For direct OpenAI, use `openai` and `gpt-4o-transcribe`. Set the provider to
`off` to disable this microphone feature. `OPENROUTER_KEY` and `OPENAI_KEY` are
also accepted as legacy key names. Reopen the mobile page after changing keys
or settings; the desktop reads them without a restart.

Stopped recordings are saved on the phone until transcription succeeds or you
choose **Discard recording**. If transcription fails, use **Transcribe
recording** to retry, or **Download audio** to keep a copy. Switching chats or
putting the page in the background stops the microphone and retains the
unfinished recording in its original chat. Clearing browser data removes local
drafts and recordings. If the browser cannot save audio, keep the page open and
download it before leaving.

Retries reuse a successful transcription for up to ten minutes while the desktop
service stays running and its bounded cache retains it. After a desktop restart
or cache expiry, retrying runs transcription again (billable only for an explicitly
selected cloud provider). Local transcription uses a temporary audio file on the
computer and deletes it after the attempt; pending recordings stay in the
recording device's browser storage.
Your phone keyboard's microphone remains an alternative without configuring
Mr. Mak's transcription service.

## Connections and delivery

Keep the computer awake, online and running Mr. Mak. Minimizing or hiding its
windows is fine. Quitting Mr. Mak or letting the computer sleep makes it
unavailable; closing the phone does not stop agents.

After a restart, open Mr. Mak on the computer and the same mobile shortcut on
the phone. The saved pairing is reused. Tailscale must be connected on both
devices; opening Mr. Mak restores its private route. If Tailscale was not ready
when Mr. Mak started, enable mobile access again from the phone panel in Chats.
Mr. Mak does not add itself to operating-system startup automatically.
On Android, use the system's Always-on VPN option for Tailscale if you want it
to start with the phone; some devices also need background autostart permission.
See [Android VPN settings](https://developer.android.com/develop/connectivity/vpn#always-on)
and [Tailscale on Windows](https://tailscale.com/docs/how-to/run-unattended).

Drafts stay on the phone per chat. After a lost connection, **Retry** checks the
same message ID. The computer keeps a delivery receipt before writing to the
terminal. **Delivered to terminal** confirms the terminal write, not that an
agent accepted or completed the task. If delivery is uncertain, inspect the
terminal before unlocking the draft for a new attempt. Unsynchronised terminal
keystrokes should be entered from one device at a time.

The phone button in Chats shows connected and paired devices. **Disconnect**
revokes a device and closes its connections. **Turn off mobile access** stops
the mobile surface without stopping agent chats; paired devices can reconnect
when it is enabled again. Pairing codes expire after five minutes. A device's
pairing expires after 180 days and can be renewed with a new QR code.

Mobile access is off by default. Device credentials are stored as hashes in
the ignored runtime state; the phone holds its own HttpOnly session cookie.
It never receives the desktop control token or model API keys. A paired phone
can ask agents to act with their existing permissions, so disconnect a lost
device from Chats or remove it from your Tailscale account.

## Developing and checking the mobile client

The mobile React entry is `src/mobile/`. The isolated service is
`desktop/service/mobile.mjs`, with separate Tailscale, transcript and report
adapters. It binds only to loopback. The desktop administrative API manages
pairing; the mobile API exposes selected chat actions and read-only reports.

Run `npm test` for pairing, origin checks, delivery recovery, report boundaries
and route ownership. After `npm run build`, run
`node desktop/service/test/mobile-ui.mjs` for two-client browser checks. These
tests use an isolated transport and stub CLI processes, without touching your
Tailscale setup or starting a model request. A real phone and Tailscale sign-in
are still required to verify the complete remote connection on your network.

Recent activity in mobile Conversation starts collapsed. Tap its heading to expand
or collapse the latest tool names and statuses. Automatic refresh keeps the current
choice; opening another chat starts collapsed.

Conversation displays PNG, JPEG, WebP, GIF and BMP images explicitly shared in
Claude/Codex messages, Markdown image links, and structured image tool results.
Tap an image to open a separate full-screen viewer. Pinch to zoom the image,
drag to pan, double-tap to zoom/reset, or use the zoom buttons. Close returns
to the same conversation. Download saves the image. Local images are served
through the paired connection with an expiring, device-and-chat-specific file
grant; missing or unsupported images show an unavailable notice. Image-only
messages are retained. External image URLs are not fetched, and terminal-only
pixels without a saved file or transcript image record cannot be recovered.

A speaker icon appears once at the end of the latest agent message, after its
media. Tap it to read; during playback it becomes Pause/Resume, with a Stop icon.
It reads your most recent message and all following agent messages through that
reply, with Pause, Resume and Stop controls. New replies do not extend speech
already playing; tap Read aloud again to include them.
Speech is generated locally on your computer with Kokoro ONNX. Phone settings
has exactly Michael (US man) and Emma (UK woman); the choice is saved on that
phone. Browser voice lists and other accents are not used. No API key or paid
speech provider is required. Run the read-aloud command from
[local voice setup](#local-voice-setup-on-the-computer) once on your computer
(`python3.12 scripts/setup-local-voice.py read-aloud` on macOS) to install an
isolated CPU environment and download the official model.
After setup, inference is offline; text/audio are not sent to a cloud provider.
The phone receives short WAV segments through its paired, authenticated session.
Audio and text are kept in memory and discarded after playback. Stop cancels
in-progress synthesis; disconnecting the phone revokes it. Code, tables and
images are skipped. Playback starts only after a tap and stops when changing
chats, opening Terminal or leaving Conversation.

Voice definitions: [Kokoro voice catalogue](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md).

Returning from phone sleep immediately replaces the stale connection without
reloading the app. The current view, selected chat, draft and scroll position stay
in place. Online and restored-page events use the same recovery; old bootstrap
replies are ignored, connection attempts have a deadline, and failed attempts
retry while the app is visible. The nose button reconnects in place as well.

Recorded local videos linked explicitly in Conversation (MP4, WebM, MOV or M4V)
appear as video cards. Tap to open a separate player with playback controls,
seeking and download. Video files stream with byte-range support and a 512 MB
limit, using the same paired-device/chat grants as images. Playback depends on
the phone supporting the recorded codec. External video URLs and arbitrary
paths printed in terminal tool logs are not fetched. Agents should share
recordings as a Markdown link to the saved file.

Mobile saves its selected chat, app section, History choice and each chat's
Conversation/Terminal mode on that phone. Reloading or reopening restores the
saved chat and mode; Conversation remembers whether you were following the
latest reply or reading history. Chats returns to the selected chat after
Workspace; Back to chats opens the list. Missing chats return to the list without
selecting a different agent. Drafts remain per-chat, and desktop selection stays
independent. Disconnect clears the saved mobile navigation state. Workspace independently remembers its selected card, each card's report tab,
and reading position. Switching sections keeps both views mounted. HTML readers
restore their saved route, window and nested scroll positions after reopening
through an origin-checked, scroll-only sandbox message bridge. Terminal mode
also remembers its scrollback line and fit setting. Use All workspaces to return
to the card list; tapping Workspace itself never closes the selected report.

Each mobile message to an agent includes a small reference to the selected
Workspace card and report tab. It includes the viewer page and section anchor
when the report bridge has reported them; older services supply only the report
entry page. These are viewer references, not filesystem paths. Report content is
not copied or read to build this note. The note says this is the current Workspace
where you are working and tells the agent to read, open or investigate it only
when your request asks for it. Clearing the Workspace selection sends a null
reference so an earlier card is no longer treated as current.

Delivery retries retain the original Workspace reference, even after switching
pages or reloading. The automatic note stays in the native agent transcript,
while mobile displays and reads aloud your original message. Shell input and
native slash commands are sent unchanged. Desktop messages remain independent.

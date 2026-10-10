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
6. Add the page to your Home Screen through your browser. If the installed
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

1. On the computer, add `OPENROUTER_API_KEY` or `OPENAI_API_KEY` to your
   repository's ignored `.env`. Existing configured keys can be reused.
2. Open a chat on the phone and tap the microphone beside the attachment button.
   Allow microphone access when your browser asks. Use the private HTTPS page
   in a browser that supports recording, such as current Chrome or Safari.
3. Speak, then tap **Stop**. Each recording is limited to two minutes.
4. Review or edit the text, then press **Send** yourself.

The computer submits the audio to the selected provider. API keys stay on the
computer. This is paid speech-to-text, separate from CLI subscriptions and the
desktop Talk to Mak coordinator. The standard model is GPT-4o Transcribe;
speech stays in its original language, including mixed-language dictation.

OpenRouter is selected when its key is configured; otherwise OpenAI is used.
There is no automatic provider switch after a failed request. Optional `.env`
settings let you choose explicitly:

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
or cache expiry, retrying may make another billable API call. Audio is not saved
as a file on the computer; pending audio stays in the phone's browser storage.
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

Results supports configured live Codex steps as well as conventional reports.
A card step with `source` opens the existing generated output for that ID in
the desktop service's local `live-sources.json`; it never grants the source
project or accepts an absolute path from the phone. A local guide tab can still
use the card folder. Unknown sources and escaping links are rejected, without
a fallback location. See [Live Codex sources](../desktop/README.md#live-codex-sources)
for configuration, dependency policy and output-root restrictions.

Live readers retain the mobile sandbox. Fonts and scripts need explicit
per-source `mobileResources` entries; ordinary reports keep their existing
policy. Embedded interactive previews remain blocked, while their full-page
links can open generated pages inside the selected report's grant.

After an owner-approved app update, keep Tailscale connected, close and reopen
the mobile page or Home Screen app, then reopen Results. The service worker
uses the network first for the shell and assets; it does not cache report pages
or API replies. Report grants expire after 30 minutes, so reopen a report if
its preview asks to refresh. Clearing site data is unnecessary and removes
pairing and local drafts.

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

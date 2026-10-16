# Local dictation

Dictation puts recognized text into the focused terminal or text field.
Mr. Mak's voice assistant instead carries on a conversation and can call tools.
You can use either, both or neither.

Mr. Mak now has built-in microphone dictation for desktop chats, the Mak composer,
and mobile. See [setup and behavior](../docs/mobile-access.md#voice-input).
Install free local faster-whisper and its multilingual small model once with
Python 3.10-3.12: `python scripts/setup-local-voice.py dictation` on Windows
(`scripts/setup-local-dictation.ps1` wraps the same command). On macOS, run
`brew install python@3.12`, then `python3.12 scripts/setup-local-voice.py dictation`;
the system and default Homebrew `python3` are usually outside the supported
range. On Linux, any 3.10-3.12 `python3` works. The PowerShell wrappers are
Windows-only. See [local voice setup](../docs/mobile-access.md#local-voice-setup-on-the-computer). Record, stop, review, then explicitly insert
or send. Choose Free/Paid/Off in Phone settings or desktop Settings → Speech-to-text.
The saved provider is shared across desktop and paired phones and overrides
the `.env` provider default. Paid keys stay in the computer’s ignored `.env`.

For optional dictation into other applications, [Wispr Local](https://github.com/nsoth/wispr-local) is one Windows option built
around whisper.cpp. Review its language and GPU build defaults before installing.
Follow its README to select English and settings appropriate for the recipient's
machine. The project also documents optional
cloud text formatting. This template includes setup instructions, not a bundled
copy of Wispr Local or another user's customized build. On macOS, the built-in
Dictation (System Settings > Keyboard > Dictation) types into other apps without
a separate install.

Use a separate folder for the dictation app. Start with the language you actually
speak and a model that fits your memory budget. Verify recognition in a text
editor before testing it in an agent terminal. A successful microphone recording
does not prove that text injection reached the intended window.

Choose a non-conflicting push-to-talk shortcut. Test silence, a short phrase,
technical names and several recordings in succession. Do not auto-submit text
while diagnosing dictation. Keep cloud formatting off for a fully local
transcription workflow; enabling it sends recognized text to that provider.

Record the chosen model, build settings and recovery steps in a local setup
note. Leave microphone recordings, transcripts and credentials out of a public
handoff. Always check upstream instructions again on the recipient's machine.

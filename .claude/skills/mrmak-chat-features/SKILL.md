---
name: mrmak-chat-features
description: Work with the Mr. Mak features a chat touches, starting with the Run game button and its .agents/game.json. Use when a message comes from one of them or a task changes their files.
---

# Mr. Mak chat features

Mr. Mak runs this chat in a terminal and reads its native transcript. Some of its
panels depend on files the agent keeps, and some messages are written by the app
rather than typed by the owner. This skill sits in the Mr. Mak repository; paths
below starting with `<mrmak>` are relative to it. Paths starting with `.agents/`
are in the chat's project folder.

## Run game

When asked to set up the Run game button, or when the way the project starts
changes, follow [game run](references/game-run.md). Write `.agents/game.json`
only; never start the game for this request. The owner confirms the command in
Mr. Mak before it first runs and again after every change to the file.

## Changing these features

These notes describe the installed app. To change a feature itself, read
`<mrmak>/desktop/README.md` and update this skill in the same change.

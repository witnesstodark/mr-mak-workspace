---
name: mrmak-chat-features
description: Work with the Mr. Mak features a chat touches - the plan panel, project and global rules, "remember:" notes, the Run game button (.agents/game.json), Workspace card assets sent from the Acervo, handoff files, file links the phone opens and the Game UI Studio Copilot. Use when a message comes from one of them or a task changes their files.
---

# Mr. Mak chat features

Mr. Mak runs this chat in a terminal and reads its native transcript. Some of its
panels depend on files the agent keeps, and some messages are written by the app
rather than typed by the owner. This skill sits in the Mr. Mak repository; paths
below starting with `<mrmak>` are relative to it. Paths starting with `.agents/`
are in the chat's project folder.

## Plan panel

Follow the plan instruction this chat started with: the file
`.agents/plans/<chat>.md`, or the `report_plan` tool when the chat has it.
Write the plan before the first edit of a multi-step task and update it when a
step starts or ends, not only at the end. Use `needs review` when the owner must
look at a result, `blocked` when only the owner can unblock the work, and `done`
when nothing remains. The panel marks the chat for the owner on those statuses,
so do not set them early. Start a new plan for a new request instead of appending
to the old one. Never commit plan files; the folder ignores itself.

## Rules

Read [rules](references/rules.md) before adding or changing a rule. In short:
`.agents/rules.md` holds the project's rules, `<mrmak>/.agents/global-rules.md`
holds rules for every chat, and a message starting with `remember:` or `lembre:`
is saved by Mr. Mak's band, not by the agent.

## Run game

When asked to set up the Run game button, or when the way the project starts
changes, follow [game run](references/game-run.md). Write `.agents/game.json`
only; never start the game for this request.

## Workspace card assets

A message starting with "Workspace card asset from" came from a card's Acervo.
Follow [card assets](references/card-assets.md).

## Game UI Studio

A chat named "UI Studio <project>", or a message carrying the studio's "Edit
protocol" and screen JSON, is the studio's Copilot. Read
`<mrmak>/.agents/skills/game-ui-studio/SKILL.md`: it covers `gameui-edit`
replies, importing the project's UI art and loading the game's screens.

## Handoffs

A request starting with the Mr. Mak handoff marker asks for a summary only: no
file changes and no commands. Reply in Markdown from a `# Handoff` heading with
the goal, current state, decisions and reasons, files touched, open problems and
exact next steps. A new chat that starts by naming a handoff file reads it,
checks the repository's current state against it (Git status, the files it
names, running processes), then states the next step and continues. The file
describes the past; trust the disk when they differ.

## Links in replies

Mr. Mak opens local links in a chat message: a Workspace report as its report,
and a page, Markdown file, image or video inside the chat's folder or the Mr. Mak
repository in a viewer, on the desktop and on the phone. Link deliverables as
Markdown links to their absolute path, such as `[Report](D:/work/game/docs/report.md)`
or a `file:///` URL; a relative link is read against the chat's folder. The phone
keeps files in dot folders or outside both places on the computer, so name those
as paths without expecting a preview.

## Long chats and the prompt cache

The owner may compact the chat (`/compact`) or move to a fresh chat from Mr. Mak.
Keep the plan file current so either one keeps the task's state. Do not run
`/compact` or slash commands on the owner's behalf.

## Changing these features

These notes describe the installed app. To change a feature itself, read
`<mrmak>/desktop/README.md` and `<mrmak>/knowledge/game-dev-features-decisions.md`,
and update this skill in the same change.

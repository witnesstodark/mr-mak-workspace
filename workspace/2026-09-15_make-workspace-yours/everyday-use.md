# Welcome to Mr. Mak Workspace

Work with your agents in Chats. Read, compare and keep their results in Workspace.
Your project folders connect the two. You can use the Workspace without reading
source code or moving every conversation into one agent's app.

## Start with one task

1. In Chats, press **+**, choose your agent and its working folder, and give the
   conversation a clear English name.
2. Describe the result you want. Drop reference files or folders into the chat
   when they help: "Compare these concepts and put the findings in a Workspace card."
3. Let the agent work. A glowing logo marks activity; an unread completion marker
   helps you find a result you have not reviewed.
4. Open the Workspace card, compare its tabs and images, then give your decision
   back to the chat: "Use version B. Keep its shape and change only the material."
5. Keep related revisions as tabs in the same card. Archive the card when you no
   longer need it in the active list. Archiving a card preserves its files.

## Two windows, one project

**Chats** contains real terminal sessions for your chosen CLI agents. **Workspace**
contains the cards, reports, previews and files they produce. You can minimize
either window independently while continuing in a browser, Blender or another app.

Drag chat tabs to reorder them. Pinned tabs stay ahead of ordinary tabs, and can
be reordered within their own group. Use History to find and pin conversations
you want to return to. Closing a tab and deleting a project's files are separate
actions. Conversation recovery also depends on the selected CLI's native history.

## Files and previews

**Files** shows the actual project folders. Main folders is a focused view;
All files shows the wider tree. Hover a folder to reveal its Explorer shortcut
(Finder on macOS, your file manager on Linux).
Select a file to preview it. Images can be enlarged and downloaded, and Markdown
opens with **Preview** and **Edit** modes. Save only when you want to change the file.

| Folder | What belongs here |
| --- | --- |
| `inbox/` | References, clipboard screenshots and incoming material |
| `projects/` | Ongoing project context and working specifications |
| `workspace/` | Cards, reports, previews and task deliverables |
| `knowledge/` | Lessons that should guide future work |
| `processes/` | Repeatable workflows and checklists |
| `.claude/skills/`, `.agents/skills/` | Project-local skills for the agents |

Dropping files or folders into Chats inserts their paths. Pasting a clipboard
image saves it in `inbox/` and inserts that path. This gives the agent an input;
it does not automatically publish or upload it to a service.

Within Files, dragging a file to another project folder moves it; dropping it
back in the same place does nothing. Delete (⌘⌫ on macOS) moves a selected item
to the Windows Recycle Bin (the Trash on macOS and Linux). Use Explorer, Finder
or your file manager for folder moves and other full filesystem operations.

## Skills and MCP: what is the difference?

A **skill** explains how to do a recurring task: decisions, prompts, checks and
sometimes helper scripts. **MCP** connects an agent to a tool or service. For
example, fal.ai MCP can run a model; the fal.ai skill explains model discovery,
reference inputs, job recovery, review and delivery.

Open **Skills** to read the project's Claude skills, Codex skills, knowledge and
processes. These are real files. Keep related agents pointed at one maintained
implementation rather than editing two independent copies.

Open **MCP** to see connection sources and check availability. An enabled entry
means it is configured. A successful connection check means the inspector could
reach it at that time; the intended agent still needs its own active connection
and account login. Some tools also require an application such as Blender to run.

When receiving a skill pack, read its getting-started guide, copy the selected
complete modules into your project, and install only their required dependencies.
Use your own provider accounts and keys. A skill does not include someone else's
subscription, running terminal, API balance or signed-in application.

## Talking to Mr. Mak

Press the nose button to start or stop a voice conversation. Ask for quick actions
such as opening a chat, finding a card, checking recent work or changing a card's
status. For a larger task, ask Mr. Mak to create an agent conversation and follow
its result. You can continue working directly in any terminal.

Voice uses the configured API connection. Terminal agents use their own installed
CLI and authentication; provider generation services use their own accounts.
The current choices are visible in Settings and in the agent or provider setup.

## Useful controls

| Control | Behavior |
| --- | --- |
| Ctrl+C in an agent chat (Windows, Linux) | Copy selected terminal text; it does not interrupt the agent |
| Ctrl+Shift+C (Windows, Linux) | Copy selected terminal text |
| Ctrl+C in PowerShell or a Linux shell chat | Normal shell interrupt behavior |
| ⌘C in any chat (macOS) | Copy selected terminal text |
| Ctrl+C in any chat (macOS) | Sent to the CLI, as in Terminal.app: it interrupts the agent or shell |
| Ctrl+V in a chat (⌘V on macOS) | Paste text or a clipboard screenshot |
| Ctrl+S while editing Markdown (⌘S or Ctrl+S on macOS) | Save the document |
| Escape in an image preview | Close the enlarged image |
| Optional Win-key recall (Windows) | Bring back open Mr. Mak windows; configurable in Settings. macOS has its own recall shortcut in Settings > Shortcut |
| Ctrl+Esc (Windows) | Open Windows Start |

Settings also contains terminal text size and appearance, the default agent,
new-chat permission defaults and voice choices. On macOS, Option types your
keyboard layout's characters in chats; Settings > Chats > Use Option as Meta
key turns it into a Meta key.
A CLI permission setting affects what that agent can do on your machine; choose
it deliberately for your workflow.

## Keep the Workspace understandable

- Use clear English card titles and chat names.
- Keep Workspace information in English by default. Another language is used
  only when explicitly requested for that particular output.
- Put revisions of the same task in one card, with readable tab names.
- Make images openable and downloadable. Keep editable sources beside results.
- Record what was checked and what still needs a decision. Do not label a
  technically completed generation as visually approved without reviewing it.
- Archive completed work instead of mixing it into the current task list.

## Bringing the workflow to another computer

The project repository carries its cards, skills, knowledge and workflows.
The desktop application, CLI agents, creative tools and account logins are
installed or configured on that computer. Read the package's installation guide;
copying a repository alone does not recreate every external application.

Share a clean skill pack or a deliberately prepared template, not a copy of your
working account state. Keep `.env`, credentials, private conversations, raw job
receipts and unrelated client files out of a handoff. The supplied skill pack
contains generic examples and instructions; each recipient supplies their own inputs.

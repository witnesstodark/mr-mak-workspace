# Rules

Mr. Mak gives every new Claude Code, Codex and OpenCode chat two rule files:

| File | Scope | Who edits |
| --- | --- | --- |
| `.agents/rules.md` in the project | Chats in that project folder | The owner (Workspace Rules panel) and the agent, when the owner corrects how it works |
| `<mrmak>/.agents/global-rules.md` | Every chat Mr. Mak starts | The owner; an agent only when the owner asks for a global rule |

A chat reads the rules once, at launch. A rule added during a chat applies to
that chat because the agent follows what it wrote; other open chats get it when
they are started or resumed.

## Format

- Each rule is one line starting with `- `, at most 500 characters, with no
  line breaks. Mr. Mak reads only those lines; the header and other text stay.
- A project keeps at most 200 rules.
- Write the rule as an instruction that holds by itself in a later task: what
  to do or avoid, and the condition when it applies. Leave out the incident
  that prompted it.
- Keep the file's existing header. Create the file with the header below when
  it does not exist.

```markdown
# Project rules

Rules the owner set for agents working in this project. Follow them in every task.
When the owner corrects how you work and the correction should hold for later tasks,
add it here as one short line starting with "- ", then tell the owner which rule you
added. Do not remove or reword a rule unless the owner asks.
```

## When to add a rule

Add a project rule when the owner corrects how you work and the correction
should hold for later tasks: a convention, a command to use or avoid, a file not
to touch, a way of reporting. Do not add one for a one-off instruction about the
current task, a fact the repository already records, or a preference already in
the file. Read the file first and reword nothing the owner wrote. Tell the owner
the exact line you added.

Do not remove, merge or reword an existing rule unless the owner asks. When a
new correction contradicts a rule, ask which one holds.

## "remember:" and "lembre:" notes

A message that starts with `remember:` or `lembre:` is a rule the owner marked
for Mr. Mak. The app shows it in a band with Save to project, Save as global,
Edit and Skip, on the desktop and on the phone. Do not write that rule to a rule
file yourself, or it is saved twice. Follow it in the current task and say that
the band will save it. Write it yourself only when the owner asks in the same
message or the band is not available (a chat outside Mr. Mak).

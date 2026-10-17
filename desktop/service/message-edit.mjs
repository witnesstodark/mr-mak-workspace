import { chooseOption, terminalPrompt } from './terminal-prompt.mjs';

// Editing a sent message drives Claude Code's own rewind (Esc Esc), so the CLI
// forks the conversation exactly as it does when the user rewinds in the terminal:
// pick the message in the list, restore the conversation only (files are left
// alone), then clear the restored text from the input. The caller sends the
// edited text afterwards through the ordinary send path.
const ESC = '\x1b', UP = '\x1b[A';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const conflict = message => Object.assign(new Error(message), { status: 409 });
const normal = text => text.replace(/\s+/g, ' ').trim();

// The rewind list shows a message by its first line, cut to the terminal width.
export const messageLabel = text => normal(String(text || '').split('\n').find(line => line.trim()) || '');
export function sameLabel(shown, label) {
  const cut = shown.replace(/(…|\.\.\.)$/, '').trim();
  return !!cut && (shown === label || label.startsWith(cut));
}

// The open rewind list, from its title to the bottom of the screen, and the
// message it has selected. The confirmation step after it has no such list.
export function rewindList(screen) {
  const lines = String(screen || '').split('\n');
  const start = lines.findLastIndex(line => /^\s*Rewind\s*$/.test(line));
  if (start < 0) return null;
  const list = lines.slice(start);
  if (!list.some(line => /Enter to continue/.test(line))) return null;
  const selected = list.find(line => /^\s*❯\s/.test(line));
  return selected ? { selected: normal(selected.replace(/^\s*❯\s*/, '')), text: list.join('\n') } : null;
}

const editing = new Set();

export async function rewindToMessage(sessions, transcripts, id, messageId) {
  const session = sessions.get(id);
  if (session.agent !== 'claude') throw new Error('Editing a sent message is available in Claude Code chats.');
  if (!session.process) throw new Error('This terminal is stopped. Resume it before editing a message.');
  if (session.activity === 'working') throw conflict('Wait for the reply to finish, or stop it, before editing a message.');
  if (editing.has(id)) throw conflict('A message in this chat is already being edited.');
  const { messages = [] } = await transcripts.read(session);
  const index = messages.findIndex(item => item.id === messageId && item.role === 'user');
  if (index < 0) throw conflict('This message is no longer in the conversation.');
  const label = messageLabel(messages[index].text);
  if (!label) throw new Error('This message has no text to find in the rewind list. Use Esc Esc in the terminal.');
  // Later messages with the same first line come first when moving up the list.
  let skip = messages.slice(index + 1).filter(item => item.role === 'user' && messageLabel(item.text) === label).length;

  editing.add(id);
  const screen = async () => (await sessions.read(id, 80)).screen;
  const until = async (test, ms) => {
    for (const end = Date.now() + ms; ;) {
      const value = test(await screen());
      if (value || Date.now() > end) return value;
      await delay(80);
    }
  };
  const press = data => sessions.keys(id, data);
  let open = false;
  try {
    if (terminalPrompt(await screen())) throw conflict('Answer the question in the conversation first.');
    // Esc Esc opens the list from an empty input; text left in the input is cleared by the first pair.
    let list = null;
    for (let attempt = 0; attempt < 2 && !list; attempt++) {
      press(ESC); await delay(150); press(ESC);
      list = await until(rewindList, 1500);
    }
    if (!list) throw conflict('The rewind list did not open. Check the terminal.');
    open = true;
    for (;;) {
      press(UP);
      const previous = list.text;
      const next = await until(value => { const item = rewindList(value); return item && item.text !== previous ? item : null; }, 1000);
      if (!next) throw conflict('This message was not found in the rewind list. Use Esc Esc in the terminal.');
      list = next;
      if (sameLabel(list.selected, label) && skip-- === 0) break;
    }
    press('\r');
    const confirm = await until(value => { const prompt = terminalPrompt(value); return prompt?.options.some(option => /^Restore conversation$/i.test(option)) ? prompt : null; }, 3000);
    if (!confirm) throw conflict('Claude Code did not offer to restore the conversation. Check the terminal.');
    await chooseOption(press, confirm, confirm.options.findIndex(option => /^Restore conversation$/i.test(option)));
    open = false;
    if (!await until(value => !terminalPrompt(value) && !rewindList(value), 3000)) throw conflict('The rewind did not finish. Check the terminal.');
    // The restored message is placed in the input; clear it for the edited text.
    await delay(300);
    press(ESC); await delay(150); press(ESC); await delay(400);
    if (rewindList(await screen())) { press(ESC); await delay(200); }
    return { rewound: true };
  } catch (error) {
    if (open) press(ESC);
    throw error;
  } finally { editing.delete(id); }
}

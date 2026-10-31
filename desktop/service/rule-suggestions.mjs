import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promptPreview } from './claude-sessions.mjs';
import { editGlobalRules, editRules, markedRule } from './project-rules.mjs';

// Rules the owner marked in a chat with "remember:" or "lembre:", found in the
// chat's own transcript, so a message typed in the terminal counts too. Each one
// waits in a band in the chat until the owner saves or skips it.
const RECENT_MS = 12 * 60 * 60 * 1000;

export class RuleSuggestions {
  constructor(stateDir, transcripts) { this.file = path.join(stateDir, 'rule-suggestions.json'); this.transcripts = transcripts; this.handled = null; this.saving = Promise.resolve(); }
  async load() {
    if (!this.handled) this.handled = await readFile(this.file, 'utf8').then(text => JSON.parse(text).handled || {}, () => ({}));
    return this.handled;
  }
  async list(session, now = Date.now()) {
    const handled = new Set((await this.load())[session.id] || []);
    const { prompts } = await this.transcripts.prompts(session);
    return prompts.flatMap(prompt => {
      const rule = markedRule(promptPreview(prompt.text, 2000));
      return rule && !handled.has(prompt.id) && now - Date.parse(prompt.at || 0) < RECENT_MS ? [{ id: prompt.id, rule, at: prompt.at }] : [];
    }).slice(-5);
  }
  // Saves the rule to the project or to every chat, or only dismisses it.
  async resolve(session, { id, action, text }, repo) {
    const found = (await this.list(session)).find(item => item.id === id);
    if (!found) throw new Error('This rule was already saved or skipped.');
    if (action === 'project') await editRules(session.cwd, { action: 'add', text: text || found.rule });
    else if (action === 'global') await editGlobalRules(repo, { action: 'add', text: text || found.rule });
    else if (action !== 'skip') throw new Error('Choose project, global or skip.');
    const handled = await this.load();
    handled[session.id] = [...(handled[session.id] || []), id].slice(-200);
    for (const key of Object.keys(handled).slice(0, -300)) delete handled[key];
    this.saving = this.saving.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify({ handled }));
      await rename(temporary, this.file);
    });
    await this.saving;
    return this.list(session);
  }
}

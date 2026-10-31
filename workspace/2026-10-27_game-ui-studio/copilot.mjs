/**
 * Game UI Studio - Copilot drawer
 * Sends prompts with the screen context and the edit protocol, reads the reply
 * from the agent's conversation transcript (terminal text only as a fallback),
 * and turns gameui-edit blocks into cards: Preview draws ghosts on the canvas,
 * Apply is one undo step, Discard removes the card.
 */
import { generateHandoff, findScreen, findNode } from './model.mjs';
import { EDIT_PROTOCOL, buildPrompt, estimateTokens, extractEdits, planEdit, promptContext, rejectionMessage } from './edits.mjs';

const $ = id => document.getElementById(id);
const POLL_MS = 1500;
// Past SLOW_AFTER_MS the reply is still awaited, polled less often. A reply with
// an edit block that has not changed for STALE_POLLS polls ends the turn even
// when the CLI still looks busy, so a long task's answer is not thrown away.
const SLOW_AFTER_MS = 15 * 60 * 1000;
const TURN_LIMIT_MS = 3 * 60 * 60 * 1000;
const STALE_POLLS = 20;
const AGENT_LABELS = { antigravity: 'Antigravity', claude: 'Claude', codex: 'Codex', opencode: 'OpenCode' };

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Small Markdown subset for replies: code fences, inline code, bold, headings, bullets.
export function renderMarkdown(text) {
  const codes = [];
  const source = String(text || '').replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code) => `\n\u0000${codes.push(code) - 1}\u0000\n`);
  const html = escapeHtml(source)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^#{1,6}\s+(.+)$/gm, '<strong>$1</strong>')
    .replace(/^\s*(?:[-*]|\d+\.)\s+(.+)$/gm, '<span class="li">$1</span>');
  return html.split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map(p => /^\u0000\d+\u0000$/.test(p)
    ? p
    : `<p>${p.replace(/\n(?!<span class="li">)/g, '<br>').replace(/\n/g, '')}</p>`).join('')
    .replace(/\u0000(\d+)\u0000/g, (_, i) => `<pre><code>${escapeHtml(codes[Number(i)].replace(/\n$/, ''))}</code></pre>`);
}

const OP_ICON = { add: '+', update: '~', remove: '−', screen: '▣', link: '→', invalid: '!' };

export function createCopilot(host) {
  const { link, prefs } = host;
  let session = null; // { id, key, agent }
  let turn = null;
  let cardSeq = 0;
  let previewId = null;
  let peekTab = 'context';
  const cards = new Map();
  const include = { screen: prefs.copilotScreen !== false, selection: prefs.copilotSelection !== false };

  const messages = () => $('chat-messages');
  const agentId = () => $('agent-select').value;
  const agentName = () => AGENT_LABELS[agentId()] || agentId();
  const doc = () => host.getDoc();
  const activeScreen = () => findScreen(doc(), host.activeScreenId()) || doc().screens[0];

  // ================= Context =================
  function currentContext() {
    if (!include.screen) return null;
    return promptContext(doc(), host.activeScreenId(), include.selection ? host.selectedId() : null, { issues: host.issues(), kit: host.kitSrc?.() });
  }

  function contextNote(ctx) {
    if (!ctx) return 'text only';
    return [`${ctx.screen.name} spec`, ctx.selection?.name].filter(Boolean).join(' · ');
  }

  function renderContextBar() {
    const screen = activeScreen();
    const sel = host.selectedId() ? findNode(doc(), host.selectedId()) : null;
    const chipScreen = $('ctx-screen');
    chipScreen.classList.toggle('on', include.screen);
    chipScreen.setAttribute('aria-pressed', String(include.screen));
    chipScreen.querySelector('span').textContent = screen.name;
    chipScreen.title = include.screen
      ? `Each message carries the ${screen.name} spec as compact JSON, plus the edit protocol. Click to send text only.`
      : 'Messages go as plain text. Click to attach the screen spec and the edit protocol again.';
    const chipSel = $('ctx-selection');
    chipSel.hidden = !sel;
    if (sel) {
      chipSel.classList.toggle('on', include.selection && include.screen);
      chipSel.disabled = !include.screen;
      chipSel.setAttribute('aria-pressed', String(include.selection));
      chipSel.querySelector('span').textContent = sel.node.name;
      chipSel.title = include.selection ? 'The selected element goes with every message, with all its props.' : 'The selection is left out.';
    }
    const ctx = currentContext();
    const size = ctx ? `about ${(estimateTokens(buildPrompt('', ctx)) / 1000).toFixed(1)}k tokens` : 'nothing';
    $('ctx-size').textContent = ctx ? '' : 'text only';
    $('btn-ctx-peek').title = `See what the agent receives (${size} added to each message), copy it or the handoff, or paste a reply`;
    $('btn-ctx-peek').dataset.size = size;
    if (!$('ctx-peek').hidden) renderPeek(ctx);
  }

  // Readable JSON for the peek: objects indented, short lists kept on one line.
  const pretty = value => JSON.stringify(value, null, 2)
    .replace(/\[\s*\n\s*((?:"[^"\n]*"|-?[\d.]+)(?:,\s*\n\s*(?:"[^"\n]*"|-?[\d.]+))*)\s*\n\s*\]/g, (_, items) => `[${items.split(/,\s*\n\s*/).join(', ')}]`);

  function peekText(ctx = currentContext()) {
    if (peekTab === 'handoff') return generateHandoff(doc(), host.activeScreenId());
    if (!ctx) return '(Screen spec is off: messages go as plain text, so the agent cannot propose edits.)';
    return buildPrompt('(your message)', ctx).replace(JSON.stringify(ctx), pretty(ctx));
  }

  function renderPeek(ctx) {
    document.querySelectorAll('#peek-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === peekTab));
    $('peek-body').textContent = peekText(ctx);
    $('peek-hint').textContent = peekTab === 'handoff'
      ? 'Markdown for the agent that implements this screen in the engine.'
      : `Added to each message (${$('btn-ctx-peek').dataset.size || 'nothing'}). Copy it for an agent outside Mr. Mak, then paste its reply below.`;
  }

  function togglePeek(force) {
    const peek = $('ctx-peek');
    const open = force ?? peek.hidden;
    peek.hidden = !open;
    $('btn-ctx-peek').setAttribute('aria-expanded', String(open));
    $('btn-ctx-peek').classList.toggle('on', open);
    if (open) renderPeek(currentContext());
  }

  // ================= Session line =================
  function sessionLine(state, text) {
    const line = $('session-line');
    line.dataset.state = state;
    $('session-text').textContent = text;
    $('btn-session-open').hidden = !session || state === 'offline';
  }

  function idleLine() {
    if (link.mode === 'offline') return sessionLine('offline', 'Offline: open the studio from Mr. Mak to reach an agent.');
    if (session) return sessionLine('ready', `${AGENT_LABELS[session.agent] || session.agent} chat ready in ${doc().projectName || 'the project'}`);
    sessionLine('idle', `Starts a ${agentName()} chat in ${doc().projectName || 'the repository'} with your first message`);
  }

  function resetSession() {
    session = null;
    if (!turn) idleLine();
  }

  // ================= Messages =================
  function append(el) {
    const box = messages();
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
    return el;
  }

  function message(role, html) {
    const el = document.createElement('div');
    el.className = `chat-msg ${role}`;
    el.innerHTML = html;
    return append(el);
  }

  function author() {
    return `<div class="chat-msg-author">${escapeHtml((AGENT_LABELS[session?.agent] || agentName()).toUpperCase())}</div>`;
  }

  function appendUser(display, note, attachment) {
    const extra = attachment
      ? `<details class="msg-attach"><summary>Show Markdown</summary><pre>${escapeHtml(attachment)}</pre><button class="btn sm" data-act="copy-attach">Copy</button></details>`
      : '';
    const el = message('user', `<div>${escapeHtml(display).replace(/\n/g, '<br>')}</div>${extra}<div class="msg-ctx">+ ${escapeHtml(note)}</div>`);
    if (attachment) el.querySelector('[data-act="copy-attach"]').onclick = () => copy(attachment, 'Copied the handoff Markdown.');
  }

  function appendAgent(text) {
    message('agent', `${author()}<div class="md">${renderMarkdown(text)}</div>`);
    notify();
  }

  function appendSystem(text) {
    message('system', escapeHtml(text));
  }

  function notify() {
    if (!host.isChatOpen()) $('copilot-dot').hidden = false;
  }

  async function copy(text, done) {
    try {
      await navigator.clipboard.writeText(text);
      host.setStatus(done);
    } catch {
      host.setStatus('The clipboard is not available here; select the text and copy it.', true);
    }
  }

  // ================= Sending =================
  async function ensureSession() {
    const agent = agentId();
    const effort = $('effort-select').value;
    const cwd = doc().projectPath || '';
    const key = `${agent}|${cwd}|${effort}`;
    if (session?.key === key) return session.id;
    sessionLine('starting', `Starting ${agentName()} in ${doc().projectName || 'the repository'}…`);
    const result = await link.call('start', { agent, effort, cwd, name: `UI Studio ${doc().projectName || ''}`.trim() });
    session = { id: result.id, key, agent };
    return session.id;
  }

  async function send(text, { display = text, attachment = '' } = {}) {
    const body = String(text || '').trim();
    if (!body) return;
    if (turn) {
      host.setStatus('Copilot is still answering; send the next message when the reply arrives.', true);
      return;
    }
    host.openChat();
    const ctx = currentContext();
    appendUser(display, contextNote(ctx), attachment);
    await link.ready;
    if (link.mode === 'offline') {
      appendSystem('No agent is connected. Open the studio from Mr. Mak, or copy the context (eye button above) into another agent and paste its reply there.');
      return;
    }
    const prompt = buildPrompt(body, ctx);
    const t = { started: Date.now(), sentAt: 0, sawWorking: false, stable: 0, lastReply: '', failures: 0, screenId: host.activeScreenId(), bubble: null, sessionId: null, baseline: new Set() };
    turn = t;
    setBusy(true);
    t.bubble = message('agent working', `${author()}<div class="work"><span class="spin"></span><span class="wt">Sending…</span></div><div class="wsnip"></div><div class="wprompt"></div>`);
    try {
      let id = await ensureSession();
      const before = await link.call('messages', { id }).catch(() => null);
      t.baseline = new Set((before?.messages || []).map(m => m.id));
      try {
        await link.call('send', { id, text: prompt });
      } catch (error) {
        if (!/stopped|not found|unknown|resume/i.test(error.message)) throw error;
        // The studio chat was closed or stopped: start a new one once.
        session = null;
        id = await ensureSession();
        t.baseline = new Set();
        await link.call('send', { id, text: prompt });
      }
      t.sessionId = id;
      t.sentAt = Date.now();
      sessionLine('working', `${AGENT_LABELS[session.agent] || agentName()} is working…`);
      setTimeout(poll, POLL_MS);
    } catch (error) {
      endTurn();
      appendSystem(`Could not reach the agent: ${error.message}`);
    }
  }

  function setBusy(busy) {
    $('btn-chat-send').disabled = busy;
    $('btn-chat-send').title = busy ? 'Waiting for the reply' : 'Send (Enter; Shift+Enter for a new line)';
    document.querySelectorAll('.chat-quick-actions .chip-btn').forEach(b => { b.disabled = busy; });
  }

  function endTurn(note) {
    if (turn?.bubble) turn.bubble.remove();
    turn = null;
    setBusy(false);
    idleLine();
    if (note) appendSystem(note);
  }

  function replyOf(t, r) {
    const list = r.messages || [];
    const start = list.findIndex(m => m.role === 'user' && !t.baseline.has(m.id));
    if (start < 0) return '';
    return list.slice(start + 1).filter(m => m.role === 'assistant' && m.text?.trim()).map(m => m.text.trim()).join('\n\n');
  }

  function screenTail(screen) {
    const lines = String(screen || '').split('\n').map(l => l.trimEnd());
    while (lines.length && !lines.at(-1)) lines.pop();
    return lines.slice(-14).join('\n').trim();
  }

  // ================= Agent menus =================
  // A permission or choice menu the agent drew in its terminal, answered here
  // instead of in its chat. The service re-reads the menu before each key, so a
  // stale click fails instead of choosing in a newer menu.
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderPrompt(t, prompt) {
    const box = t.bubble.querySelector('.wprompt');
    if (!prompt) { t.prompt = null; box.replaceChildren(); return; }
    if (t.prompt?.id === prompt.id) return; // Keep the picks and typed text of the same menu.
    t.prompt = { id: prompt.id, picks: (prompt.checked || []).flatMap((on, i) => on ? [i] : []) };
    const p = t.prompt;
    const status = el('div', 'wp-status');
    const buttons = [];
    const answer = async (choice, label) => {
      if (p.busy || t.prompt !== p) return;
      p.busy = true;
      buttons.forEach(b => { b.disabled = true; });
      status.classList.remove('warn');
      status.textContent = 'Answering…';
      try {
        await link.call('answer', { id: t.sessionId, prompt: p.id, choice });
        status.textContent = `Answered: ${label}`;
      } catch (error) {
        p.busy = false;
        buttons.forEach(b => { b.disabled = false; });
        status.classList.add('warn');
        status.textContent = error.message;
      }
    };
    const button = (cls, text, onclick) => {
      const b = el('button', cls, text);
      b.type = 'button';
      b.onclick = onclick;
      buttons.push(b);
      return b;
    };
    const parts = [el('strong', 'wp-q', prompt.question)];
    if (prompt.detail.length) parts.push(el('pre', 'wp-detail', prompt.detail.join('\n')));
    const list = el('div', 'wp-options');
    prompt.options.forEach((option, i) => {
      const number = String(i + 1);
      if (prompt.kind === 'multiple') {
        if (i === prompt.input) {
          const b = el('button', 'wp-opt', `${number}. ${option} · in the chat`);
          b.disabled = true;
          list.append(b);
          return;
        }
        const b = button('wp-opt', `${number}. ${option}`, () => {
          p.picks = p.picks.includes(i) ? p.picks.filter(x => x !== i) : [...p.picks, i].sort((a, b) => a - b);
          b.classList.toggle('checked', p.picks.includes(i));
          b.setAttribute('aria-checked', String(p.picks.includes(i)));
        });
        b.setAttribute('role', 'checkbox');
        b.classList.toggle('checked', p.picks.includes(i));
        b.setAttribute('aria-checked', String(p.picks.includes(i)));
        list.append(b);
        return;
      }
      const b = button(`wp-opt${i === prompt.selected ? ' selected' : ''}`, `${number}. ${option}`, () => {
        if (i !== prompt.input) return answer(i, option);
        // The own-answer option opens a field; Enter sends it, Escape closes it.
        const form = el('form', 'wp-own');
        const input = el('input');
        input.maxLength = 2000;
        input.placeholder = 'Your answer';
        input.setAttribute('aria-label', 'Your answer');
        const send = button('btn sm primary', 'Send');
        send.type = 'submit';
        form.append(input, send);
        form.onsubmit = event => { event.preventDefault(); if (input.value.trim()) answer({ text: input.value.trim() }, input.value.trim()); };
        input.onkeydown = event => { if (event.key === 'Escape') { event.stopPropagation(); form.replaceWith(b); } };
        b.replaceWith(form);
        input.focus();
      });
      list.append(b);
    });
    parts.push(list);
    const foot = el('div', 'wp-foot');
    if (prompt.kind === 'multiple') {
      foot.append(button('btn sm primary', prompt.submit || 'Submit', () => answer({ checked: p.picks }, p.picks.map(i => prompt.options[i]).join(', ') || 'none')));
    }
    foot.append(button('btn sm', 'Esc · cancel', () => answer('cancel', 'cancel')));
    const open = el('button', 'link', 'Open chat');
    open.type = 'button';
    open.title = 'Show this chat in Mr. Mak Chats';
    open.onclick = () => link.call('open', { id: t.sessionId }).catch(error => host.setStatus(error.message, true));
    foot.append(open);
    parts.push(foot, status);
    box.replaceChildren(...parts);
    messages().scrollTop = messages().scrollHeight;
    notify();
  }

  async function poll() {
    const t = turn;
    if (!t || !t.sessionId) return;
    let r;
    try {
      r = await link.call('messages', { id: t.sessionId });
    } catch (error) {
      if (turn !== t) return;
      if (++t.failures > 5) return endTurn(`Lost the agent chat: ${error.message}`);
      setTimeout(poll, POLL_MS * 2);
      return;
    }
    if (turn !== t) return;
    t.failures = 0;
    const elapsed = Date.now() - t.sentAt;
    if (r.activity === 'working') t.sawWorking = true;
    const waiting = !!r.prompt || r.activity === 'waiting';
    const reply = r.supported ? replyOf(t, r) : '';
    t.stable = reply && reply === t.lastReply ? t.stable + 1 : 0;
    t.lastReply = reply;

    const menu = r.prompt && typeof r.prompt === 'object' ? r.prompt : null;
    const wt = t.bubble.querySelector('.wt');
    wt.textContent = menu ? `${agentName()} needs your answer:` : waiting ? `${agentName()} is waiting for your answer in its chat.` : `Working… ${Math.round(elapsed / 1000)} s`;
    t.bubble.classList.toggle('waiting', waiting);
    renderPrompt(t, menu);
    const snip = t.bubble.querySelector('.wsnip');
    const prose = reply ? extractEdits(reply).prose : '';
    snip.textContent = prose ? (prose.length > 160 ? `…${prose.slice(-160)}` : prose) : '';
    if (waiting) sessionLine('waiting', `${agentName()} needs your answer`);
    else sessionLine('working', `${agentName()} is working…`);

    const done = reply && !waiting && (
      (r.activity === 'idle' && (t.sawWorking || t.stable >= 2)) ||
      (!r.activity && t.stable >= 2) ||
      (extractEdits(reply).blocks.length > 0 && t.stable >= STALE_POLLS)
    );
    if (done) {
      endTurn();
      renderReply(reply, t.screenId);
      return;
    }
    if (!r.supported && r.activity === 'idle' && (t.sawWorking || elapsed > 20000)) {
      endTurn();
      // No readable transcript for this agent: show the end of its terminal.
      const tail = screenTail(r.screen);
      if (tail) message('agent', `${author()}<div class="hint">From the terminal (this agent has no readable transcript yet):</div><pre class="term">${escapeHtml(tail)}</pre>`);
      else appendSystem('The agent finished, but its reply could not be read. Open its chat to see it.');
      notify();
      return;
    }
    if (r.status === 'exited' || r.status === 'stopped') return endTurn('The agent chat stopped before it answered. Send the message again to start a new one.');
    if (elapsed > TURN_LIMIT_MS) return endTurn('Still working after 3 hours. Follow it in the agent chat (Open chat).');
    setTimeout(poll, elapsed > SLOW_AFTER_MS ? POLL_MS * 4 : POLL_MS);
  }

  // ================= Replies and cards =================
  function renderReply(text, screenId = host.activeScreenId()) {
    // The agent may have built or updated the game kit during this turn.
    host.reloadKit?.();
    const { prose, blocks } = extractEdits(text);
    if (prose) appendAgent(prose);
    for (const block of blocks) {
      if (block.error) {
        const el = message('system warn', `${escapeHtml(block.error)} <button class="link" data-act="ask-fix-json">Ask to fix</button>`);
        el.querySelector('button').onclick = () => send(`${block.error} Send the gameui-edit block again as valid JSON.`, { display: 'Ask Copilot to resend the edit block' });
      } else {
        addCard(block.edit, screenId);
      }
    }
    if (!prose && !blocks.length) appendSystem('The agent sent an empty reply.');
    notify();
  }

  function planCard(card) {
    try {
      card.plan = planEdit(doc(), card.edit, card.fallback);
    } catch (error) {
      card.plan = { ok: false, summary: '', screenId: null, screenName: '', errors: [`The studio could not check this edit: ${error.message}`], results: [], count: 0, rejected: 0, doc: null, marks: { added: [], updated: [], removed: [], screen: false } };
    }
  }

  function addCard(edit, screenId) {
    for (const other of cards.values()) {
      if (other.state === 'pending' && other.expanded) { other.expanded = false; renderCard(other); }
    }
    if (previewId) previewId = null;
    const card = { id: `card-${++cardSeq}`, edit, fallback: screenId, state: 'pending', expanded: true, plan: null, el: document.createElement('div') };
    card.el.className = 'edit-card';
    card.el.dataset.card = card.id;
    cards.set(card.id, card);
    planCard(card);
    renderCard(card);
    append(card.el);
    host.redraw();
  }

  function opRow(r) {
    const kind = !r.ok ? 'bad' : r.noop ? 'noop' : r.kind;
    const icon = !r.ok ? '!' : r.noop ? '=' : OP_ICON[r.kind] || '•';
    const detail = !r.ok ? r.error : r.noop ? 'already as proposed' : r.detail;
    const name = r.ok ? r.name : `${r.kind === 'invalid' ? 'op' : r.kind} ${r.name || ''}`.trim();
    return `<li class="ec-op ${kind}" title="${escapeHtml(detail)}"><i>${icon}</i><b>${escapeHtml(name)}</b><span>${escapeHtml(detail)}</span></li>`;
  }

  function renderCard(card) {
    const applied = card.state === 'applied';
    const plan = applied ? card.appliedPlan : card.plan;
    const n = plan.count;
    const previewing = previewId === card.id;
    const where = plan.screenName || findScreen(doc(), card.fallback)?.name || '';
    card.el.classList.toggle('applied', applied);
    card.el.classList.toggle('collapsed', !card.expanded);
    card.el.classList.toggle('previewing', previewing && card.expanded);
    const head = applied
      ? `<svg class="ic sm ok"><use href="#i-check-circle"/></svg><b>Applied ${n} change${n === 1 ? '' : 's'}</b>`
      : `<svg class="ic sm"><use href="#i-layout"/></svg><b>Proposed changes</b>`;
    const list = plan.results.map(opRow).join('');
    const errors = plan.errors.map(e => `<div class="ec-err"><svg class="ic sm"><use href="#i-error"/></svg>${escapeHtml(e)}</div>`).join('');
    const rejected = plan.rejected + plan.errors.length;
    const canUndo = applied && card.appliedJson === JSON.stringify(doc());
    const foot = applied
      ? `<div class="ec-foot">${canUndo ? '<button class="btn box sm" data-act="undo"><svg class="ic sm"><use href="#i-undo"/></svg>Undo</button>' : ''}<small>${canUndo ? 'Or Ctrl+Z' : 'Later edits follow it; use Undo in the top bar'}</small></div>`
      : `<div class="ec-foot">
          <button class="btn box sm ec-prev${previewing ? ' on' : ''}" data-act="preview" aria-pressed="${previewing}" ${n ? '' : 'disabled'} title="Show the proposed changes as ghosts on the canvas while this card is open"><svg class="ic sm"><use href="#i-eye"/></svg>${previewing ? 'Previewing' : 'Preview'}</button>
          <button class="btn primary sm" data-act="apply" ${n ? '' : 'disabled'} title="Apply as one undo step">Apply${n ? ` ${n}` : ''}</button>
          <button class="btn sm" data-act="discard">Discard</button>
          <small>One undo step</small>
        </div>`;
    const retry = !applied && rejected
      ? `<div class="ec-rej"><svg class="ic sm"><use href="#i-warn"/></svg>${rejected} rejected by the studio checks <button class="link" data-act="retry">Ask to fix</button></div>`
      : '';
    card.el.innerHTML = `
      <button class="ec-head" data-act="toggle" aria-expanded="${card.expanded}">
        <svg class="ic xs chev"><use href="#i-chev-d"/></svg>${head}<small>${escapeHtml(where)}${n ? ` · ${n}` : ''}</small>
      </button>
      <div class="ec-body">
        ${plan.summary ? `<p class="ec-sum">${escapeHtml(plan.summary)}</p>` : ''}
        ${errors}
        ${list ? `<ul class="ec-list">${list}</ul>` : ''}
        ${retry}
        ${foot}
      </div>`;
  }

  function cardAction(cardId, act) {
    const card = cards.get(cardId);
    if (!card) return;
    if (act === 'toggle') {
      card.expanded = !card.expanded;
      renderCard(card);
      if (previewId === card.id) host.redraw();
      return;
    }
    if (act === 'preview') {
      if (previewId === card.id) {
        previewId = null;
      } else {
        const previous = previewId && cards.get(previewId);
        previewId = card.id;
        if (previous) renderCard(previous);
        planCard(card);
        if (card.plan.screenId && card.plan.screenId !== host.activeScreenId()) host.showScreen(card.plan.screenId);
        else host.showScreen(null);
      }
      renderCard(card);
      host.redraw();
      if (previewId) host.setStatus(`Previewing ${card.plan.count} proposed change${card.plan.count === 1 ? '' : 's'}: dashed outlines are new or changed, hatched is removed. Nothing is applied yet.`);
      return;
    }
    if (act === 'apply') return apply(card.id);
    if (act === 'discard') return discard(card.id);
    if (act === 'retry') return send(rejectionMessage(card.plan), { display: 'Ask Copilot to fix the rejected changes' });
    if (act === 'undo') {
      if (card.appliedJson !== JSON.stringify(doc())) return renderCard(card);
      card.state = 'pending';
      card.expanded = true;
      host.undo();
      planCard(card);
      renderCard(card);
      host.redraw();
    }
  }

  function apply(cardId) {
    const card = cards.get(cardId);
    if (!card || card.state !== 'pending') return;
    planCard(card);
    if (card.plan.count && card.plan.screenId !== host.activeScreenId()) {
      // Open the edited screen first, so the applied document keeps it active.
      host.showScreen(card.plan.screenId);
      planCard(card);
    }
    if (!card.plan.count) {
      renderCard(card);
      host.setStatus('Nothing left to apply: every op is rejected or already in place.', true);
      return;
    }
    const n = card.plan.count;
    card.state = 'applied';
    card.appliedPlan = card.plan;
    card.expanded = false;
    if (previewId === card.id) previewId = null;
    host.commit(card.plan.doc, `Applied ${n} change${n === 1 ? '' : 's'} from Copilot. Undo with Ctrl+Z.`);
    card.appliedJson = JSON.stringify(doc());
    renderCard(card);
  }

  function discard(cardId) {
    const card = cards.get(cardId);
    if (!card) return;
    if (previewId === card.id) previewId = null;
    cards.delete(card.id);
    const note = document.createElement('div');
    note.className = 'chat-msg system';
    note.textContent = 'Proposal discarded.';
    card.el.replaceWith(note);
    host.redraw();
    host.setStatus('Discarded the proposed changes.');
  }

  function previewCard() {
    if (!previewId || !host.isChatOpen()) return null;
    const card = cards.get(previewId);
    if (!card || card.state !== 'pending' || !card.expanded || !card.plan?.doc) return null;
    if (card.plan.screenId !== host.activeScreenId()) return null;
    const m = card.plan.marks;
    if (!m.added.length && !m.updated.length && !m.removed.length && !m.screen) return null;
    return card;
  }

  // ================= Wiring =================
  function init() {
    $('ctx-screen').onclick = () => {
      include.screen = !include.screen;
      prefs.copilotScreen = include.screen;
      host.savePrefs();
      renderContextBar();
    };
    $('ctx-selection').onclick = () => {
      include.selection = !include.selection;
      prefs.copilotSelection = include.selection;
      host.savePrefs();
      renderContextBar();
    };
    $('btn-ctx-peek').onclick = () => togglePeek();
    $('peek-tabs').addEventListener('click', e => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      peekTab = b.dataset.tab;
      renderPeek(currentContext());
    });
    $('btn-peek-copy').onclick = () => copy(peekText(), peekTab === 'handoff' ? 'Copied the handoff Markdown.' : 'Copied the screen context and edit protocol.');
    $('btn-paste-reply').onclick = () => {
      const area = $('paste-reply');
      const text = area.value.trim();
      if (!text) return area.focus();
      area.value = '';
      host.openChat();
      appendSystem('Reading a pasted agent reply.');
      renderReply(text);
    };
    $('btn-session-open').onclick = () => {
      if (!session) return;
      link.call('open', { id: session.id }).catch(error => host.setStatus(`Could not open the chat: ${error.message}`, true));
    };
    $('agent-select').addEventListener('change', resetSession);
    $('effort-select').addEventListener('change', resetSession);

    messages().addEventListener('click', e => {
      const btn = e.target.closest('[data-act]');
      const card = e.target.closest('[data-card]');
      if (btn && card) cardAction(card.dataset.card, btn.dataset.act);
    });

    const input = $('chat-input');
    const submit = () => {
      const text = input.value.trim();
      if (!text || turn) return;
      input.value = '';
      input.style.height = '';
      send(text);
    };
    $('btn-chat-send').onclick = submit;
    input.onkeydown = e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    };
    input.oninput = () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(160, input.scrollHeight + 2)}px`;
    };

    $('chip-send-layout').onclick = () => sendHandoff();
    $('chip-gen-code').onclick = () => send(`Based on our project architecture and the active screen "${activeScreen().name}", generate the native engine code and scene hierarchy (for example a Godot .tscn and script, an Unreal UMG widget or a Unity prefab) implementing the anchors, widget states and event hooks.`, { display: 'Write the engine code for this screen.' });
    $('chip-import-art').onclick = () => send(`Build the game kit for the project at "${doc().projectPath || 'cwd'}", following the game-ui-studio skill (references/ui-assets.md, then references/game-kit.md). Copy its UI art, spritesheets, icons, backgrounds and fonts into the studio, read how the game styles its UI for 9-slice margins, colours and fonts, and write kit.json with build-kit.mjs, including components in the game's style. If the game already has screens, also bring them in as the kit's screens file. Say what the kit holds; the owner applies it from the Kit tab.`, { display: 'Build the game kit: art, colours, fonts, components and screens.' });
    $('chip-validate-v2').onclick = () => {
      const local = host.issues().filter(i => i.screenId === host.activeScreenId());
      const found = local.length
        ? `\n\nThe studio's local checks already report:\n${local.map(i => `- ${i.title}${i.nodeName ? ` (${i.nodeName})` : ''}: ${i.message}`).join('\n')}`
        : '\n\nThe studio\'s local checks report no issues.';
      send(`Audit the active screen "${activeScreen().name}" against knowledge/game-ui-guidelines.md (input sinking, safe zones, keyboard and gamepad navigation, readable text sizes, chip-damage gauges, the required options tabs). Say what is missing or can be improved, and propose the layout fixes as a gameui-edit block.${found}`, { display: 'Review this screen against the Game UI Guidelines.' });
    };

    link.ready.then(mode => {
      const name = escapeHtml(doc().projectName || 'Standalone');
      $('chat-connected').innerHTML = mode === 'offline'
        ? 'Offline: no Mr. Mak service here. Copy the context from the <b>eye</b> button for another agent and paste its reply there.'
        : `Connected to <strong>${name}</strong>. The agent runs in this folder.`;
      const agents = link.agents;
      if (Array.isArray(agents)) {
        const select = $('agent-select');
        for (const option of select.options) {
          const info = agents.find(a => a.id === option.value);
          option.disabled = info ? info.available === false : false;
          if (info?.available === false) option.textContent = `${AGENT_LABELS[option.value] || option.value} (not installed)`;
        }
        if (select.selectedOptions[0]?.disabled) {
          const first = [...select.options].find(o => !o.disabled);
          if (first) select.value = first.value;
        }
      }
      idleLine();
    });
    idleLine();
    renderContextBar();
  }

  function refresh() {
    renderContextBar();
    for (const card of cards.values()) {
      if (card.state === 'pending') planCard(card);
      renderCard(card);
    }
    if (!turn) idleLine();
  }

  function sendHandoff() {
    const screen = activeScreen();
    const md = generateHandoff(doc(), screen.id);
    send(`Here is the UI handoff for "${screen.name}". Implement it in the project engine and tell me which files you changed.\n\n${md}`, { display: `Sent the handoff for ${screen.name}.`, attachment: md });
  }

  return {
    init,
    refresh,
    send,
    sendHandoff,
    renderReply,
    resetSession,
    onProjectChange() {
      resetSession();
      $('chat-project-badge').textContent = doc().projectName || 'Standalone';
      const name = $('chat-connected').querySelector('strong');
      if (name) name.textContent = doc().projectName || 'Standalone';
    },
    /** Ghost overlay for render.mjs, or null. */
    overlay() {
      const card = previewCard();
      if (!card) return null;
      const m = card.plan.marks;
      return { screen: findScreen(card.plan.doc, card.plan.screenId), added: m.added, updated: m.updated, removed: m.removed };
    },
    /** What the canvas tag shows while a preview is visible. */
    previewInfo() {
      const card = previewCard();
      return card ? { id: card.id, count: card.plan.count, rejected: card.plan.rejected, screenName: card.plan.screenName } : null;
    },
    apply,
    discard,
    stopPreview() {
      const card = previewId && cards.get(previewId);
      previewId = null;
      if (card) renderCard(card);
      host.redraw();
    },
    protocol: EDIT_PROTOCOL
  };
}

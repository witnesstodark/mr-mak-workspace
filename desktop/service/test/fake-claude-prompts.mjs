// Fakes of Claude Code 2.1's terminal-only question picker and plan approval,
// drawn as its terminal shows them and reacting to keys the same way (captured
// from the real CLI). Shared by the prompt tests.
export class FakePicker {
  constructor(questions) { Object.assign(this, { questions, at: 0, cursor: 0, review: false, done: false, answers: [], checked: questions.map(() => new Set()), other: questions.map(() => '') }); }
  rows() {
    if (this.review) return ['Submit answers', 'Cancel'];
    const question = this.questions[this.at], other = this.other[this.at] || (question.multiSelect ? 'Type something' : 'Type something.');
    return [...question.options.map(option => option.label), other, ...(question.multiSelect ? ['SUBMIT'] : []), 'Chat about this'];
  }
  screen() {
    if (this.done) return '❯ \n  ⏵⏵ auto mode on (shift+tab to cycle)';
    const lines = ['❯ Ask me which pet I want', '────', this.questions.length > 1 ? `←  ${this.questions.map((item, index) => `${this.answers[index] ? '☒' : '☐'} ${item.header}`).join('  ')}  ✔ Submit  →` : ` ☐ ${this.questions[0].header}`, ''];
    if (this.review) lines.push('Review your answers', ...this.answers.flatMap((answer, index) => [` ● ${this.questions[index].question}`, `   → ${answer}`]), '', 'Ready to submit your answers?', '');
    else lines.push(this.questions[this.at].question, '');
    this.rows().forEach((label, index) => {
      const mark = index === this.cursor ? '❯' : ' ', question = this.questions[this.at];
      if (label === 'SUBMIT') return lines.push(`${mark}    Submit`);
      if (!this.review && label === 'Chat about this') lines.push('────');
      const box = !this.review && question.multiSelect && index <= question.options.length ? `[${this.checked[this.at].has(index) ? '✔' : ' '}] ` : '';
      lines.push(`${mark} ${index + 1 - (label === 'Chat about this' && question.multiSelect ? 1 : 0)}. ${box}${label}`);
      if (!this.review && question.options[index]) lines.push(`     ${question.options[index].description}`);
    });
    lines.push('', 'Enter to select · ↑/↓ to navigate · Esc to cancel');
    return lines.join('\n');
  }
  advance(answer) {
    this.answers[this.at] = answer; this.cursor = 0;
    if (this.at + 1 < this.questions.length) this.at++;
    else if (this.questions.length > 1) this.review = true;
    else this.done = true;
  }
  press(data) {
    const rows = this.rows(), question = this.questions[this.at], otherRow = question.options.length;
    if (data === '\x1b[A') this.cursor = (this.cursor + rows.length - 1) % rows.length;
    else if (data === '\x1b[B') this.cursor = (this.cursor + 1) % rows.length;
    else if (this.review) { if (data === '\r' && this.cursor === 0) this.done = true; }
    else if (data === ' ' && question.multiSelect && this.cursor < otherRow) { const set = this.checked[this.at]; if (set.has(this.cursor)) set.delete(this.cursor); else set.add(this.cursor); }
    else if (data === '\r' && question.multiSelect && rows[this.cursor] === 'SUBMIT') this.advance([...question.options.filter((_, index) => this.checked[this.at].has(index)).map(option => option.label), ...(this.other[this.at] ? [this.other[this.at]] : [])].join(', '));
    else if (data === '\r' && !question.multiSelect && this.cursor <= otherRow) this.advance(rows[this.cursor]);
    else if (this.cursor === otherRow && !/[\r\x1b]/.test(data)) { this.other[this.at] += data; if (question.multiSelect) this.checked[this.at].add(otherRow); }
  }
}

export class FakePlan {
  constructor() { Object.assign(this, { cursor: 0, text: '', done: null, labels: ['Yes, and use auto mode', 'Yes, manually approve edits', 'Tell Claude what to change'] }); }
  screen() {
    if (this.done) return '● User approved Claude\'s plan';
    const labels = [...this.labels]; if (this.text) labels[2] = this.text;
    return ['   Here is Claude\'s plan:', '   Steps', '   1. Write hello.txt', '   2. Check it', '  ────', '   Claude has written up a plan and is ready to execute. Would you like to proceed?', '',
      ...labels.map((label, index) => `   ${index === this.cursor ? '❯' : ' '} ${index + 1}. ${label}`), '        shift+tab to approve with this feedback', '', '   ctrl+g to edit in Msedit · ~/.claude/plans/plan.md'].join('\n');
  }
  press(data) {
    if (data === '\x1b[A') this.cursor = (this.cursor + 2) % 3;
    else if (data === '\x1b[B') this.cursor = (this.cursor + 1) % 3;
    else if (data === '\r') this.done = { choice: this.cursor + 1, text: this.text };
    else if (this.cursor === 2) this.text += data;
  }
}

import { randomUUID } from 'node:crypto';

export class NativeSettings {
  constructor(send, changed) { this.send = send; this.changed = changed; this.value = { available: false, winKey: false }; this.pending = new Map(); }
  receive(event) {
    if (event.type !== 'native-settings') return;
    this.value = { available: event.available === true, winKey: event.winKey === true, ...(event.error ? { error: String(event.error) } : {}) };
    this.changed(this.value);
    const pending = this.pending.get(event.requestId);
    if (pending) { clearTimeout(pending.timer); this.pending.delete(event.requestId); event.error ? pending.reject(new Error(event.error)) : pending.resolve(this.value); }
  }
  set(winKey) {
    if (typeof winKey !== 'boolean') throw new Error('Choose whether the Win key should show Mr. Mak.');
    if (!this.value.available) throw new Error('The optional system shortcut is not available.');
    if (this.pending.size) throw new Error('A shortcut change is already in progress.');
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('The native desktop did not confirm the change. Check the shortcut setting again.')); }, 5000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.send({ type: 'native-settings', requestId, winKey });
    });
  }
  close() { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Mr. Mak is closing.')); } this.pending.clear(); }
}

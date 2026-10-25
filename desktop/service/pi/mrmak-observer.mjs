// Mr. Mak passes this file to Pi with --extension. It only reports the chat's
// native session and activity to a private state file; it registers no tools,
// commands or UI, and changes nothing Pi sends to a model.
import { observerFromEnvironment } from './observer.mjs';

export default function mrmakObserver(pi) {
  const observe = observerFromEnvironment();
  if (!observe) return;
  const assistant = message => message?.role === 'assistant' ? message : null;
  pi.on('session_start', (_event, ctx) => {
    try { observe({ type: 'session', id: ctx?.sessionManager?.getSessionId?.(), cwd: ctx?.sessionManager?.getCwd?.() }); } catch { /* Never break Pi. */ }
  });
  pi.on('agent_start', () => observe({ type: 'agent_start' }));
  pi.on('message_end', event => {
    const message = assistant(event?.message);
    if (message) observe({ type: 'message_end', role: 'assistant', stopReason: message.stopReason });
  });
  pi.on('turn_end', event => {
    const message = assistant(event?.message);
    if (message) observe({ type: 'turn_end', role: 'assistant', stopReason: message.stopReason, entryId: event.messageEntryId });
  });
  pi.on('ui_prompt_start', () => observe({ type: 'ui_prompt_start' }));
  pi.on('ui_prompt_end', () => observe({ type: 'ui_prompt_end' }));
  pi.on('agent_settled', event => observe({ type: 'agent_settled', aborted: event?.aborted }));
}

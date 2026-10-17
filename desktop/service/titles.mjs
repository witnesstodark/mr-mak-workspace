export function englishTitle(value, fallback = 'New conversation') {
  const title = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 100) || fallback;
  if (/[^\x20-\x7e\u2013\u2014\u00b7\u2018\u2019\u201c\u201d]/u.test(title)) {
    throw new Error('Use an English chat name. Messages can be in any language.');
  }
  return title;
}

export function groupLabel(value) {
  const label = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!label) return null;
  if (label.length > 60) throw new Error('Keep the group name under 60 characters.');
  try { englishTitle(label); } catch { throw new Error('Use an English group name. Messages can be in any language.'); }
  return label;
}

export function restoredTitle(value, index) {
  if (/^(codex|claude|antigravity|agy|opencode|kimi)$/i.test(value || '')) return `Conversation ${index + 1}`;
  try { return englishTitle(value, `Conversation ${index + 1}`); }
  catch { return /голос/i.test(value || '') ? 'Mr. Mak voice' : `Conversation ${index + 1}`; }
}

export function taskTitle(value) {
  const title = englishTitle(value, '');
  if (!title || !/[a-z]/i.test(title) || /^untitled(?:[\s#_-]*\d+)?$/i.test(title) || /^(?:(?:new|untitled)\s+)?(?:conversation|chat|session|task|codex|claude|antigravity|agy|opencode|kimi)(?:[\s#_-]*\d+)?$/i.test(title)) {
    throw new Error('Choose a descriptive English task title before opening the chat, such as "Dream Game Combat" or "Workspace Files". Generic titles like "Conversation 1" are not allowed for coordinator-created chats.');
  }
  return title;
}

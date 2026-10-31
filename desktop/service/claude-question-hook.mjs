// Claude Code PermissionRequest hook for AskUserQuestion. Iaar adds it with
// `--settings` to the Claude chats it starts, so a paired phone can answer while
// the terminal dialog stays open. The first answer wins. Any failure ends with
// no output and exit code 0: no decision, and the terminal dialog carries on.
const url = process.env.IAAR_QUESTION_URL, token = process.env.IAAR_QUESTION_TOKEN;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function post(data, timeout) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Iaar-Question-Token': token }, body: JSON.stringify(data), signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw Object.assign(new Error(`Iaar replied ${response.status}`), { final: response.status < 500 });
  return response.json();
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  if (!url || !token) return null;
  const input = JSON.parse(raw);
  if (input.tool_name !== 'AskUserQuestion' || !Array.isArray(input.tool_input?.questions)) return null;
  const { id } = await post({ action: 'ask', input: { tool_name: input.tool_name, tool_input: input.tool_input } }, 10000);
  for (let failures = 0; ;) {
    let reply;
    try { reply = await post({ action: 'wait', id }, 45000); failures = 0; }
    catch (error) { if (error.final || ++failures >= 4) return null; await sleep(1000 * failures); continue; }
    if (reply.status === 'answered') return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput: reply.updatedInput } } };
    if (reply.status !== 'pending') return null;
  }
}

main().catch(() => null).then(output => {
  // Exit at once: an idle keep-alive socket must not delay Claude after an answer.
  if (output) process.stdout.write(JSON.stringify(output), () => process.exit(0));
  else process.exit(0);
});

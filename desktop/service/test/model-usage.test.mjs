import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transcriptUsage, readClaudeUtilization } from '../mobile-transcript.mjs';
import { createService } from '../server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('transcriptUsage parses Codex token count and 5h / 7d rate limits', () => {
  const records = [
    {
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { input_tokens: 12000, output_tokens: 2500, total_tokens: 14500 },
          last_token_usage: { input_tokens: 4000, cached_input_tokens: 1500, output_tokens: 600, reasoning_output_tokens: 200, total_tokens: 4600 },
          model_context_window: 258400
        },
        rate_limits: {
          limit_id: 'codex',
          plan_type: 'plus',
          primary: { used_percent: 42, window_minutes: 300, resets_at: 1760000000 },
          secondary: { used_percent: 18, window_minutes: 10080, resets_at: 1760500000 }
        }
      }
    },
    {
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { input_tokens: 15000, output_tokens: 3000, total_tokens: 18000 },
          last_token_usage: { input_tokens: 5000, cached_input_tokens: 2000, output_tokens: 800, reasoning_output_tokens: 300, total_tokens: 5800 },
          model_context_window: 258400
        },
        rate_limits: {
          limit_id: 'premium',
          plan_type: 'plus',
          primary: { used_percent: 75, window_minutes: 300, resets_at: 1760010000 },
          secondary: { used_percent: 30, window_minutes: 10080, resets_at: 1760510000 }
        }
      }
    }
  ];

  const usage = transcriptUsage(records, 'codex');
  assert.ok(usage);
  assert.equal(usage.agent, 'codex');
  assert.equal(usage.tokens.current, 5800);
  assert.equal(usage.tokens.cumulative, 18000);
  assert.equal(usage.tokens.input, 5000);
  assert.equal(usage.tokens.cached, 2000);
  assert.equal(usage.tokens.output, 800);
  assert.equal(usage.tokens.reasoning, 300);
  assert.equal(usage.tokens.contextWindow, 258400);
  assert.equal(usage.tokens.contextPercent, 2); // 5800 / 258400 = 2.2% -> 2%

  assert.equal(usage.rateLimitsList.length, 2);
  const premium = usage.rateLimitsList.find(r => r.limitId === 'premium');
  const general = usage.rateLimitsList.find(r => r.limitId === 'codex');
  assert.ok(premium);
  assert.ok(general);
  assert.equal(premium.primary.usedPercent, 75);
  assert.equal(general.primary.usedPercent, 42);
});

test('transcriptUsage parses Claude cost-state and per-turn context window usage', () => {
  const records = [
    {
      type: 'cost-state',
      totalCostUSD: 0.1852,
      modelUsage: { 'claude-sonnet': { costUSD: 0.1852 } }
    },
    {
      type: 'assistant',
      message: {
        model: 'claude-3-7-sonnet-20250219',
        usage: {
          input_tokens: 8200,
          cache_read_input_tokens: 14000,
          cache_creation_input_tokens: 1200,
          output_tokens: 1500
        }
      }
    }
  ];

  const usage = transcriptUsage(records, 'claude', 'claude-3-7-sonnet');
  assert.ok(usage);
  assert.equal(usage.agent, 'claude');
  assert.equal(usage.tokens.input, 8200);
  assert.equal(usage.tokens.cached, 15200);
  assert.equal(usage.tokens.output, 1500);
  assert.equal(usage.tokens.current, 8200 + 15200 + 1500);
  assert.equal(usage.tokens.contextWindow, 200000);
  assert.equal(usage.tokens.contextPercent, 12); // 24900 / 200000 = 12.45% -> 12%
  assert.equal(usage.costUSD, 0.185);

  // When model is 1m context
  const usage1m = transcriptUsage(records, 'claude', 'claude-3-7-sonnet-1m');
  assert.equal(usage1m.tokens.contextWindow, 1000000);
  assert.equal(usage1m.tokens.contextPercent, 2);
});

test('Claude usage dates the last request and counts a later compaction as the context', () => {
  const reply = { type: 'assistant', timestamp: '2026-10-28T10:00:00.000Z', message: { usage: { input_tokens: 10, cache_read_input_tokens: 140000, cache_creation_input_tokens: 9000, output_tokens: 990 } } };
  const sidechain = { type: 'assistant', isSidechain: true, timestamp: '2026-10-28T10:05:00.000Z', message: { usage: { input_tokens: 5, output_tokens: 5 } } };
  const usage = transcriptUsage([reply, sidechain], 'claude', 'claude-opus-5-5');
  assert.equal(usage.at, reply.timestamp);
  assert.equal(usage.tokens.current, 150000);
  const compacted = transcriptUsage([reply, { type: 'system', subtype: 'compact_boundary', timestamp: '2026-10-28T10:30:00.000Z', compactMetadata: { trigger: 'manual', preTokens: 150000, postTokens: 26000 } }], 'claude', 'claude-opus-5-5');
  assert.equal(compacted.at, '2026-10-28T10:30:00.000Z');
  assert.equal(compacted.tokens.current, 26000);
  assert.equal(compacted.tokens.contextPercent, 13);
  // A reply after the compaction measures the context again.
  const next = { ...reply, timestamp: '2026-10-28T10:31:00.000Z', message: { usage: { input_tokens: 30000, output_tokens: 500 } } };
  const later = transcriptUsage([reply, { type: 'system', subtype: 'compact_boundary', timestamp: '2026-10-28T10:30:00.000Z', compactMetadata: { postTokens: 26000 } }, next], 'claude', 'claude-opus-5-5');
  assert.equal(later.at, next.timestamp);
  assert.equal(later.tokens.current, 30500);
});

test('transcriptUsage parses Antigravity PLANNER_RESPONSE tokens and exclusive models (Gemini 4, Opus, Astra)', () => {
  const records = [
    {
      type: 'USER_INPUT',
      content: 'Analyze the performance'
    },
    {
      type: 'PLANNER_RESPONSE',
      input_tokens: 154200,
      output_tokens: 4500,
      cache_read_tokens: 50000
    }
  ];

  const standard = transcriptUsage(records, 'antigravity', 'Gemini 3.8 Flash (High)');
  assert.ok(standard);
  assert.equal(standard.agent, 'antigravity');
  assert.equal(standard.tokens.input, 154200);
  assert.equal(standard.tokens.cached, 50000);
  assert.equal(standard.tokens.output, 4500);
  assert.equal(standard.tokens.current, 154200 + 4500);
  assert.equal(standard.tokens.contextWindow, 1048576);
  assert.equal(standard.tokens.contextPercent, 15);
  assert.equal(standard.rateLimitsList.length, 1);
  assert.equal(standard.rateLimitsList[0].isExclusive, false);

  // When model is exclusive Gemini 4
  const gemini4 = transcriptUsage(records, 'antigravity', 'Gemini 4 Pro');
  assert.equal(gemini4.rateLimitsList.length, 2);
  const exGemini4 = gemini4.rateLimitsList.find(r => r.isExclusive);
  assert.ok(exGemini4);
  assert.equal(exGemini4.limitName, 'Gemini 4');

  // When model is Opus
  const opus = transcriptUsage(records, 'antigravity', 'Claude 3.7 Sonnet / Opus');
  assert.equal(opus.rateLimitsList.length, 2);
  const exOpus = opus.rateLimitsList.find(r => r.isExclusive);
  assert.ok(exOpus);
  assert.equal(exOpus.limitName, 'Opus');

  // When model is Astra
  const astra = transcriptUsage(records, 'antigravity', 'Astra');
  assert.equal(astra.rateLimitsList.length, 2);
  const exAstra = astra.rateLimitsList.find(r => r.isExclusive);
  assert.ok(exAstra);
  assert.equal(exAstra.limitName, 'Astra');
});

test('readClaudeUtilization parses 5h, 7d and weekly_scoped models like Fable', async t => {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const home = await mkdtemp(path.join(root, '.cache', 'claude-quota-'));
  await writeFile(path.join(home, '.claude.json'), JSON.stringify({
    oauthAccount: { seatTier: 'pro' },
    cachedUsageUtilization: {
      fetchedAtMs: 1760000000000,
      utilization: {
        five_hour: { utilization: 25, resets_at: '2026-10-18T20:00:00Z' },
        seven_day: { utilization: 40, resets_at: '2026-10-25T20:00:00Z' },
        limits: [
          { kind: 'session', percent: 25, resets_at: '2026-10-18T20:00:00Z' },
          { kind: 'weekly_all', percent: 40, resets_at: '2026-10-25T20:00:00Z' },
          { kind: 'weekly_scoped', percent: 8, resets_at: '2026-10-25T20:00:00Z', scope: { model: { display_name: 'Fable' } } }
        ]
      }
    }
  }));

  const quota = await readClaudeUtilization({ CLAUDE_CONFIG_DIR: home }, home);
  assert.ok(quota);
  assert.equal(quota.rateLimitsList.length, 2);
  const general = quota.rateLimitsList.find(r => !r.isExclusive);
  const fable = quota.rateLimitsList.find(r => r.isExclusive);
  assert.ok(general);
  assert.ok(fable);
  assert.equal(general.primary.usedPercent, 25);
  assert.equal(general.secondary.usedPercent, 40);
  assert.equal(fable.limitName, 'Fable');
  assert.equal(fable.primary.usedPercent, 8);
});

async function claudeHome(t, projects) {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const home = await mkdtemp(path.join(root, '.cache', 'claude-home-'));
  await writeFile(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'test@example.com', seatTier: 'pro' }, projects: Object.fromEntries(projects.map(folder => [folder.replaceAll('\\', '/'), { allowedTools: [] }])) }));
  const prior = { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
  process.env.CLAUDE_CONFIG_DIR = home;
  t.after(() => { for (const [name, value] of Object.entries(prior)) if (value === undefined) delete process.env[name]; else process.env[name] = value; });
  return home;
}

test('GET /api/sessions/:id/stats includes usage from transcript and settings supports usageLimitMode and usageDirection', async t => {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const repo = await mkdtemp(path.join(root, '.cache', 'stats-usage-'));
  await mkdir(path.join(repo, 'ui'));
  await writeFile(path.join(repo, 'ui', 'index.html'), '<html></html>');
  await mkdir(path.join(repo, 'workspace'));
  await writeFile(path.join(repo, 'workspace', 'workspace.json'), '{"entities":[]}');

  const home = await claudeHome(t, [repo]);
  const service = await createService({ repo, uiDir: path.join(repo, 'ui') });
  t.after(() => service.close());

  const authHeader = { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' };

  // Verify settings update for usageLimitMode and usageDirection
  const setRes = await fetch(service.origin + '/api/settings', {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({ usageLimitMode: 'general', usageDirection: 'remaining' })
  });
  const updatedSettings = await setRes.json();
  assert.equal(updatedSettings.usageLimitMode, 'general');
  assert.equal(updatedSettings.usageDirection, 'remaining');

  // Create Claude transcript on disk
  const nativeId = randomUUID();
  const folder = path.join(home, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, `${nativeId}.jsonl`), [
    { type: 'cost-state', totalCostUSD: 0.145, modelUsage: {} },
    { type: 'user', uuid: 'u1', timestamp: '2026-10-15T10:00:00.000Z', message: { content: 'Calculate limits' } },
    { type: 'assistant', uuid: 'a1', timestamp: '2026-10-15T10:01:00.000Z', message: { id: 'm1', content: [{ type: 'text', text: 'Limits calculated' }], usage: { input_tokens: 4200, output_tokens: 800 } } }
  ].map(item => JSON.stringify(item)).join('\n') + '\n');

  // Import chat to get session
  const importRes = await fetch(service.origin + '/api/history/import', {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({ agent: 'claude', nativeId, name: 'Usage Test', cwd: repo })
  });
  const session = await importRes.json();

  const statsRes = await fetch(service.origin + `/api/sessions/${session.id}/stats`, {
    headers: authHeader
  });
  const stats = await statsRes.json();
  assert.ok(stats.usage);
  assert.equal(stats.usage.agent, 'claude');
  assert.equal(stats.usage.tokens.current, 5000);
  assert.equal(stats.usage.costUSD, 0.145);
});

// node --test workspace/2026-10-27_game-ui-studio/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDocument, flattenNodes, computeLayout, BACK_PREVIOUS } from '../model.mjs';
import { EDIT_TAG, MAX_OPS, buildPrompt, extractEdits, planEdit, promptContext, rejectionMessage, screenContext } from '../edits.mjs';

const fresh = () => createDefaultDocument('Bleeding Stars', 'projects/Bleeding Stars');
const byName = (doc, name, screenId = doc.activeScreen) => flattenNodes(doc.screens.find(s => s.id === screenId).elements).find(e => e.node.name === name)?.node;
const screenNamed = (doc, name) => doc.screens.find(s => s.name === name);

test('extractEdits separates prose from a gameui-edit block', () => {
  const reply = `Two buttons are missing.\n\n\`\`\`${EDIT_TAG}\n{"summary": "Add Load", "ops": [{"op": "remove", "id": "x"}]}\n\`\`\`\n\nApply it when ready.`;
  const { prose, blocks } = extractEdits(reply);
  assert.equal(prose, 'Two buttons are missing.\n\nApply it when ready.');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].edit.summary, 'Add Load');
});

test('extractEdits accepts a json fence with ops and keeps other code', () => {
  const reply = 'Code:\n```gdscript\nfunc _ready():\n\tpass\n```\nEdit:\n```json\n{"ops": [{"op": "remove", "id": "a"}]}\n```';
  const { prose, blocks } = extractEdits(reply);
  assert.equal(blocks.length, 1);
  assert.match(prose, /func _ready/);
  assert.doesNotMatch(prose, /"ops"/);
});

test('extractEdits reports invalid JSON and an unclosed block', () => {
  const bad = extractEdits(`\`\`\`${EDIT_TAG}\n{"ops": [}\n\`\`\``);
  assert.equal(bad.blocks.length, 1);
  assert.match(bad.blocks[0].error, /not valid JSON/);
  const cut = extractEdits(`Here it is:\n\`\`\`${EDIT_TAG}\n{"ops": [`);
  assert.equal(cut.prose, 'Here it is:');
  assert.match(cut.blocks[0].error, /not closed/);
  assert.equal(extractEdits('Just text, no changes.').blocks.length, 0);
});

test('screenContext is compact, carries ids, the selection and no embedded images', () => {
  const doc = fresh();
  const main = doc.screens[0];
  main.bgImage = 'data:image/png;base64,AAAA';
  const quit = byName(doc, 'BtnQuit');
  const ctx = screenContext(doc, main.id, quit.id, { issues: [{ screenId: main.id, title: 'Overlapping widgets', nodeName: 'BtnQuit' }] });
  assert.equal(ctx.screen.id, main.id);
  assert.deepEqual(ctx.screen.resolution, [1920, 1080]);
  assert.equal(ctx.screen.referenceImage, true);
  assert.equal(ctx.otherScreens.length, doc.screens.length - 1);
  const card = ctx.elements.find(e => e.name === 'MenuCard');
  const quitItem = card.children.find(e => e.name === 'BtnQuit');
  assert.deepEqual(quitItem.rect, [0, 95, 280, 50]);
  assert.equal(quitItem.props.text, 'Quit');
  assert.equal(quitItem.props.opacity, undefined, 'default props are left out');
  assert.deepEqual(quitItem.props.statesDefined, ['hover', 'pressed', 'focused', 'disabled']);
  assert.equal(quitItem.opens, screenNamed(doc, 'Confirmation Modal').id);
  assert.equal(ctx.selection.id, quit.id);
  assert.equal(ctx.selection.parent, byName(doc, 'MenuCard').id);
  assert.equal(ctx.selection.props.states.hover.borderColor, '#60a5fa');
  assert.deepEqual(ctx.checks, ['Overlapping widgets (BtnQuit)']);
  assert.doesNotMatch(JSON.stringify(ctx), /base64/);

  const prompt = buildPrompt('Make Quit red.', ctx);
  assert.ok(prompt.startsWith('Make Quit red.'));
  assert.match(prompt, new RegExp('```' + EDIT_TAG));
  assert.ok(prompt.includes(JSON.stringify(ctx)));
  assert.equal(buildPrompt('Plain', null), 'Plain');
});

test('promptContext drops props on very large screens', () => {
  const doc = fresh();
  const main = doc.screens[0];
  for (let i = 0; i < 260; i++) main.elements.push({ ...structuredClone(byName(doc, 'BtnQuit')), id: `b${i}`, name: `Extra${i}`, props: { ...byName(doc, 'BtnQuit').props, comment: 'x'.repeat(120) } });
  const ctx = promptContext(doc, main.id, null);
  assert.ok(ctx.note);
  assert.equal(ctx.elements.at(-1).props.text, 'Quit');
  assert.equal(ctx.elements.at(-1).props.comment, undefined);
});

test('planEdit applies add, update, remove, link and screen ops in order', () => {
  const doc = fresh();
  const before = JSON.stringify(doc);
  const main = doc.screens[0];
  const card = byName(doc, 'MenuCard');
  const quit = byName(doc, 'BtnQuit');
  const version = byName(doc, 'VersionLabel');
  const options = screenNamed(doc, 'Options Screen');
  const plan = planEdit(doc, {
    summary: 'Add Credits and make room',
    ops: [
      { op: 'update', id: card.id, set: { rect: { h: 430 } } },
      { op: 'add', parent: card.id, node: { id: 'BtnCredits', type: 'button', name: 'BtnCredits', anchor: 'center', rect: [0, 160, 280, 50], props: { text: 'Credits', bgColor: '#374151', comment: 'Rolls the credits.' } } },
      { op: 'link', from: 'BtnCredits', to: options.id },
      { op: 'update', id: quit.id, set: { props: { text: 'Quit to Desktop', fontSize: 15 } } },
      { op: 'remove', id: version.id },
      { op: 'screen', set: { notes: 'Credits added.', focusDefault: 'BtnCredits' } }
    ]
  });
  assert.equal(JSON.stringify(doc), before, 'the input document is not modified');
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.count, 6);
  assert.equal(plan.rejected, 0);
  assert.equal(plan.summary, 'Add Credits and make room');
  assert.equal(plan.screenId, main.id);
  const next = plan.doc;
  const credits = byName(next, 'BtnCredits');
  assert.equal(credits.id, 'BtnCredits');
  assert.equal(credits.nav.onConfirm, options.id);
  assert.equal(credits.props.text, 'Credits');
  assert.equal(credits.props.states.hover.bgColor !== '#2563eb', true, 'a custom fill gets matching hover shades');
  assert.equal(byName(next, 'MenuCard').children.at(-1).id, 'BtnCredits');
  assert.equal(byName(next, 'MenuCard').rect.h, 430);
  assert.equal(byName(next, 'BtnQuit').props.text, 'Quit to Desktop');
  assert.equal(byName(next, 'BtnQuit').props.bgColor, '#374151', 'props merge');
  assert.equal(byName(next, 'VersionLabel'), undefined);
  assert.equal(next.screens[0].notes, 'Credits added.');
  assert.equal(next.screens[0].focus.default, 'BtnCredits');
  assert.deepEqual(plan.marks.added, ['BtnCredits']);
  assert.deepEqual(plan.marks.removed, [version.id]);
  assert.deepEqual(new Set(plan.marks.updated), new Set([card.id, quit.id]));
  assert.equal(plan.marks.screen, true);
  assert.match(plan.results[0].detail, /h 360 → 430/);
});

test('rejected ops change nothing, are explained and later ops still apply', () => {
  const doc = fresh();
  const quit = byName(doc, 'BtnQuit');
  const title = byName(doc, 'GameTitle');
  const plan = planEdit(doc, {
    ops: [
      { op: 'update', id: quit.id, set: { name: 'BtnExit', props: { bgColor: 'reddish!' } } },
      { op: 'update', id: 'BtnSettings', set: { props: { text: 'Settings' } } },
      { op: 'add', node: { type: 'sprite', name: 'Logo' } },
      { op: 'add', node: { type: 'label', name: 'Hint', anchor: 'middle', rect: [0, 0, 100, 20] } },
      { op: 'add', node: { type: 'label', name: 'Hint', rect: [0, 0, 100] } },
      { op: 'add', node: { type: 'label', name: 'Hint', props: { checked: true } } },
      { op: 'add', node: { id: quit.id, type: 'label', name: 'Copy' } },
      { op: 'link', from: title.id, to: BACK_PREVIOUS },
      { op: 'link', from: quit.id, to: 'screen_nowhere' },
      { op: 'screen', set: { focusOrder: [title.id] } },
      { op: 'teleport', id: quit.id },
      { op: 'update', id: quit.id, set: { props: { text: 'Exit' } } }
    ]
  });
  assert.equal(plan.count, 1);
  assert.equal(plan.rejected, 11);
  const errors = plan.results.filter(r => !r.ok).map(r => r.error);
  assert.match(errors[0], /props\.bgColor must be a colour/);
  assert.match(errors[1], /"BtnSettings" is not on Main Menu/);
  assert.match(errors[2], /node\.type must be one of panel, button/);
  assert.match(errors[3], /node\.anchor must be one of/);
  assert.match(errors[4], /rect must be \[x, y, w, h\]/);
  assert.match(errors[5], /A label has no "checked" prop/);
  assert.match(errors[6], /already used/);
  assert.match(errors[7], /only buttons, inputs, toggles/);
  assert.match(errors[8], /does not exist/);
  assert.match(errors[9], /cannot take focus/);
  assert.match(errors[10], /Unknown op "teleport"/);
  const next = byName(plan.doc, 'BtnQuit');
  assert.equal(next.name, 'BtnQuit', 'a rejected op leaves no partial change');
  assert.equal(next.props.bgColor, '#374151');
  assert.equal(next.props.text, 'Exit');
  assert.match(rejectionMessage(plan), /op 2 \(update BtnSettings\)/);
});

test('ops can depend on elements added earlier in the same edit', () => {
  const doc = fresh();
  const plan = planEdit(doc, {
    ops: [
      { op: 'add', node: { id: 'CreditsPanel', type: 'panel', name: 'CreditsPanel', anchor: 'bottom-left', rect: [96, -54, 300, 120] } },
      { op: 'add', parent: 'CreditsPanel', index: 0, node: { type: 'label', name: 'CreditsText', rect: [12, 12, 200, 24], props: { text: 'Made by you' } } },
      { op: 'add', parent: 'NotThere', node: { type: 'label', name: 'Lost' } }
    ]
  });
  assert.equal(plan.count, 2);
  assert.equal(byName(plan.doc, 'CreditsPanel').children[0].name, 'CreditsText');
  assert.match(plan.results[2].error, /Parent "NotThere"/);
  assert.equal(plan.marks.added.length, 2);
});

test('an anchor change without a rect keeps the on-screen box', () => {
  const doc = fresh();
  const version = byName(doc, 'VersionLabel');
  const main = doc.screens[0];
  const box = computeLayout(main).get(version.id).box;
  const plan = planEdit(doc, { ops: [{ op: 'update', id: version.id, set: { anchor: 'top-left' } }] });
  const next = byName(plan.doc, 'VersionLabel');
  assert.equal(next.anchor, 'top-left');
  assert.deepEqual(computeLayout(plan.doc.screens[0]).get(version.id).box, box);
});

test('a no-op update is reported but not counted', () => {
  const doc = fresh();
  const quit = byName(doc, 'BtnQuit');
  const plan = planEdit(doc, { ops: [{ op: 'update', id: quit.id, set: { props: { text: 'Quit' } } }] });
  assert.equal(plan.count, 0);
  assert.equal(plan.ok, false);
  assert.equal(plan.results[0].noop, true);
});

test('top-level problems reject the whole edit', () => {
  const doc = fresh();
  assert.match(planEdit(doc, null).errors[0], /JSON object/);
  assert.match(planEdit(doc, { ops: [] }).errors[0], /no "ops"/);
  assert.match(planEdit(doc, { ops: Array.from({ length: MAX_OPS + 1 }, () => ({ op: 'remove', id: 'x' })) }).errors[0], /up to 40/);
  assert.match(planEdit(doc, { screen: 'Credits', ops: [{ op: 'remove', id: 'x' }] }).errors[0], /Screen "Credits" does not exist/);
});

test('the screen can be named instead of its id; link and back targets are checked', () => {
  const doc = fresh();
  const pause = screenNamed(doc, 'Pause Menu');
  const resume = byName(doc, 'BtnResume', pause.id);
  const plan = planEdit(doc, {
    screen: 'Pause Menu',
    ops: [
      { op: 'screen', set: { onBack: 'Main Menu', role: 'modal' } },
      { op: 'screen', set: { onBack: pause.id } },
      { op: 'update', id: resume.id, set: { opens: BACK_PREVIOUS, rect: { y: -70 } } },
      { op: 'update', id: resume.id, set: { props: { states: { focused: { ringColor: '#ffcc00' }, pressed: null } } } }
    ]
  });
  assert.equal(plan.screenId, pause.id);
  assert.equal(plan.count, 3);
  assert.match(plan.results[1].error, /cannot be Pause Menu itself/);
  const next = plan.doc.screens.find(s => s.id === pause.id);
  assert.equal(next.nav.onBack, doc.screens[0].id);
  assert.equal(next.role, 'modal');
  const r = byName(plan.doc, 'BtnResume', pause.id);
  assert.equal(r.nav.onConfirm, BACK_PREVIOUS);
  assert.equal(r.rect.y, -70);
  assert.equal(r.props.states.focused.ringColor, '#ffcc00');
  assert.equal(r.props.states.focused.borderColor, '#ffffff', 'state fields merge');
  assert.equal(r.props.states.pressed, undefined);
});

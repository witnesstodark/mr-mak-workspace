import test from 'node:test';
import assert from 'node:assert/strict';
import { validarCatalogo, validarAjustes } from '../catalogo-dados.mjs';
import { gerar } from '../modulos/catalogo.mjs';

const data = () => ({ projeto: 'suite', grupos: [{ id: 'fauna', nome: 'Fauna', resumo: 'Animais', estado: 'Local', imagem: 'media/fauna/resumo.webp', itens: [
  { id: 'fauna:pato', nome: 'Pato', tipo: 'Criatura', estado: 'Local', imagem: 'media/fauna/pato.webp', campos: [
    { id: 'vida', rotulo: 'Vida', tipo: 'numero', atual: 10, min: 1 },
    { id: 'domavel', rotulo: 'Domável', tipo: 'booleano', atual: false },
    { id: 'nota', rotulo: 'Descrição', tipo: 'texto', atual: null },
  ] },
] }] });
const change = patch => ({ formato: 'mak-catalogo-ajustes', versao: 1, projeto: 'suite', alteracoes: [{ grupo: 'fauna', item: 'fauna:pato', campo: 'vida', atual: 10, proposto: 12, ...patch }] });

test('accepts explicit current values and undefined planned attributes', () => assert.deepEqual(validarCatalogo(data()), []));
test('rejects duplicate IDs, invalid image paths and current values', () => {
  for (const mutate of [d => d.grupos.push(d.grupos[0]), d => d.grupos[0].itens.push(d.grupos[0].itens[0]), d => d.grupos[0].itens[0].imagem = '../secret.png', d => d.grupos[0].itens[0].campos[0].atual = NaN]) {
    const d = data(); mutate(d); assert.ok(validarCatalogo(d).length);
  }
});
test('export/import preserves numeric, boolean and undefined types', () => {
  const a = change({}); a.alteracoes.push({ grupo: 'fauna', item: 'fauna:pato', campo: 'domavel', atual: false, proposto: true });
  a.alteracoes.push({ grupo: 'fauna', item: 'fauna:pato', campo: 'nota', atual: null, proposto: '<script>not code</script>' });
  assert.equal(validarAjustes(JSON.parse(JSON.stringify(a)), data()).alteracoes[0].proposto, 12);
});
test('rejects stale references, foreign projects, unknown fields, wrong types and unsafe numbers', () => {
  for (const a of [change({ atual: 9 }), change({ campo: 'unknown' }), change({ proposto: '12' }), change({ proposto: -1 }), change({ proposto: Infinity }), { ...change({}), projeto: 'outro' }]) {
    assert.throws(() => validarAjustes(a, data()));
  }
  const duplicate = change({}); duplicate.alteracoes.push(duplicate.alteracoes[0]); assert.throws(() => validarAjustes(duplicate, data()));
});
test('HTML escapes names and safely embeds JSON containing closing script tags', () => {
  const d = data(); d.grupos[0].itens[0].nome = '<script>alert(1)</script>';
  d.grupos[0].itens[0].campos[2].atual = '</script><img src=x onerror=alert(1)>';
  const esc = x => String(x).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const html = gerar(d, { projeto: { id: 'suite' }, aba: { nome: 'Mods' }, engine: '../_shared/engine', texto: esc, pagina: x => x.corpo });
  assert.ok(html.includes('&lt;script&gt;alert(1)'));
  assert.ok(!html.includes('</script><img'));
  assert.ok(html.includes('\\u003c/script>'));
});

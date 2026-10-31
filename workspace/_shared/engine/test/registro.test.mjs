// Registro: só o próprio card muda, o arquivo é relido antes de gravar e nada é gravado sem necessidade.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { atualizarRegistro, aplicarCampos } from '../nucleo/registro.mjs';
import { pastaTemporaria, limparTemporarias } from './ajudas.mjs';

after(limparTemporarias);

const outro = { id: 'outro', title: 'Outro', steps: [{ name: 'X', path: 'x.html' }], updated: '2026-01-01', pinned: true };
const meu = { id: 'meu', title: 'Meu', folder: 'meu', updated: '2026-10-01', steps: [{ name: 'Velho', path: 'velho.html' }], defaultStep: 0 };
const campos = { updated: '2026-10-17', steps: [{ name: 'Painel', path: 'painel.html' }, { name: 'Riscos', path: 'riscos.html' }], cover: 'media/capa.webp', progress: { done: 2, total: 5, label: 'tarefas' }, phase: 'Fase 1' };

function criar(entities, eol = '\n') {
  const arquivo = join(pastaTemporaria(), 'workspace.json');
  writeFileSync(arquivo, (JSON.stringify({ entities }, null, 2) + '\n').replace(/\n/g, eol));
  return arquivo;
}
const ler = arquivo => JSON.parse(readFileSync(arquivo, 'utf8'));

test('grava updated, steps, cover, progress e phase só no próprio card', () => {
  const arquivo = criar([outro, meu]);
  assert.equal(atualizarRegistro(arquivo, 'meu', campos), 'gravado');
  const dados = ler(arquivo);
  assert.deepEqual(dados.entities[0], outro, 'o outro card fica idêntico');
  const card = dados.entities[1];
  assert.equal(card.updated, '2026-10-17');
  assert.deepEqual(card.steps.map(s => s.name), ['Painel', 'Riscos'], 'na ordem das abas');
  assert.equal(card.cover, 'media/capa.webp');
  assert.deepEqual(card.progress, { done: 2, total: 5, label: 'tarefas' });
  assert.equal(card.phase, 'Fase 1');
  assert.equal(card.title, 'Meu');
  assert.equal(card.defaultStep, 0);
});

test('não regrava o arquivo quando nada mudou', async () => {
  const arquivo = criar([outro, { ...meu, ...campos }]);
  const antes = statSync(arquivo).mtimeMs;
  await new Promise(r => setTimeout(r, 30));
  assert.equal(atualizarRegistro(arquivo, 'meu', campos), 'sem-mudanca');
  assert.equal(statSync(arquivo).mtimeMs, antes);
});

test('remove cover, progress e phase quando o projeto deixa de ter', () => {
  const arquivo = criar([{ ...meu, ...campos }]);
  atualizarRegistro(arquivo, 'meu', { updated: '2026-10-17', steps: campos.steps });
  const card = ler(arquivo).entities[0];
  assert.ok(!('cover' in card) && !('progress' in card) && !('phase' in card));
});

test('relê antes de gravar: a mudança que outro agente fez no meio não se perde', () => {
  const arquivo = criar([outro, meu]);
  let chamadas = 0;
  const estado = atualizarRegistro(arquivo, 'meu', campos, {
    aoLer: n => {
      chamadas++;
      if (n === 0) { // outro agente grava entre a leitura e a escrita do motor
        const dados = ler(arquivo);
        dados.entities.push({ id: 'novo', title: 'Card de outro agente', steps: [] });
        dados.entities[0].updated = '2026-10-17';
        writeFileSync(arquivo, JSON.stringify(dados, null, 2) + '\n');
      }
    },
  });
  assert.equal(estado, 'gravado');
  assert.equal(chamadas, 2, 'releu o arquivo depois que ele mudou');
  const dados = ler(arquivo);
  assert.deepEqual(dados.entities.map(c => c.id), ['outro', 'meu', 'novo']);
  assert.equal(dados.entities[0].updated, '2026-10-17', 'a edição do outro agente continua lá');
  assert.equal(dados.entities[1].phase, 'Fase 1');
});

test('desiste com erro claro se o arquivo não para de mudar', () => {
  const arquivo = criar([meu]);
  assert.throws(() => atualizarRegistro(arquivo, 'meu', campos, {
    tentativas: 3,
    aoLer: () => { const d = ler(arquivo); d.contador = (d.contador ?? 0) + 1; writeFileSync(arquivo, JSON.stringify(d, null, 2) + '\n'); },
  }), /workspace\.json mudou durante a gravação/);
});

test('card inexistente: não cria nada', () => {
  const arquivo = criar([outro]);
  const antes = readFileSync(arquivo, 'utf8');
  assert.equal(atualizarRegistro(arquivo, 'meu', campos), 'sem-card');
  assert.equal(readFileSync(arquivo, 'utf8'), antes);
});

test('preserva o fim de linha CRLF do arquivo', () => {
  const arquivo = criar([meu], '\r\n');
  atualizarRegistro(arquivo, 'meu', campos);
  const texto = readFileSync(arquivo, 'utf8');
  assert.ok(texto.includes('\r\n') && !/[^\r]\n/.test(texto));
});

test('aplicarCampos devolve false quando já está igual', () => {
  const card = { ...meu, ...campos };
  assert.equal(aplicarCampos(card, campos), false);
  assert.equal(aplicarCampos(card, { ...campos, phase: 'Fase 2' }), true);
});

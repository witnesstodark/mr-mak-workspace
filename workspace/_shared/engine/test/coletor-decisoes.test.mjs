// Coletor da aba Decisões (coletores/decisoes-md.mjs) e os campos opcionais da aba (resumo, notas, fonte).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lerRegistro, montarDecisoes, classificarEstado, comprimirCodigos, coletar } from '../coletores/decisoes-md.mjs';
import { validar, gerar } from '../modulos/decisoes.mjs';

const REGISTRO = `# Registro de decisões

Status: **Confirmado** · **Pendente**.

## Objetivo e visão
| # | Decisão | Valor atual | Status |
|---|---|---|---|
| V1 | Objetivo do projeto | Jogo **comercial**, ver [handout](x.md) | Confirmado (2026-10-09) |
| V2 | Nome | Global Empires \\| GE | Confirmado (2026-10-09; mudado em 2026-10-10) |

| V3 | Linha depois de uma linha em branco | continua a tabela | Pendente |

### Pesquisas (tabela sem código)
| Pesquisa | Era | Efeito | Estado |
|---|---|---|---|
| Vagonetes | Industrial | Mais metal | Nome Confirmado |

## Ajustes do playtest
| Código | Assunto | Decisão | Status |
|---|---|---|---|
| J1 | Ataque | Ondas maiores | Pendente; o resto segue |
| J2 | Defesa | Base de 60 m | ✅ aprovado |
| J3 | Rendição | Antiga | Substituído pelo J4 (2026-10-15) |
| J4 | Rendição nova | No colapso | Em aberto |
| M8a | Unidades | Trabalhador | Confirmada |
`;

test('classifica o estado com variações de escrita', () => {
  assert.equal(classificarEstado('Confirmado (2026-10-09)'), 'Confirmada');
  assert.equal(classificarEstado('**Confirmada**'), 'Confirmada');
  assert.equal(classificarEstado('✅ aprovado'), 'Confirmada');
  assert.equal(classificarEstado('Pendente; substituído pela ferramenta'), 'Pendente');
  assert.equal(classificarEstado('Em aberto'), 'Pendente');
  assert.equal(classificarEstado('Substituído pela H16 (2026-10-13); antes, Confirmado'), null);
  assert.equal(classificarEstado('Mudado pelo H39'), null);
});

test('lê as tabelas, ignora linhas sem código e separa as substituídas', () => {
  const r = lerRegistro(REGISTRO);
  assert.deepEqual(r.decisoes.map(d => d.id), ['V1', 'V2', 'V3', 'J1', 'J2', 'J4', 'M8a']);
  assert.deepEqual(r.fora.map(f => f.id), ['J3']);
  const v1 = r.decisoes[0];
  assert.equal(v1.titulo, 'Objetivo do projeto');
  assert.equal(v1.nota, 'Jogo comercial, ver handout');
  assert.equal(v1.data, '2026-10-09');
  assert.equal(r.decisoes[1].nota, 'Global Empires | GE');
  assert.equal(r.decisoes[2].secao, 'Objetivo e visão', 'a linha depois da linha em branco continua a tabela da seção');
  const j1 = r.decisoes.find(d => d.id === 'J1');
  assert.equal(j1.titulo, 'Ataque', 'com Assunto, o título é o assunto');
  assert.equal(j1.nota, 'Ondas maiores');
  assert.equal(j1.estado, 'Pendente');
});

test('comprime códigos seguidos do mesmo prefixo', () => {
  assert.equal(comprimirCodigos(['J12', 'J13', 'J14', 'J20', 'M8a', 'CB5', 'CB6']), 'J12–J14, J20, M8a, CB5–CB6');
  assert.equal(comprimirCodigos([]), '');
});

test('sem agrupamento, o tema é a seção do registro', () => {
  const { dados } = montarDecisoes(lerRegistro(REGISTRO), { fonte: 'decisoes.md', hoje: '2026-10-17' });
  assert.deepEqual(dados.temas.map(t => t.nome), ['Objetivo e visão', 'Ajustes do playtest']);
  assert.deepEqual(dados.coletor.contagem, { confirmadas: 4, pendentes: 3, fora: 1 });
  assert.match(dados.fonte, /decisoes\.md, coletado em 2026-10-17: 4 confirmadas e 3 pendentes; 1 linhas? substituídas.*\(J3\)/);
  assert.deepEqual(dados.espera, [
    { titulo: 'Objetivo e visão (1)', texto: 'V3' },
    { titulo: 'Ajustes do playtest (2)', texto: 'J1, J4' },
  ]);
  assert.deepEqual(validar(dados), []);
});

test('com agrupamento por prefixo: ordem da lista, códigos avulsos, resumo e notas preservados', () => {
  const anterior = {
    coletor: { agrupamento: [
      { nome: 'IA', prefixos: ['J'], resumo: 'O que vale da IA' },
      { nome: 'Visão', prefixos: ['V'], codigos: ['J2'] },
    ] },
    notas: ['Anotação local'],
    temas: [{ nome: 'velho', decisoes: [] }],
  };
  const { dados, avisos } = montarDecisoes(lerRegistro(REGISTRO), { anterior });
  assert.deepEqual(dados.temas.map(t => t.nome), ['IA', 'Visão', 'Outros']);
  assert.deepEqual(dados.temas[0].decisoes.map(d => d.id), ['J1', 'J4']);
  assert.equal(dados.temas[0].resumo, 'O que vale da IA');
  assert.deepEqual(dados.temas[1].decisoes.map(d => d.id), ['J2', 'V1', 'V2', 'V3']);
  assert.deepEqual(dados.temas[2].decisoes.map(d => d.id), ['M8a']);
  assert.match(avisos.join('\n'), /prefixos sem tema.*M/);
  assert.deepEqual(dados.notas, ['Anotação local']);
  assert.deepEqual(dados.coletor.agrupamento, anterior.coletor.agrupamento);
  assert.deepEqual(validar(dados), []);
});

test('CLI: reescreve o arquivo e mantém o que é do agente', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'coletor-'));
  try {
    const md = join(pasta, 'decisoes.md'), saida = join(pasta, 'decisoes.json');
    writeFileSync(md, REGISTRO);
    writeFileSync(saida, JSON.stringify({ coletor: { fonteRotulo: 'repo/decisoes.md', agrupamento: [{ nome: 'Tudo', prefixos: ['V', 'J', 'M'] }] }, notas: [{ titulo: 'Nota', texto: 'fica' }] }));
    coletar(md, saida, { hoje: '2026-10-17' });
    const j = JSON.parse(readFileSync(saida, 'utf8'));
    assert.equal(j.temas.length, 1);
    assert.equal(j.temas[0].decisoes.length, 7);
    assert.match(j.fonte, /^repo\/decisoes\.md, coletado em 2026-10-17/);
    assert.deepEqual(j.notas, [{ titulo: 'Nota', texto: 'fica' }]);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test('aba Decisões: resumo por tema, notas e fonte aparecem; listas começam fechadas com resumo', () => {
  const dados = {
    fonte: 'repo/decisoes.md, coletado em 2026-10-17',
    temas: [{ nome: 'IA', resumo: 'Vale `isto`', decisoes: [{ id: 'J1', titulo: 'a', estado: 'Pendente' }, { id: 'J2', titulo: 'b', estado: 'Confirmada' }] }],
    espera: [{ titulo: 'IA (1)', texto: 'J1' }],
    notas: [{ titulo: 'Áudio', texto: 'fora do registro' }],
  };
  assert.deepEqual(validar(dados), []);
  const ctx = {
    projeto: { titulo: 'P' }, hoje: '2026-10-17', aba: { nome: 'Decisões' },
    dataLonga: d => d, pagina: o => o.corpo,
  };
  const html = gerar(dados, ctx);
  assert.match(html, /Resumo por tema/);
  assert.match(html, /Vale <code>isto<\/code>/);
  assert.match(html, /J1–J2/);
  assert.match(html, /Anotações fora do registro/);
  assert.match(html, /Fonte: repo\/decisoes\.md/);
  assert.doesNotMatch(html, /<details open>/);
  assert.match(validar({ temas: [], notas: [3] }).join(), /"notas" deve ser um texto/);
});

// O que o motor calcula: janela de 30 dias, progresso do roteiro e contador de riscos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { particionarEntregas, ordenarEntregas, calcularProgresso, contarRiscos, contarDecisoes, contarAchados, resolverReferencia } from '../nucleo/calculos.mjs';
import { somarDias, diaValido, dataLonga, diasEntre } from '../nucleo/datas.mjs';
import { acharCiclo } from '../modulos/roteiro.mjs';

// ---- datas e janela ----------------------------------------------------------------------------

test('datas: somar dias atravessa mês, ano e bissexto; validar calendário', () => {
  assert.equal(somarDias('2026-10-17', -30), '2026-09-17');
  assert.equal(somarDias('2024-03-01', -1), '2024-02-29');
  assert.equal(somarDias('2026-03-01', -1), '2026-02-28');
  assert.equal(somarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(diasEntre('2026-09-17', '2026-10-17'), 30);
  assert.ok(diaValido('2024-02-29'));
  assert.ok(!diaValido('2026-02-29'));
  assert.ok(!diaValido('2026-13-01'));
  assert.ok(!diaValido('2026-1-1'));
  assert.equal(dataLonga('2026-03-09'), '9 de março de 2026');
});

const e = (id, data) => ({ id, data, area: 'a', titulo: id, resumo: 'r', estado: 'main' });

test('janela de 30 dias: o dia do corte já é arquivo, o dia seguinte ainda é recente', () => {
  const lista = [e('velha', '2026-09-16'), e('corte', '2026-09-17'), e('primeira', '2026-09-18'), e('hoje', '2026-10-17')];
  const p = particionarEntregas(lista, '2026-10-17', 30);
  assert.equal(p.corte, '2026-09-17');
  assert.equal(p.desde, '2026-09-18');
  assert.deepEqual(p.recentes.map(x => x.id), ['hoje', 'primeira']);
  assert.deepEqual(p.antigas.map(x => x.id), ['corte', 'velha']);
});

test('janela: respeita janelaDias do projeto e a data de --hoje', () => {
  const lista = [e('a', '2026-10-10'), e('b', '2026-10-16'), e('c', '2026-10-17')];
  assert.deepEqual(particionarEntregas(lista, '2026-10-17', 7).recentes.map(x => x.id), ['c', 'b']);
  assert.deepEqual(particionarEntregas(lista, '2026-10-17', 7).antigas.map(x => x.id), ['a']);
  assert.equal(particionarEntregas(lista, '2026-11-20', 30).recentes.length, 0);
  assert.equal(particionarEntregas(lista, '2026-10-17', 30).antigas.length, 0);
  assert.equal(particionarEntregas([], '2026-10-17').recentes.length, 0);
});

test('ordem: dia mais novo primeiro; no mesmo dia, a última do arquivo aparece primeiro', () => {
  const lista = [e('x1', '2026-10-16'), e('y1', '2026-10-17'), e('y2', '2026-10-17'), e('x2', '2026-10-16')];
  assert.deepEqual(ordenarEntregas(lista).map(x => x.id), ['y2', 'y1', 'x2', 'x1']);
  assert.deepEqual(lista.map(x => x.id), ['x1', 'y1', 'y2', 'x2'], 'não muda a lista original');
});

// ---- progresso do roteiro ----------------------------------------------------------------------

const item = (id, estado, extra = {}) => ({ id, titulo: id, estado, ...extra });

test('progresso: conta os itens feitos da fase atual', () => {
  const r = calcularProgresso({ unidade: 'tarefas', fases: [
    { id: 'f0', nome: 'Fase 0', estado: 'feita', itens: [item('a', 'feito'), item('b', 'feito')] },
    { id: 'f1', nome: 'Fase 1', estado: 'atual', itens: [item('c', 'feito'), item('d', 'Em andamento'), item('e', 'a-fazer'), item('f', 'bloqueado'), item('g', 'feito')] },
    { id: 'f2', nome: 'Fase 2', estado: 'futura' },
  ] });
  assert.deepEqual(r.marco, { done: 2, total: 5, label: 'tarefas', escopo: 'fase' });
  assert.equal(r.texto, '2 de 5 tarefas');
  assert.equal(r.fase, 'Fase 1');
  assert.deepEqual(r.fases, { total: 3, feitas: 1, atual: { id: 'f1', nome: 'Fase 1' } });
  assert.deepEqual(r.itens, { total: 7, feitos: 4, emAndamento: 1, bloqueados: 1 });
});

test('progresso: fase atual sem itens usa as fases feitas', () => {
  const r = calcularProgresso({ fases: [
    { id: 'a', nome: 'A', estado: 'feita' }, { id: 'b', nome: 'B', estado: 'feita' }, { id: 'c', nome: 'C', estado: 'atual' }, { id: 'd', nome: 'D', estado: 'futura' }] });
  assert.deepEqual(r.marco, { done: 2, total: 4, label: 'fases', escopo: 'fases' });
  assert.equal(r.fase, 'C');
});

test('progresso: sem fase atual usa o roteiro inteiro; tudo feito dá 100%', () => {
  const r = calcularProgresso({ fases: [
    { id: 'a', nome: 'A', estado: 'feita', itens: [item('x', 'feito')] }, { id: 'b', nome: 'B', estado: 'feita', itens: [item('y', 'feito'), item('z', 'feito')] }] });
  assert.deepEqual(r.marco, { done: 3, total: 3, label: 'itens', escopo: 'roteiro' });
  assert.equal(r.fase, null);
  const novo = calcularProgresso({ fases: [{ id: 'a', nome: 'A', estado: 'futura', itens: [item('x', 'a-fazer')] }] });
  assert.deepEqual(novo.marco, { done: 0, total: 1, label: 'itens', escopo: 'roteiro' });
});

test('progresso: roteiro vazio não quebra', () => {
  assert.deepEqual(calcularProgresso({ fases: [] }).marco, { done: 0, total: 0, label: 'fases', escopo: 'fases' });
  assert.deepEqual(calcularProgresso(undefined).marco, { done: 0, total: 0, label: 'fases', escopo: 'fases' });
});

test('dependências: acha o ciclo e ignora cadeia sem ciclo', () => {
  assert.deepEqual(acharCiclo([{ id: 'A', depende: ['B'] }, { id: 'B', depende: ['C'] }, { id: 'C', depende: ['A'] }]), ['A', 'B', 'C', 'A']);
  assert.equal(acharCiclo([{ id: 'A', depende: ['B'] }, { id: 'B', depende: ['C'] }, { id: 'C' }]), null);
  assert.equal(acharCiclo([{ id: 'A', depende: ['B', 'C'] }, { id: 'B', depende: ['C'] }, { id: 'C' }]), null, 'dependência em losango não é ciclo');
});

// ---- riscos, decisões, playtest ----------------------------------------------------------------

const risco = (id, severidade, estado) => ({ id, titulo: id, severidade, fase: 'F1', dono: 'x', fechaCom: 'y', estado });

test('riscos: o contador vem da lista (o caso "9 contra 11")', () => {
  const lista = [
    ...Array.from({ length: 7 }, (_, i) => risco(`A${i}`, i < 2 ? 'alta' : i < 5 ? 'Média' : 'baixa', 'aberto')),
    risco('M1', 'media', 'Mitigando'), risco('M2', 'alta', 'mitigando'),
    risco('F1', 'alta', 'fechado'), risco('F2', 'baixa', 'FECHADO'),
  ];
  const c = contarRiscos(lista);
  assert.equal(c.total, 11);
  assert.equal(c.abertos, 9, 'aberto = tudo que não está fechado');
  assert.equal(c.fechados, 2);
  assert.deepEqual(c.porEstado, { aberto: 7, mitigando: 2, fechado: 2 });
  assert.deepEqual(c.abertosPorSeveridade, { alta: 3, media: 4, baixa: 2 });
});

test('riscos: lista vazia e valor ausente', () => {
  assert.equal(contarRiscos([]).abertos, 0);
  assert.equal(contarRiscos(undefined).total, 0);
});

test('decisões e achados: totais por tema e abertos da iteração', () => {
  const c = contarDecisoes({ temas: [
    { nome: 'A', decisoes: [{ id: '1', estado: 'Confirmada' }, { id: '2', estado: 'Pendente' }] },
    { nome: 'B', decisoes: [{ id: '3', estado: 'pendente' }] }], espera: ['x', 'y'] });
  assert.deepEqual([c.total, c.pendentes, c.confirmadas, c.espera], [3, 2, 1, 2]);
  assert.deepEqual(c.porTema.map(t => t.pendentes), [1, 1]);
  assert.deepEqual(contarAchados({ achados: [{ estado: 'aberto' }, { estado: 'em correção' }, { estado: 'corrigido' }, { estado: 'descartado' }] }), { total: 4, abertos: 2, resolvidos: 2 });
});

test('referências do painel: usam as mesmas funções das abas', () => {
  const fontes = { hoje: '2026-10-17', janelaDias: 30,
    riscos: { riscos: [risco('R1', 'alta', 'aberto'), risco('R2', 'baixa', 'fechado')] },
    roteiro: { unidade: 'tarefas', fases: [{ id: 'f', nome: 'Fase 1', estado: 'atual', itens: [item('a', 'feito'), item('b', 'a-fazer')] }] },
    entregas: { entregas: [e('a', '2026-10-17'), e('b', '2026-01-01')] } };
  assert.equal(resolverReferencia('@riscos.abertos', fontes).valor, 1);
  assert.equal(resolverReferencia('@riscos.total', fontes).valor, 2);
  assert.equal(resolverReferencia('@roteiro.progresso', fontes).valor, '1 de 2 tarefas');
  assert.equal(resolverReferencia('@roteiro.fase', fontes).valor, 'Fase 1');
  assert.equal(resolverReferencia('@entregas.recentes', fontes).valor, 1);
  assert.equal(resolverReferencia('@entregas.arquivadas', fontes).valor, 1);
  assert.match(resolverReferencia('@decisoes.pendentes', fontes).erro, /precisa de decisoes\.json/);
  assert.match(resolverReferencia('@foo.bar', fontes).erro, /desconhecida/);
});

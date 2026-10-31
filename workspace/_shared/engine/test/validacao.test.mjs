// Validação: mensagens claras para dados ruins, em cada módulo e em projeto.json.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { validar as validarEntregas } from '../modulos/entregas.mjs';
import { validar as validarRoteiro } from '../modulos/roteiro.mjs';
import { validar as validarRiscos } from '../modulos/riscos.mjs';
import { validar as validarDecisoes } from '../modulos/decisoes.mjs';
import { validar as validarPlaytest } from '../modulos/playtest.mjs';
import { validar as validarPipeline } from '../modulos/pipeline.mjs';
import { validar as validarMetricas } from '../modulos/metricas.mjs';
import { validar as validarPainel } from '../modulos/painel.mjs';
import { validarProjeto } from '../nucleo/projeto.mjs';
import { normalizarResultado } from '../nucleo/validacao.mjs';
import { pastaTemporaria, limparTemporarias, escrever, imagemPequena, imagemGrande, contexto, entrega, PROJETO_BASE } from './ajudas.mjs';

after(limparTemporarias);
const erros = (mod, dados, ctx) => normalizarResultado(mod(dados, ctx)).erros;
const tem = (lista, trecho) => assert.ok(lista.some(m => m.includes(trecho)), `esperava uma mensagem com "${trecho}"; veio:\n${lista.join('\n')}`);

test('entregas: dados bons passam', () => {
  const pasta = escrever(pastaTemporaria(), { 'media/2026-10/a.webp': imagemPequena() });
  const dados = { entregas: [entrega({ miniaturas: ['media/2026-10/a.webp'], links: [{ rotulo: 'Handout (PDF)', url: 'https://x.org/a.pdf' }], refs: ['#1'] })] };
  assert.deepEqual(erros(validarEntregas, dados, contexto(pasta)), []);
});

test('entregas: falta de campo, id repetido e resumo longo dão mensagens com o número e o id da entrega', () => {
  const ctx = contexto(pastaTemporaria());
  const dados = { entregas: [entrega({ resumo: undefined }), entrega({ titulo: '  ' }), entrega({ id: 'e3', resumo: 'x'.repeat(281) })] };
  const e = erros(validarEntregas, dados, ctx);
  tem(e, 'entrega 1 (e1): falta "resumo"');
  tem(e, 'entrega 2 (e1): falta "titulo"');
  tem(e, 'id repetido: e1');
  tem(e, 'entrega 3 (e3): resumo com mais de 280 caracteres');
});

test('entregas: data fora do calendário, área e estado desconhecidos', () => {
  const ctx = contexto(pastaTemporaria());
  const e = erros(validarEntregas, { entregas: [
    entrega({ id: 'a', data: '2026-02-31' }), entrega({ id: 'b', data: '17/10/2026' }),
    entrega({ id: 'c', area: 'cozinha' }), entrega({ id: 'd', estado: 'talvez' }),
  ] }, ctx);
  tem(e, 'entrega 1 (a): data "2026-02-31" não é uma data AAAA-MM-DD válida');
  tem(e, 'entrega 2 (b): data "17/10/2026" não é uma data AAAA-MM-DD válida');
  tem(e, 'entrega 3 (c): área "cozinha" fora de código, arte');
  tem(e, 'entrega 4 (d): estado "talvez" fora de main, main local, branch local, PR aberto');
});

test('entregas: só links para PDF', () => {
  const ctx = contexto(pastaTemporaria());
  const e = erros(validarEntregas, { entregas: [
    entrega({ id: 'a', links: [{ rotulo: 'Repo', url: 'https://github.com/x/y' }] }),
    entrega({ id: 'b', links: [{ rotulo: '', url: 'https://x.org/a.pdf' }] }),
    entrega({ id: 'c', links: [{ rotulo: 'Local', url: 'http://x.org/a.pdf' }] }),
  ] }, ctx);
  assert.equal(e.filter(m => m.includes('link só para PDF')).length, 3);
});

test('entregas: miniatura inexistente, grande demais, fora de media/ ou saindo da pasta', () => {
  const pasta = escrever(pastaTemporaria(), { 'media/2026-10/grande.webp': imagemGrande(), 'fora.webp': imagemPequena() });
  const e = erros(validarEntregas, { entregas: [
    entrega({ id: 'a', miniaturas: ['media/2026-10/nao-existe.webp'] }),
    entrega({ id: 'b', miniaturas: ['media/2026-10/grande.webp'] }),
    entrega({ id: 'c', miniaturas: ['fora.webp'] }),
    entrega({ id: 'd', miniatura: '../x/media/a.webp' }),
    entrega({ id: 'f', miniaturas: ['media/a.gif'] }),
  ] }, contexto(pasta));
  tem(e, 'arquivo não existe: media/2026-10/nao-existe.webp');
  tem(e, 'acima de 150 KB');
  tem(e, 'deve ficar em media/');
  tem(e, 'não pode sair da pasta do card');
  tem(e, 'deve ser webp, jpg, jpeg, png');
});

test('entregas: aceita o campo antigo "miniatura" do Global Empires e várias miniaturas', () => {
  const pasta = escrever(pastaTemporaria(), { 'media/2026-10/a.webp': imagemPequena(), 'media/2026-10/b.webp': imagemPequena(), 'media/2026-10/c.webp': imagemPequena() });
  const dados = { entregas: [entrega({ id: 'a', miniatura: 'media/2026-10/a.webp' }), entrega({ id: 'b', miniaturas: ['media/2026-10/b.webp', { arquivo: 'media/2026-10/c.webp', legenda: 'Vista' }, 'media/2026-10/a.webp'] })] };
  assert.deepEqual(erros(validarEntregas, dados, contexto(pasta)), []);
});

test('entregas: aviso quando há entregas antigas e nenhuma aba arquivo', () => {
  const projeto = { abas: [{ modulo: 'painel', nome: 'Painel' }, { modulo: 'entregas', nome: 'Entregas' }] };
  const r = normalizarResultado(validarEntregas({ entregas: [entrega({ data: '2026-01-02' })] }, contexto(pastaTemporaria(), projeto)));
  assert.deepEqual(r.erros, []);
  assert.equal(r.avisos.length, 1);
  tem(r.avisos, 'não aparece em nenhuma aba');
});

test('projeto.json: id, tema custom sem CSS, abas vazias ou repetidas, cor e janela inválidas', () => {
  const pasta = pastaTemporaria();
  const { erros: e } = validarProjeto({ id: 'Meu Projeto', titulo: 'X', destaque: 'vermelho', tema: 'custom', janelaDias: 0, abas: [] }, pasta);
  tem(e, 'id "Meu Projeto" deve ter só minúsculas');
  tem(e, 'destaque "vermelho" deve ser uma cor em hexadecimal');
  tem(e, 'tema custom pede "temaCss"');
  tem(e, 'janelaDias deve ser um número inteiro de 1 a 3650');
  tem(e, '"abas" está vazia');
  const dup = validarProjeto({ ...PROJETO_BASE, abas: [{ modulo: 'painel', nome: 'Painel' }, { modulo: 'painel', nome: 'Outro' }, { modulo: 'entregas', nome: 'Painel' }] }, pasta).erros;
  tem(dup, 'dois módulos usariam painel.json');
  tem(dup, 'nome de aba repetido');
  const semCapa = validarProjeto({ ...PROJETO_BASE, capa: 'media/capa.webp' }, pasta).erros;
  tem(semCapa, 'arquivo não existe: media/capa.webp');
});

test('roteiro: dependência inexistente, circular, de si mesmo, duas fases atuais, id repetido e estados', () => {
  const dados = { fases: [
    { id: 'f1', nome: 'Um', estado: 'atual', itens: [
      { id: 'A', titulo: 'a', estado: 'feito', depende: ['B'] },
      { id: 'B', titulo: 'b', estado: 'a-fazer', depende: ['A'] },
      { id: 'C', titulo: 'c', estado: 'a-fazer', depende: ['C', 'Z'] },
      { id: 'D', titulo: 'd', estado: 'quase' } ] },
    { id: 'f2', nome: 'Dois', estado: 'atual', itens: [{ id: 'D', titulo: 'repetido', estado: 'a-fazer' }] },
  ] };
  const e = erros(validarRoteiro, dados);
  tem(e, 'dependência circular: A → B → A');
  tem(e, 'item C: depende de si mesmo');
  tem(e, 'item C: depende de "Z", que não existe no roteiro');
  tem(e, 'só uma fase pode ser "atual"; marcadas: f1, f2');
  tem(e, 'estado "quase" fora de feito, em-andamento, a-fazer, bloqueado');
  tem(e, 'item "D" aparece em duas fases (f1 e f2)');
});

test('roteiro: estados escritos com acento ou espaço são aceitos', () => {
  const dados = { fases: [{ id: 'f1', nome: 'Um', estado: 'Atual', itens: [{ id: 'A', titulo: 'a', estado: 'Em andamento' }, { id: 'B', titulo: 'b', estado: 'A fazer' }] }] };
  assert.deepEqual(erros(validarRoteiro, dados), []);
});

test('roteiro: aviso de fase feita com tarefa aberta', () => {
  const r = normalizarResultado(validarRoteiro({ fases: [{ id: 'f1', nome: 'Um', estado: 'feita', itens: [{ id: 'A', titulo: 'a', estado: 'a-fazer' }] }] }));
  assert.deepEqual(r.erros, []);
  tem(r.avisos, 'fase f1 está "feita", mas tem item sem estar feito');
});

test('riscos: severidade e estado desconhecidos, campos que faltam, id repetido', () => {
  const base = { id: 'R1', titulo: 'T', severidade: 'alta', fase: 'F1', dono: 'Coder', fechaCom: 'evidência', estado: 'aberto' };
  const e = erros(validarRiscos, { riscos: [{ ...base, severidade: 'crítica' }, { ...base, id: 'R2', estado: 'meio' }, { ...base, id: 'R3', dono: '' }, { ...base }] });
  tem(e, 'severidade "crítica" fora de alta, media, baixa');
  tem(e, 'estado "meio" fora de aberto, mitigando, fechado');
  tem(e, 'falta "dono"');
  tem(e, 'risco com id repetido: R1');
});

test('decisões, playtest, pipeline, métricas e painel: um erro claro por módulo', () => {
  tem(erros(validarDecisoes, { temas: [{ nome: 'T', decisoes: [{ id: 'D1', titulo: 'x', estado: 'Talvez' }] }] }), 'estado "Talvez" fora de confirmada, pendente');
  tem(erros(validarPlaytest, { iteracoes: [
    { id: 'a', nome: 'A', aberta: true, achados: [] }, { id: 'b', nome: 'B', aberta: true, achados: [] }] }), 'só uma iteração pode estar aberta; abertas agora: a, b');
  tem(erros(validarPipeline, { etapas: [{ id: 'm', nome: 'Meshy' }], assets: [{ id: 'a', nome: 'A', etapas: { blender: 'feito' } }] }), 'etapa "blender" não existe em "etapas" (existem: m)');
  tem(erros(validarMetricas, { marcos: [{ id: 'm', nome: 'M', valores: [{ rotulo: 'x', valor: 'alto', meta: 10, sentido: 'menor' }] }] }), '"sentido" só vale com valor e meta numéricos');
  const ctx = contexto(pastaTemporaria());
  tem(erros(validarPainel, { numeros: [{ rotulo: 'x', valor: '@riscos.abertos' }] }, ctx), 'precisa de riscos.json, que não existe neste card');
  tem(erros(validarPainel, { numeros: [{ rotulo: 'x', valor: '@nada.disso' }] }, ctx), 'referência "@nada.disso" desconhecida');
});

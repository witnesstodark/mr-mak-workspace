// Motor de ponta a ponta: um card temporário com todos os módulos, os dois temas, o CLI e o carregamento dinâmico.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { construirCard, ENGINE_DIR, modulosDisponiveis } from '../gerar.mjs';
import { caminhoShared } from '../nucleo/contexto.mjs';
import { calcularProgresso, contarRiscos } from '../nucleo/calculos.mjs';
import { cssIcones, SECAO_ICONES } from '../nucleo/icones.mjs';
import { pastaTemporaria, limparTemporarias, escrever, imagemPequena, PROJETO_BASE, entrega } from './ajudas.mjs';

after(limparTemporarias);
const GERAR = join(ENGINE_DIR, 'gerar.mjs');

const roteiro = { unidade: 'tarefas', fases: [
  { id: 'f0', nome: 'Fase 0', estado: 'feita', itens: [{ id: 'A', titulo: 'a', estado: 'feito' }] },
  { id: 'f1', nome: 'Fase 1', estado: 'atual', itens: [{ id: 'B', titulo: 'b', estado: 'feito', depende: ['A'] }, { id: 'C', titulo: 'c', estado: 'em-andamento', depende: ['B'], pendencias: ['falta x'] }, { id: 'D', titulo: 'd', estado: 'a-fazer' }] },
] };
const riscos = { riscos: [
  { id: 'R1', titulo: 'Um', severidade: 'alta', fase: 'F1', dono: 'Coder', fechaCom: 'prova', estado: 'aberto' },
  { id: 'R2', titulo: 'Dois', severidade: 'baixa', fase: 'F1', dono: 'Coder', fechaCom: 'prova', estado: 'mitigando' },
  { id: 'R3', titulo: 'Três', severidade: 'media', fase: 'F2', dono: 'Coder', fechaCom: 'prova', estado: 'fechado' },
] };

/** Card completo com todos os módulos, para a pasta temporária. */
function cardCompleto(projeto = {}) {
  return escrever(pastaTemporaria(), {
    'media/capa.webp': imagemPequena(), 'media/2026-10/a.webp': imagemPequena(), 'media/2026-10/b.webp': imagemPequena(),
    'projeto.json': { ...PROJETO_BASE, sobre: 'Projeto de teste.', capa: 'media/capa.webp', abas: [
      { modulo: 'painel', nome: 'Painel' }, { modulo: 'roteiro', nome: 'Roteiro' }, { modulo: 'entregas', nome: 'Entregas' },
      { modulo: 'playtest', nome: 'Playtest' }, { modulo: 'decisoes', nome: 'Decisões' }, { modulo: 'riscos', nome: 'Riscos' },
      { modulo: 'metricas', nome: 'Métricas' }, { modulo: 'pipeline', nome: 'Pipeline' }, { modulo: 'livre', nome: 'Notas' }, { modulo: 'arquivo', nome: 'Arquivo' },
    ], ...projeto },
    'painel.json': { estado: 'Fase 1', numeros: [{ rotulo: 'Riscos abertos', valor: '@riscos.abertos', icone: 'risco' }, { rotulo: 'Marco', valor: '@roteiro.progresso', icone: 'marco' }, { rotulo: 'Build', valor: 'v1' }], agora: ['Fazendo C'], comVoce: ['Decidir D'] },
    'roteiro.json': roteiro,
    'entregas.json': { entregas: [
      entrega({ id: 'e1', data: '2026-10-17', miniaturas: ['media/2026-10/a.webp', 'media/2026-10/b.webp'] }),
      entrega({ id: 'e2', data: '2026-10-10', area: 'arte', miniatura: 'media/2026-10/b.webp' }),
      entrega({ id: 'e3', data: '2026-08-01', titulo: 'Antiga' }),
    ] },
    'playtest.json': { iteracoes: [
      { id: 'p1', nome: 'Primeira', aberta: false, achados: [{ id: 'PT-1', tipo: 'bug', titulo: 'Velho', estado: 'corrigido' }] },
      { id: 'p2', nome: 'Segunda', aberta: true, achados: [{ id: 'PT-2', tipo: 'ux', titulo: 'Novo', estado: 'aberto' }] },
    ] },
    'decisoes.json': { temas: [{ nome: 'Geral', decisoes: [{ id: 'D1', titulo: 'x', estado: 'Pendente', data: '2026-10-16' }, { id: 'D2', titulo: 'y', estado: 'Confirmada' }] }], espera: ['D1'] },
    'riscos.json': riscos,
    'metricas.json': { marcos: [{ id: 'm1', nome: 'Marco', valores: [{ rotulo: 'FPS', valor: 90, unidade: 'fps', meta: 60, sentido: 'maior' }] }] },
    'pipeline.json': { etapas: [{ id: 'm', nome: 'Meshy' }, { id: 'b', nome: 'Blender' }], assets: [{ id: 'a1', nome: 'Armadura', grupo: 'Armaduras', etapas: { m: 'feito', b: 'em andamento' } }] },
    'livre.json': { corpo: 'livre-corpo.html' },
    'livre-corpo.html': '<section class="mk-bloco"><p>Escrito à mão.</p></section>\n',
  });
}

test('gera todas as abas, no idioma pt-BR, com o aviso de arquivo gerado e os caminhos de _shared', async () => {
  const pasta = cardCompleto();
  const r = await construirCard({ pasta, hoje: '2026-10-17', semRegistro: true });
  assert.deepEqual(r.erros, []);
  assert.deepEqual(r.paginas.map(p => p.caminho), ['painel.html', 'roteiro.html', 'entregas.html', 'playtest.html', 'decisoes.html', 'riscos.html', 'metricas.html', 'pipeline.html', 'livre.html', 'arquivo.html']);
  const shared = caminhoShared(pasta, ENGINE_DIR);
  for (const p of r.paginas) {
    const html = readFileSync(join(pasta, p.caminho), 'utf8');
    assert.ok(html.startsWith('<!-- Gerado — não edite à mão.'), `${p.caminho}: começa com o aviso`);
    assert.match(html, /<html lang="pt-BR" data-mak-report="document"/);
    assert.ok(!html.includes('data-mak-theme'), 'tema base não declara data-mak-theme');
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.ok(html.includes(`href="${shared}/report.css"`) && html.includes(`href="${shared}/engine/tema-base.css"`) && html.includes(`src="${shared}/report.js"`));
    assert.match(html, /<p class="mk-gerado">Gerado — não edite à mão/, 'aviso também visível');
    assert.ok(!/<img[^>]*(capa|mk-ico)/.test(html), 'capa e ícones não são <img>');
    assert.match(html, /<main class="container mk-pag">/);
  }
});

test('caminho de _shared: ../_shared para um card dentro de workspace/', () => {
  const engine = ['', 'repo', 'workspace', '_shared', 'engine'].join(sep);
  assert.equal(caminhoShared(['', 'repo', 'workspace', '2026-10-14_global-empires'].join(sep), engine), '../_shared');
  assert.equal(caminhoShared(['', 'repo', 'workspace', 'a', 'b'].join(sep), engine), '../../_shared');
});

test('Painel e Roteiro mostram o mesmo progresso calculado; Painel e Riscos, o mesmo contador', async () => {
  const pasta = cardCompleto();
  await construirCard({ pasta, hoje: '2026-10-17', semRegistro: true });
  const calc = calcularProgresso(roteiro);
  assert.equal(calc.texto, '1 de 3 tarefas');
  const painel = readFileSync(join(pasta, 'painel.html'), 'utf8');
  const rot = readFileSync(join(pasta, 'roteiro.html'), 'utf8');
  assert.ok(painel.includes('1 de 3 tarefas') && rot.includes('1 de 3 tarefas'));
  assert.match(painel, /aria-valuemax="3" aria-valuenow="1"/);
  assert.match(painel, /<small>Marco<\/small><b>1 de 3 tarefas<\/b>/);
  const c = contarRiscos(riscos.riscos);
  assert.equal(c.abertos, 2);
  assert.match(painel, /<small>Riscos abertos<\/small><b>2<\/b>/);
  assert.match(readFileSync(join(pasta, 'riscos.html'), 'utf8'), /<b>2<\/b> riscos abertos/);
  assert.match(painel, /Fase atual: Fase 1/);
});

test('Riscos: a fase vira título do grupo nos abertos e só aparece na ficha dos fechados', async () => {
  const pasta = cardCompleto();
  await construirCard({ pasta, hoje: '2026-10-17', semRegistro: true });
  const html = readFileSync(join(pasta, 'riscos.html'), 'utf8');
  const fichaComFase = id => new RegExp(`<span class="mk-id">${id}</span>[\\s\\S]*?</article>`).exec(html)[0].includes('<b>Fase</b>');
  assert.equal(fichaComFase('R1'), false);
  assert.equal(fichaComFase('R2'), false, 'segundo risco do grupo também sem fase repetida');
  assert.equal(fichaComFase('R3'), true);
});

test('Roteiro: até 3 pendências ficam à vista; mais que isso, recolhidas com a contagem', async () => {
  const pasta = cardCompleto();
  const fases = structuredClone(roteiro.fases);
  fases[1].itens[2].pendencias = ['p1', 'p2', 'p3', 'p4'];
  writeFileSync(join(pasta, 'roteiro.json'), JSON.stringify({ ...roteiro, fases }));
  await construirCard({ pasta, hoje: '2026-10-17', semRegistro: true });
  const html = readFileSync(join(pasta, 'roteiro.html'), 'utf8');
  assert.match(html, /Pendência:<ul class="mk-pend"><li>falta x<\/li>/);
  assert.match(html, /<details class="mk-pend-grupo"><summary>4 pendências<\/summary><ul class="mk-pend"><li>p1<\/li>/);
});

test('Entregas e Arquivo dividem pela janela de 30 dias; --hoje muda a divisão', async () => {
  const pasta = cardCompleto();
  const contar = (arq, re) => (readFileSync(join(pasta, arq), 'utf8').match(re) ?? []).length;
  await construirCard({ pasta, hoje: '2026-10-17', semRegistro: true });
  assert.equal(contar('entregas.html', /<article/g), 2);
  assert.equal(contar('arquivo.html', /<article/g), 1);
  assert.match(readFileSync(join(pasta, 'arquivo.html'), 'utf8'), /agosto de 2026 · 1 entrega</);
  await construirCard({ pasta, hoje: '2026-11-20', semRegistro: true });
  assert.equal(contar('entregas.html', /<article/g), 0);
  assert.equal(contar('arquivo.html', /<article/g), 3);
  assert.match(readFileSync(join(pasta, 'entregas.html'), 'utf8'), /Nenhuma entrega nos últimos 30 dias/);
});

test('Playtest mostra só a iteração aberta e o Arquivo guarda a fechada', async () => {
  const pasta = cardCompleto();
  await construirCard({ pasta, hoje: '2026-10-17', semRegistro: true });
  const pt = readFileSync(join(pasta, 'playtest.html'), 'utf8');
  assert.ok(pt.includes('Segunda') && pt.includes('PT-2') && !pt.includes('PT-1'));
  const arq = readFileSync(join(pasta, 'arquivo.html'), 'utf8');
  assert.ok(arq.includes('Primeira') && arq.includes('PT-1') && !arq.includes('PT-2'));
});

test('tema custom: data-mak-theme="custom" e o CSS do projeto depois do tema base', async () => {
  const pasta = cardCompleto({ tema: 'custom', temaCss: 'tema.css' });
  writeFileSync(join(pasta, 'tema.css'), 'html[data-mak-theme=custom]{--mak-bg:#07110e}');
  const r = await construirCard({ pasta, hoje: '2026-10-17', semRegistro: true });
  assert.deepEqual(r.erros, []);
  const html = readFileSync(join(pasta, 'entregas.html'), 'utf8');
  assert.match(html, /<html lang="pt-BR" data-mak-report="document" data-mak-theme="custom"/);
  assert.ok(html.indexOf('tema-base.css') < html.indexOf('href="tema.css"'));
});

test('dados ruins: mostra todos os erros de uma vez e não grava nenhuma página', async () => {
  const pasta = cardCompleto();
  const dados = JSON.parse(readFileSync(join(pasta, 'entregas.json'), 'utf8'));
  dados.entregas[0].resumo = '';
  dados.entregas[1].data = '2026-02-31';
  writeFileSync(join(pasta, 'entregas.json'), JSON.stringify(dados));
  const r2 = JSON.parse(readFileSync(join(pasta, 'riscos.json'), 'utf8'));
  r2.riscos[0].severidade = 'enorme';
  writeFileSync(join(pasta, 'riscos.json'), JSON.stringify(r2));
  const r = await construirCard({ pasta, hoje: '2026-10-17', semRegistro: true });
  assert.ok(r.erros.some(m => m.includes('entregas.json: entrega 1 (e1): falta "resumo"')));
  assert.ok(r.erros.some(m => m.includes('entregas.json: entrega 2 (e2): data "2026-02-31"')));
  assert.ok(r.erros.some(m => m.includes('riscos.json: risco 1 (R1): severidade "enorme"')));
  assert.equal(r.erros.filter(m => m.includes('falta "resumo"')).length, 1, 'mensagem repetida entre Entregas e Arquivo aparece uma vez');
  assert.ok(!existsSync(join(pasta, 'painel.html')), 'nada foi gravado');
});

test('JSON quebrado e arquivo ausente têm mensagem própria', async () => {
  const pasta = cardCompleto();
  writeFileSync(join(pasta, 'riscos.json'), '{ "riscos": [ ');
  const r = await construirCard({ pasta, hoje: '2026-10-17', semRegistro: true });
  assert.ok(r.erros.some(m => m.startsWith('riscos.json: JSON inválido')), r.erros.join('\n'));
  const sem = cardCompleto();
  writeFileSync(join(sem, 'projeto.json'), JSON.stringify({ ...PROJETO_BASE, abas: [{ modulo: 'painel', nome: 'Painel' }, { modulo: 'metricas', nome: 'Métricas' }] }));
  const r3 = await construirCard({ pasta: sem, hoje: '2026-10-17', semRegistro: true });
  assert.deepEqual(r3.erros, []); // metricas.json existe neste card
  writeFileSync(join(sem, 'projeto.json'), JSON.stringify({ ...PROJETO_BASE, abas: [{ modulo: 'painel', nome: 'Painel' }, { modulo: 'riscos', nome: 'Riscos', base: 'riscos-2' }] }));
  const r4 = await construirCard({ pasta: sem, hoje: '2026-10-17', semRegistro: true });
  assert.ok(r4.erros.some(m => m.includes('riscos-2.json não existe (a aba "Riscos" precisa dele)')));
});

test('o Painel acusa quando um número usa referência sem o arquivo correspondente', async () => {
  const pasta = cardCompleto({ abas: [{ modulo: 'painel', nome: 'Painel' }] });
  writeFileSync(join(pasta, 'painel.json'), JSON.stringify({ numeros: [{ rotulo: 'Decisões', valor: '@decisoes.pendentes' }] }));
  const r = await construirCard({ pasta, hoje: '2026-10-17', semRegistro: true });
  assert.deepEqual(r.erros, [], 'decisoes.json existe e é usado mesmo sem a aba');
  writeFileSync(join(pasta, 'painel.json'), JSON.stringify({ numeros: [{ rotulo: 'Decisões', valor: '@decisoes.pendentes' }, { rotulo: 'Foo', valor: '@foo' }] }));
  const r2 = await construirCard({ pasta, hoje: '2026-10-17', semRegistro: true });
  assert.ok(r2.erros.some(m => m.includes('referência "@foo" desconhecida')));
});

test('módulo carregado na hora: basta o arquivo existir em modulos/ (como o acervo)', async () => {
  const engine = pastaTemporaria('mak-engine-');
  mkdirSync(join(engine, 'modulos'), { recursive: true });
  writeFileSync(join(engine, 'modulos', 'acervo.mjs'), `
    export const validar = (dados) => (Array.isArray(dados.itens) ? [] : ['falta "itens"']);
    export const gerar = (dados, ctx) => ctx.pagina({ titulo: ctx.aba.nome, subtitulo: 'Itens: ' + dados.itens.length, corpo: '<p>acervo</p>', scripts: 'window.acervo = 1;' });
  `);
  const pasta = escrever(pastaTemporaria(), {
    'projeto.json': { id: 'x', titulo: 'X', abas: [{ modulo: 'acervo', nome: 'Acervo' }] },
    'acervo.json': { itens: [{ id: 'a' }] },
  });
  const r = await construirCard({ pasta, hoje: '2026-10-17', semRegistro: true, engineDir: engine });
  assert.deepEqual(r.erros, []);
  const html = readFileSync(join(pasta, 'acervo.html'), 'utf8');
  assert.ok(html.includes('<p>acervo</p>') && html.includes('<script>\nwindow.acervo = 1;\n</script>') && html.includes('Itens: 1'));
  // Sem o arquivo do módulo: mensagem que diz o que existe.
  const sem = escrever(pastaTemporaria(), { 'projeto.json': { id: 'x', titulo: 'X', abas: [{ modulo: 'inexistente', nome: 'Coisa' }] } });
  const r2 = await construirCard({ pasta: sem, hoje: '2026-10-17', semRegistro: true });
  assert.ok(r2.erros.some(m => m.includes('o módulo "inexistente" não existe em modulos/') && m.includes('painel')));
});

test('módulo com erro em validar() ou gerar() não derruba o motor com uma pilha', async () => {
  const engine = pastaTemporaria('mak-engine-');
  mkdirSync(join(engine, 'modulos'), { recursive: true });
  writeFileSync(join(engine, 'modulos', 'quebrado.mjs'), `export const validar = () => { throw new Error('boom'); }; export const gerar = () => 1;`);
  writeFileSync(join(engine, 'modulos', 'tipo.mjs'), `export const validar = () => []; export const gerar = () => ({});`);
  const pasta = escrever(pastaTemporaria(), {
    'projeto.json': { id: 'x', titulo: 'X', abas: [{ modulo: 'quebrado', nome: 'Q' }, { modulo: 'tipo', nome: 'T' }] },
    'quebrado.json': {}, 'tipo.json': {},
  });
  const r = await construirCard({ pasta, hoje: '2026-10-17', semRegistro: true, engineDir: engine });
  assert.ok(r.erros.some(m => m.includes('quebrado.json: erro ao validar: boom')));
  const r2 = await construirCard({ pasta: escrever(pastaTemporaria(), { 'projeto.json': { id: 'x', titulo: 'X', abas: [{ modulo: 'tipo', nome: 'T' }] }, 'tipo.json': {} }), hoje: '2026-10-17', semRegistro: true, engineDir: engine });
  assert.ok(r2.erros.some(m => m.includes('aba "T": erro ao gerar: gerar() deve devolver o HTML')));
});

test('registro de ponta a ponta numa cópia: steps na ordem das abas, cover, progress e phase', async () => {
  const pasta = cardCompleto();
  const registro = join(pastaTemporaria(), 'workspace.json');
  writeFileSync(registro, JSON.stringify({ entities: [{ id: 'outro', title: 'Outro', steps: [] }, { id: 'teste', title: 'Teste', folder: 'x', updated: '2026-01-01', steps: [] }] }, null, 2) + '\n');
  const r = await construirCard({ pasta, hoje: '2026-10-17', registro });
  assert.equal(r.registro, 'gravado');
  const card = JSON.parse(readFileSync(registro, 'utf8')).entities[1];
  assert.deepEqual(card.steps.map(s => s.name), ['Painel', 'Roteiro', 'Entregas', 'Playtest', 'Decisões', 'Riscos', 'Métricas', 'Pipeline', 'Notas', 'Arquivo']);
  assert.equal(card.steps[8].path, 'livre.html');
  assert.equal(card.updated, '2026-10-17');
  assert.equal(card.cover, 'media/capa.webp');
  assert.deepEqual(card.progress, { done: 1, total: 3, label: 'tarefas' });
  assert.equal(card.phase, 'Fase 1');
  assert.deepEqual(JSON.parse(readFileSync(registro, 'utf8')).entities[0], { id: 'outro', title: 'Outro', steps: [] });
});

test('livre com página escrita à mão: registra o arquivo e não o reescreve', async () => {
  const pasta = escrever(pastaTemporaria(), {
    'projeto.json': { id: 'x', titulo: 'X', abas: [{ modulo: 'livre', nome: 'Mapa' }] },
    'livre.json': { arquivo: 'mapa.html' },
    'mapa.html': '<!doctype html><html lang="pt-BR" data-mak-report="document"><head><script src="../_shared/report.js"></script></head><body>à mão</body></html>',
  });
  const antes = readFileSync(join(pasta, 'mapa.html'), 'utf8');
  const r = await construirCard({ pasta, hoje: '2026-10-17', semRegistro: true });
  assert.deepEqual(r.erros, []);
  assert.equal(r.paginas[0].caminho, 'mapa.html');
  assert.equal(readFileSync(join(pasta, 'mapa.html'), 'utf8'), antes);
  assert.ok(!existsSync(join(pasta, 'livre.html')));
});

test('CLI: código 1 e mensagem clara com dados ruins; --verificar não grava; ok com dados bons', () => {
  const pasta = cardCompleto();
  const roda = (...args) => spawnSync(process.execPath, [GERAR, pasta, '--hoje', '2026-10-17', '--sem-registro', ...args], { encoding: 'utf8' });
  const bom = roda('--verificar');
  assert.equal(bom.status, 0, bom.stderr);
  assert.match(bom.stdout, /^ok: Teste: 10 abas válidas/);
  assert.ok(!existsSync(join(pasta, 'painel.html')), '--verificar não grava');
  const gerado = roda();
  assert.equal(gerado.status, 0, gerado.stderr);
  assert.ok(existsSync(join(pasta, 'painel.html')));
  writeFileSync(join(pasta, 'roteiro.json'), JSON.stringify({ fases: [{ id: 'f', nome: 'F', estado: 'atual', itens: [{ id: 'A', titulo: 'a', estado: 'a-fazer', depende: ['Z'] }] }] }));
  const ruim = roda();
  assert.equal(ruim.status, 1);
  assert.match(ruim.stderr, /erro: roteiro\.json: item A: depende de "Z", que não existe no roteiro/);
  assert.match(ruim.stderr, /nada foi gravado/);
  const hojeRuim = spawnSync(process.execPath, [GERAR, pasta, '--hoje', '17/10', '--sem-registro'], { encoding: 'utf8' });
  assert.equal(hojeRuim.status, 1);
  assert.match(hojeRuim.stderr, /--hoje inválido: 17\/10/);
  const semPasta = spawnSync(process.execPath, [GERAR], { encoding: 'utf8' });
  assert.equal(semPasta.status, 1);
  assert.match(semPasta.stdout, /Uso: node/);
});

test('módulos entregues: os dez do núcleo e dos opcionais existem; tema-base.css tem os ícones em dia', () => {
  const lista = modulosDisponiveis();
  for (const m of ['painel', 'entregas', 'arquivo', 'decisoes', 'roteiro', 'playtest', 'riscos', 'metricas', 'pipeline', 'livre']) assert.ok(lista.includes(m), `falta o módulo ${m}`);
  const css = readFileSync(join(ENGINE_DIR, 'tema-base.css'), 'utf8');
  const a = css.indexOf(SECAO_ICONES.INICIO), b = css.indexOf(SECAO_ICONES.FIM);
  assert.ok(a > 0 && b > a);
  assert.equal(css.slice(a, b + SECAO_ICONES.FIM.length), cssIcones(), 'rode: node workspace/_shared/engine/nucleo/icones.mjs --escrever');
});

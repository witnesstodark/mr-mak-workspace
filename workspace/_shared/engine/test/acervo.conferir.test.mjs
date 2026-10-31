import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conferir, main, relatorio, lerArgumentos, DESTINO_PADRAO } from '../conferir-media.mjs';
import { criarCard, escreverMidia, escreverJson, itensBase } from './acervo-fixture.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'conferir-media.mjs');
const comCard = (fn, opcoes) => {
  const card = criarCard(opcoes);
  const backup = mkdtempSync(join(tmpdir(), 'acervo-backup-'));
  try { return fn(card, backup); } finally { card.limpar(); rmSync(backup, { recursive: true, force: true }); }
};
const lerAcervo = (pasta) => JSON.parse(readFileSync(join(pasta, 'acervo.json'), 'utf8'));
const lista = (pasta) => {
  const saida = [];
  const andar = (dir, prefixo) => { for (const e of readdirSync(dir, { withFileTypes: true })) { if (e.isDirectory()) andar(join(dir, e.name), `${prefixo}${e.name}/`); else saida.push(`${prefixo}${e.name}`); } };
  if (existsSync(pasta)) andar(pasta, '');
  return saida.sort();
};

test('card em ordem: nenhum problema e código 0', () => comCard((card) => {
  const r = conferir(card.pasta);
  assert.equal(r.problemas, 0);
  assert.deepEqual([r.foraDoPadrao, r.acimaDoLimite, r.quebradas, r.orfaos], [[], [], [], []]);
  assert.equal(r.projeto, 'jogo-teste');
  assert.match(relatorio(r), /Resultado: tudo em ordem\./);
  assert.equal(main([card.pasta], { saida: () => {} }), 0);
}));

test('órfãos: arquivo de media/ que nenhum JSON referencia, agrupado por pasta', () => comCard((card) => {
  escreverMidia(card.pasta, 'media/ui-pacote-v01/Source/a.png', 2048);
  escreverMidia(card.pasta, 'media/ui-pacote-v01/Source/b.png', 2048);
  escreverMidia(card.pasta, 'media/arte/solto.webp', 100);
  const r = conferir(card.pasta);
  assert.deepEqual(r.orfaos.map((o) => o.rel), ['media/arte/solto.webp', 'media/ui-pacote-v01/Source/a.png', 'media/ui-pacote-v01/Source/b.png']);
  assert.equal(r.problemas, 3);
  const texto = relatorio(r);
  assert.match(texto, /Órfãos \(3, 0,0 MB\)/);
  assert.match(texto, /media\/ui-pacote-v01\/  2 arquivos/);
  assert.match(texto, /media\/arte\/  1 arquivo,/);
  assert.equal(main([card.pasta], { saida: () => {} }), 1);
}));

test('um arquivo citado em qualquer JSON da raiz não é órfão (entregas.json, painel.json...)', () => comCard((card) => {
  escreverMidia(card.pasta, 'media/2026-10/entrega.webp');
  escreverMidia(card.pasta, 'media/2026-10/outra.webp');
  escreverJson(card.pasta, 'entregas.json', { entregas: [{ id: 'a', miniaturas: ['media/2026-10/entrega.webp'], miniatura: './media/2026-10/outra.webp' }] });
  const r = conferir(card.pasta);
  assert.deepEqual(r.orfaos, []);
  assert.equal(r.problemas, 0);
}));

test('nome fora do padrão: só para o que o acervo.json usa', () => comCard((card) => {
  escreverMidia(card.pasta, 'media/qualquer/coisa.webp');
  escreverMidia(card.pasta, 'media/2026-10/entrega.webp');
  escreverJson(card.pasta, 'entregas.json', { entregas: [{ miniatura: 'media/2026-10/entrega.webp' }] });
  const acervo = lerAcervo(card.pasta);
  acervo.itens[1].miniatura = 'media/qualquer/coisa.webp';
  escreverJson(card.pasta, 'acervo.json', acervo);
  const r = conferir(card.pasta);
  assert.equal(r.foraDoPadrao.length, 1);
  assert.equal(r.foraDoPadrao[0].rel, 'media/qualquer/coisa.webp');
  assert.equal(r.foraDoPadrao[0].item, 'sapador');
  assert.match(r.foraDoPadrao[0].esperado, /media\/personagens\/unidades\/sapador-v01\[-vista\]\.webp/);
  assert.ok(r.orfaos.some((o) => o.rel === 'media/personagens/unidades/sapador-v01.webp'), 'o arquivo certo, que ninguém mais cita, vira órfão');
  assert.match(relatorio(r), /Nome fora do padrão \(1\):\n\s+media\/qualquer\/coisa\.webp  \[sapador, miniatura\]/);
}));

test('acima do limite: 150 KB de imagem e 3 MB de GLB; capa, tema e página livre ficam sem limite', () => comCard((card) => {
  escreverMidia(card.pasta, 'media/personagens/unidades/sapador-v01.webp', 150 * 1024 + 1);
  escreverMidia(card.pasta, 'media/personagens/unidades/fuzileiro-v02.glb', 3 * 1024 * 1024 + 1);
  escreverMidia(card.pasta, 'media/personagens/unidades/fuzileiro-v02-leitura.webp', 150 * 1024);
  escreverMidia(card.pasta, 'media/capa/capa.webp', 900 * 1024);
  escreverMidia(card.pasta, 'media/tema/fundo.webp', 400 * 1024);
  escreverMidia(card.pasta, 'media/livre/imagem.png', 400 * 1024);
  const projeto = JSON.parse(readFileSync(join(card.pasta, 'projeto.json'), 'utf8'));
  escreverJson(card.pasta, 'projeto.json', { ...projeto, capa: 'media/capa/capa.webp', tema: 'custom', temaCss: 'tema.css' });
  writeFileSync(join(card.pasta, 'tema.css'), '.x{background:url("media/tema/fundo.webp")}');
  writeFileSync(join(card.pasta, 'pagina.html'), '<img src="media/livre/imagem.png">');
  const r = conferir(card.pasta);
  assert.deepEqual(r.acimaDoLimite.map((x) => x.rel).sort(), ['media/personagens/unidades/fuzileiro-v02.glb', 'media/personagens/unidades/sapador-v01.webp']);
  assert.ok(r.acimaDoLimite.every((x) => x.tamanho > x.limite));
  assert.match(relatorio(r), /sapador-v01\.webp  151 KB \(limite 150 KB\)/);
  assert.match(relatorio(r), /fuzileiro-v02\.glb  3073 KB \(limite 3072 KB\)/);
  assert.deepEqual(r.orfaos, [], 'capa, tema e página escrita à mão contam como referência');
}));

test('referência quebrada: aponta o arquivo, o JSON e o campo', () => comCard((card) => {
  const acervo = lerAcervo(card.pasta);
  acervo.itens[1].vistas = [{ rotulo: 'Costas', arquivo: 'media/personagens/unidades/sapador-v01-costas.webp' }];
  escreverJson(card.pasta, 'acervo.json', acervo);
  escreverJson(card.pasta, 'entregas.json', { entregas: [{ id: 'x', miniaturas: ['media/2026-10/sumiu.webp'] }] });
  const r = conferir(card.pasta);
  assert.deepEqual(r.quebradas.map((q) => [q.rel, q.fonte, q.onde]), [
    ['media/personagens/unidades/sapador-v01-costas.webp', 'acervo.json', 'itens[1].vistas[0].arquivo'],
    ['media/2026-10/sumiu.webp', 'entregas.json', 'entregas[0].miniaturas[0]'],
  ]);
  assert.match(relatorio(r), /Referência quebrada \(2\):\n\s+media\/personagens\/unidades\/sapador-v01-costas\.webp  citado em acervo\.json › itens\[1\]\.vistas\[0\]\.arquivo/);
}));

test('páginas geradas não contam como referência; as escritas à mão contam', () => comCard((card) => {
  escreverMidia(card.pasta, 'media/extra/so-na-pagina-gerada.webp');
  escreverMidia(card.pasta, 'media/extra/na-pagina-livre.webp');
  writeFileSync(join(card.pasta, 'acervo.html'), '<!-- Gerado — não edite à mão. Fonte: acervo.json -->\n<img src="media/extra/so-na-pagina-gerada.webp">');
  writeFileSync(join(card.pasta, 'livre.html'), '<html><img src="media/extra/na-pagina-livre.webp"></html>');
  const r = conferir(card.pasta);
  assert.deepEqual(r.orfaos.map((o) => o.rel), ['media/extra/so-na-pagina-gerada.webp']);
}));

test('--limpar sem --confirmar é simulação: nada é movido', () => comCard((card, backup) => {
  escreverMidia(card.pasta, 'media/ui-pacote/Source/a.png', 500);
  escreverMidia(card.pasta, 'media/arte/b.webp', 500);
  const antes = lista(card.pasta);
  const r = conferir(card.pasta, { limpar: true, destino: backup });
  assert.equal(r.limpeza.ativa, true);
  assert.equal(r.limpeza.confirmada, false);
  assert.equal(r.limpeza.aMover.length, 2);
  assert.deepEqual(r.limpeza.movidos, []);
  assert.deepEqual(lista(card.pasta), antes);
  assert.deepEqual(lista(backup), []);
  const texto = relatorio(r);
  assert.match(texto, /Simulação: 2 arquivos iriam para /);
  assert.match(texto, /Nada foi movido\. Para mover de verdade: --limpar --confirmar/);
  const saida = [];
  assert.equal(main([card.pasta, '--limpar', '--destino', backup], { saida: (t) => saida.push(t) }), 1);
  assert.deepEqual(lista(card.pasta), antes);
}));

test('--limpar --confirmar move só os órfãos, preserva subpastas, poda pastas vazias e deixa o resto', () => comCard((card, backup) => {
  escreverMidia(card.pasta, 'media/ui-pacote/Source/a.png', 500);
  escreverMidia(card.pasta, 'media/ui-pacote/Sprites/c.png', 500);
  escreverMidia(card.pasta, 'media/arte/b.webp', 500);
  const antes = lista(card.pasta).filter((f) => !/ui-pacote|arte\/b/.test(f));
  const r = conferir(card.pasta, { limpar: true, confirmar: true, destino: backup });
  assert.equal(r.limpeza.confirmada, true);
  assert.equal(r.limpeza.movidos.length, 3);
  assert.deepEqual(lista(backup), ['media/arte/b.webp', 'media/ui-pacote/Source/a.png', 'media/ui-pacote/Sprites/c.png']);
  assert.deepEqual(lista(card.pasta), antes);
  assert.equal(existsSync(join(card.pasta, 'media', 'ui-pacote')), false, 'pasta vazia removida');
  assert.equal(existsSync(join(card.pasta, 'media', 'arte')), false);
  assert.equal(existsSync(join(card.pasta, 'media', 'personagens')), true);
  assert.match(relatorio(r), /Movidos 3 arquivos para /);
  assert.equal(conferir(card.pasta).problemas, 0, 'depois da limpeza o card está em ordem');
}));

test('nunca sobrescreve: arquivo que já existe no backup fica no card e é relatado', () => comCard((card, backup) => {
  escreverMidia(card.pasta, 'media/arte/b.webp', 600);
  mkdirSync(join(backup, 'media', 'arte'), { recursive: true });
  writeFileSync(join(backup, 'media', 'arte', 'b.webp'), 'ANTIGO');
  const r = conferir(card.pasta, { limpar: true, confirmar: true, destino: backup });
  assert.equal(r.limpeza.movidos.length, 0);
  assert.equal(r.limpeza.pulados.length, 1);
  assert.match(r.limpeza.pulados[0].motivo, /não sobrescrevi/);
  assert.equal(readFileSync(join(backup, 'media', 'arte', 'b.webp'), 'utf8'), 'ANTIGO');
  assert.ok(existsSync(join(card.pasta, 'media', 'arte', 'b.webp')));
  assert.ok(r.problemas >= 1);
}));

test('o destino padrão é E:\\Backups\\Workspace\\<id do projeto>', () => comCard((card) => {
  assert.equal(DESTINO_PADRAO('global-empires'), 'E:\\Backups\\Workspace\\global-empires');
  const r = conferir(card.pasta, { limpar: true });
  assert.equal(r.limpeza.destino, 'E:\\Backups\\Workspace\\jogo-teste');
}));

test('argumentos: --confirmar exige --limpar; opção desconhecida e pasta ausente dão código 2', () => {
  assert.throws(() => lerArgumentos(['x', '--confirmar']), /--confirmar só vale junto com --limpar/);
  assert.throws(() => lerArgumentos(['x', '--destino']), /--destino pede uma pasta/);
  const saida = [];
  assert.equal(main(['x', '--foo'], { saida: (t) => saida.push(t) }), 2);
  assert.match(saida[0], /opção desconhecida: --foo/);
  assert.equal(main([], { saida: (t) => saida.push(t) }), 2);
  assert.equal(main(['--ajuda'], { saida: () => {} }), 0);
  assert.equal(main([join(tmpdir(), 'pasta-que-nao-existe-acervo')], { saida: (t) => saida.push(t) }), 2);
  assert.match(saida.at(-1), /não achei projeto\.json/);
});

test('--json devolve o resultado completo', () => comCard((card) => {
  escreverMidia(card.pasta, 'media/arte/b.webp', 10);
  const saida = [];
  assert.equal(main([card.pasta, '--json'], { saida: (t) => saida.push(t) }), 1);
  const r = JSON.parse(saida[0]);
  assert.equal(r.orfaos[0].rel, 'media/arte/b.webp');
  assert.equal(r.problemas, 1);
}));

test('pelo terminal (processo de verdade): código de saída e texto em português', () => comCard((card, backup) => {
  escreverMidia(card.pasta, 'media/arte/b.webp', 10);
  const sujo = spawnSync(process.execPath, [CLI, card.pasta, '--destino', backup], { encoding: 'utf8' });
  assert.equal(sujo.status, 1);
  assert.match(sujo.stdout, /Órfãos \(1, 0,0 MB\)/);
  const limpo = spawnSync(process.execPath, [CLI, card.pasta, '--limpar', '--confirmar', '--destino', backup], { encoding: 'utf8' });
  assert.equal(limpo.status, 0, limpo.stdout + limpo.stderr);
  assert.match(limpo.stdout, /Movidos 1 arquivo para /);
  assert.deepEqual(lista(backup), ['media/arte/b.webp']);
  assert.equal(spawnSync(process.execPath, [CLI, card.pasta], { encoding: 'utf8' }).status, 0);
}));

test('um card sem acervo.json também é conferido (só referências e órfãos)', () => {
  const card = criarCard({ itens: [] });
  try {
    rmSync(join(card.pasta, 'acervo.json'));
    escreverMidia(card.pasta, 'media/x/y.webp');
    assert.equal(conferir(card.pasta).orfaos.length, 1);
  } finally { card.limpar(); }
});

test('itensBase continua coerente com o conferidor (todas as mídias do fixture são referenciadas)', () => comCard((card) => {
  assert.equal(conferir(card.pasta).totalArquivos, itensBase().reduce((a, i) => a + (i.miniatura ? 1 : 0) + (i.vistas?.length ?? 0) + (i.modelo3d ? 1 : 0) + (typeof i.audio === 'string' ? 1 : (i.audio?.length ?? 0)) + (typeof i.prompt === 'string' ? 1 : 0) + (i.historico?.length ?? 0), 0));
}));

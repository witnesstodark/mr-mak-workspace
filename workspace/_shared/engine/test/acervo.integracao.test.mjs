// Integração com o motor de verdade (gerar.mjs): o módulo é carregado por import dinâmico e as mensagens passam pelo núcleo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { criarCard, escreverJson, escreverMidia, itensBase, PROJETO_BASE } from './acervo-fixture.mjs';

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const GERAR = join(ENGINE, 'gerar.mjs');
const temMotor = existsSync(GERAR);
const opcoes = { skip: temMotor ? false : 'gerar.mjs ainda não existe' };

async function motor() {
  return import(pathToFileURL(GERAR).href);
}
const painelMinimo = (pasta) => {
  // O painel é do núcleo fixo; um painel.json mínimo basta para a aba existir.
  escreverJson(pasta, 'painel.json', { estado: 'Teste do acervo', numeros: [], agora: [], comVoce: [], links: [] });
};

test('construirCard gera acervo.html a partir de acervo.json', opcoes, async () => {
  const card = criarCard({ projeto: { ...PROJETO_BASE, abas: [{ modulo: 'acervo', nome: 'Acervo' }] } });
  try {
    const { construirCard } = await motor();
    const r = await construirCard({ pasta: card.pasta, hoje: '2026-10-17', semRegistro: true });
    assert.deepEqual(r.erros, []);
    const pagina = r.paginas.find((p) => p.aba === 'Acervo');
    assert.equal(pagina.caminho, 'acervo.html');
    assert.equal(pagina.escrito, true);
    const html = readFileSync(join(card.pasta, 'acervo.html'), 'utf8');
    assert.match(html, /^<!-- Gerado — não edite à mão\. Fonte: acervo\.json/);
    assert.equal((html.match(/<article class="ac-item"/g) ?? []).length, 9);
    // segunda rodada sem mudança não regrava
    const r2 = await construirCard({ pasta: card.pasta, hoje: '2026-10-17', semRegistro: true });
    assert.equal(r2.paginas.find((p) => p.aba === 'Acervo').escrito, false);
    // o aviso da biblioteca 3D passa pelo núcleo com o prefixo do arquivo
    assert.ok(r.avisos.some((a) => /^acervo\.json: há modelos 3D, mas falta lib\/model-viewer-umd\.min\.js/.test(a)), r.avisos.join('\n'));
  } finally { card.limpar(); }
});

test('os erros do módulo chegam todos juntos, com o prefixo acervo.json e sem gravar nada', opcoes, async () => {
  const itens = JSON.parse(JSON.stringify(itensBase()));
  itens[0].status = 'main local';
  itens[1].miniatura = 'media/personagens/unidades/sapador.webp';
  itens[2].categoria = 'armas';
  const card = criarCard({ projeto: { ...PROJETO_BASE, abas: [{ modulo: 'acervo', nome: 'Acervo' }] }, itens });
  try {
    const { construirCard } = await motor();
    const r = await construirCard({ pasta: card.pasta, hoje: '2026-10-17', semRegistro: true });
    assert.ok(r.erros.length >= 3, r.erros.join('\n'));
    for (const e of r.erros) assert.match(e, /^acervo\.json: item "/, e);
    assert.ok(r.erros.some((e) => /status "main local"/.test(e)));
    assert.ok(r.erros.some((e) => /fora do padrão/.test(e)));
    assert.ok(r.erros.some((e) => /categoria "armas"/.test(e)));
    assert.equal(existsSync(join(card.pasta, 'acervo.html')), false);
  } finally { card.limpar(); }
});

test('o CLI do motor gera a aba e sai com código 1 quando o acervo tem erro', opcoes, () => {
  const card = criarCard({ projeto: { ...PROJETO_BASE, abas: [{ modulo: 'acervo', nome: 'Acervo' }] } });
  try {
    const ok = spawnSync(process.execPath, [GERAR, card.pasta, '--hoje', '2026-10-17', '--sem-registro'], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.ok(existsSync(join(card.pasta, 'acervo.html')));
    const acervo = JSON.parse(readFileSync(join(card.pasta, 'acervo.json'), 'utf8'));
    acervo.itens[0].versao = 0;
    writeFileSync(join(card.pasta, 'acervo.json'), JSON.stringify(acervo));
    const ruim = spawnSync(process.execPath, [GERAR, card.pasta, '--hoje', '2026-10-17', '--sem-registro'], { encoding: 'utf8' });
    assert.equal(ruim.status, 1);
    assert.match(ruim.stdout + ruim.stderr, /acervo\.json: item "fuzileiro" \(Fuzileiro\): "versao" deve ser um número inteiro/);
  } finally { card.limpar(); }
});

test('card com painel e acervo juntos: as duas abas saem e o conferir-media fica em ordem', opcoes, async () => {
  const card = criarCard();
  try {
    painelMinimo(card.pasta);
    escreverMidia(card.pasta, 'lib/qualquer.txt'); // arquivo fora de media/ não entra na conferência
    const { construirCard } = await motor();
    const r = await construirCard({ pasta: card.pasta, hoje: '2026-10-17', semRegistro: true });
    assert.deepEqual(r.erros, [], r.erros.join('\n'));
    assert.deepEqual(r.paginas.map((p) => p.caminho).sort(), ['acervo.html', 'painel.html']);
    const { conferir } = await import(pathToFileURL(join(ENGINE, 'conferir-media.mjs')).href);
    assert.equal(conferir(card.pasta).problemas, 0);
  } finally { card.limpar(); }
});

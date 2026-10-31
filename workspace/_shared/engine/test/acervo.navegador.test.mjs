// Comportamento da página do Acervo num navegador de verdade (Edge, como o app no Windows; MRMAK_TEST_BROWSER troca).
// Pula tudo se o navegador não abrir. Capturas de tela: defina ACERVO_CAPTURAS=<pasta>.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { copyFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gerar, validar } from '../modulos/acervo.mjs';
import { criarFabrica } from '../nucleo/contexto.mjs';
import { comPadroes } from '../nucleo/projeto.mjs';
import { arquivosDoAcervo, escreverJson, escreverMidia, itensBase, PROJETO_BASE } from './acervo-fixture.mjs';

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = dirname(ENGINE);
const REPO = join(SHARED, '..', '..');
const require = createRequire(join(REPO, 'package.json'));
const CAPTURAS = process.env.ACERVO_CAPTURAS;
const LIB_GE = join(SHARED, '..', '2026-10-14_global-empires', 'lib', 'model-viewer-umd.min.js');
const GLB_GE = join(SHARED, '..', '2026-10-14_global-empires', 'media', 'modelos', 'fuzileiro-aco.glb');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.md': 'text/markdown; charset=utf-8' };

let browser; let servidor; let raiz; let base; let motivoPulo = false; let temaClaro = '';
const paginas = {}; // nome -> caminho relativo da página gerada

async function lancar() {
  const { chromium, webkit } = require('playwright');
  const nome = process.env.MRMAK_TEST_BROWSER || (process.platform === 'darwin' ? 'webkit' : 'msedge');
  return nome === 'webkit' ? webkit.launch({ headless: true }) : chromium.launch({ headless: true, channel: nome === 'chromium' ? undefined : nome });
}

/** Desenha uma imagem de teste (WebP) no próprio navegador: cor, texto e proporção. */
async function imagemDe(pg, texto, cor, l, a) {
  const b64 = await pg.evaluate(({ texto, cor, l, a }) => {
    const c = document.createElement('canvas');
    c.width = l; c.height = a;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, l, a);
    g.addColorStop(0, cor); g.addColorStop(1, '#222');
    x.fillStyle = g; x.fillRect(0, 0, l, a);
    x.fillStyle = '#fff'; x.font = `bold ${Math.round(a / 8)}px sans-serif`; x.textAlign = 'center';
    x.fillText(texto, l / 2, a / 2);
    return c.toDataURL('image/webp', 0.7).split(',')[1];
  }, { texto, cor, l, a });
  return Buffer.from(b64, 'base64');
}

function montarCard(pasta) {
  const projeto = comPadroes({ ...PROJETO_BASE });
  const itens = itensBase();
  // mais itens para o filtro ter o que filtrar
  for (let i = 1; i <= 5; i++) {
    itens.push({ id: `cursor-${i}`, nome: `Cursor ${i}`, categoria: 'interface', familia: 'cursores', status: i % 2 ? 'vigente' : 'em-avaliacao', versao: 1, miniatura: `media/interface/cursores/cursor-${i}-v01.webp`, nota: 'Ponta fixa.' });
  }
  const fab = criarFabrica({ pasta, projeto, hoje: '2026-10-17', engineDir: join(raiz, 'workspace', '_shared', 'engine') });
  const ctx = fab.contexto({ aba: { modulo: 'acervo', nome: 'Acervo', base: 'acervo' }, modulo: 'acervo', fonte: 'acervo' });
  const dados = { itens };
  escreverJson(pasta, 'projeto.json', PROJETO_BASE);
  escreverJson(pasta, 'acervo.json', dados);
  return { ctx, dados, itens };
}

before(async () => {
  try { browser = await lancar(); } catch (e) { motivoPulo = `navegador indisponível: ${String(e.message).split('\n')[0]}`; return; }
  raiz = mkdtempSync(join(tmpdir(), 'acervo-nav-'));
  const compartilhado = join(raiz, 'workspace', '_shared');
  mkdirSync(join(compartilhado, 'engine'), { recursive: true });
  for (const f of ['report.css', 'report.js', 'examples.css']) copyFileSync(join(SHARED, f), join(compartilhado, f));
  copyFileSync(join(ENGINE, 'tema-base.css'), join(compartilhado, 'engine', 'tema-base.css'));
  copyFileSync(join(ENGINE, 'acervo.js'), join(compartilhado, 'engine', 'acervo.js'));
  temaClaro = (await import(pathToFileURL(join(REPO, 'desktop', 'service', 'report-theme.mjs')).href)).reportThemeCSS;

  servidor = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const arq = join(raiz, rel);
    if (!arq.startsWith(raiz) || !existsSync(arq) || !statSync(arq).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[extname(arq)] ?? 'application/octet-stream' });
    createReadStream(arq).pipe(res);
  });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${servidor.address().port}`;

  const aux = await browser.newPage();
  await aux.goto('about:blank');
  for (const comLib of [true, false]) {
    const nome = comLib ? 'card' : 'card-sem-lib';
    const pasta = join(raiz, 'workspace', nome);
    mkdirSync(pasta, { recursive: true });
    const { ctx, dados, itens } = montarCard(pasta);
    const cores = ['#b5483a', '#3a7bb5', '#4aa36c', '#b58a3a', '#7a4ab5', '#3ab5a8'];
    let k = 0;
    for (const rel of arquivosDoAcervo(itens)) {
      const destino = join(pasta, ...rel.split('/'));
      if (rel.endsWith('.webp')) {
        mkdirSync(dirname(destino), { recursive: true });
        const larg = rel.includes('modelo-3d') ? 300 : rel.includes('leitura') ? 640 : 480;
        writeFileSync(destino, await imagemDe(aux, rel.split('/').pop().replace('.webp', ''), cores[k++ % cores.length], larg, rel.includes('telas') ? 270 : 360));
      } else if (rel.endsWith('.glb')) {
        mkdirSync(dirname(destino), { recursive: true });
        if (existsSync(GLB_GE)) copyFileSync(GLB_GE, destino); else escreverMidia(pasta, rel, 100);
      } else escreverMidia(pasta, rel, 200);
    }
    if (comLib && existsSync(LIB_GE)) { mkdirSync(join(pasta, 'lib'), { recursive: true }); copyFileSync(LIB_GE, join(pasta, 'lib', 'model-viewer-umd.min.js')); }
    const r = validar(dados, ctx);
    assert.deepEqual(r.erros, [], r.erros.join('\n'));
    writeFileSync(join(pasta, 'acervo.html'), gerar(dados, ctx));
    paginas[nome] = `/workspace/${nome}/acervo.html`;
  }
  await aux.close();
});

after(async () => {
  await browser?.close();
  servidor?.close();
  if (raiz) rmSync(raiz, { recursive: true, force: true });
});

async function abrir({ largura = 1280, tema = 'dark', pagina = 'card', hash = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: 900 }, hasTouch: largura < 700, isMobile: largura < 700 });
  const pg = await ctx.newPage();
  pg.errosDeConsole = [];
  pg.falhas = [];
  pg.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) pg.falhas.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  pg.on('pageerror', (e) => pg.errosDeConsole.push(String(e)));
  pg.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) pg.errosDeConsole.push(m.text()); });
  await pg.goto(`${base}${paginas[pagina]}${hash}`, { waitUntil: 'load' });
  if (tema === 'light') {
    await pg.addStyleTag({ content: temaClaro });
    await pg.evaluate(() => { document.documentElement.dataset.mrmakTheme = 'light'; });
  }
  pg.fechar = () => ctx.close();
  return pg;
}
const capturar = async (pg, nome) => { if (CAPTURAS) { mkdirSync(CAPTURAS, { recursive: true }); await pg.screenshot({ path: join(CAPTURAS, `${nome}.png`), fullPage: false }); } };
const visiveis = (pg) => pg.locator('.ac-item:not([hidden])').count();
const pula = () => motivoPulo || false;

test('sem rolagem horizontal em 390, 768 e 1280 px, claro e escuro', { skip: pula() }, async () => {
  for (const largura of [390, 768, 1280]) {
    for (const tema of ['dark', 'light']) {
      const pg = await abrir({ largura, tema });
      await pg.locator('.ac-fam > summary').first().click();
      await pg.locator('#item-fuzileiro [data-ac-comparar]').click();
      const m = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(m.sw <= m.iw, `${largura} ${tema}: scrollWidth ${m.sw} > ${m.iw}`);
      await capturar(pg, `${largura}-${tema}`);
      assert.deepEqual([pg.errosDeConsole, pg.falhas], [[], []]);
      await pg.fechar();
    }
  }
});

test('começa recolhido, com áudio preload="none" e sem baixar a biblioteca 3D', { skip: pula() }, async () => {
  const pg = await abrir();
  assert.equal(await pg.locator('details.ac-fam[open]').count(), 0);
  assert.equal(await pg.locator('details.ac-cat:not([open])').count(), 0);
  assert.equal(await pg.locator('audio:not([preload=none])').count(), 0);
  assert.equal(await pg.evaluate(() => Boolean(customElements.get('model-viewer'))), false);
  assert.equal(await pg.locator('script[src*="model-viewer"]').count(), 0);
  assert.equal(await pg.locator('[data-ac-recolher]').isDisabled(), true);
  assert.equal(await pg.locator('[data-ac-expandir]').isDisabled(), false);
  await pg.fechar();
});

test('filtros por categoria, status e busca; contagens dos botões recalculadas', { skip: pula() }, async () => {
  const pg = await abrir();
  const total = await visiveis(pg);
  assert.equal(total, 14);
  const n = (tipo, valor) => pg.locator(`[data-ac-filtro=${tipo}][data-valor="${valor}"] [data-ac-n]`).textContent();
  await pg.locator('[data-ac-filtro=categoria][data-valor=interface]').click();
  assert.equal(await visiveis(pg), 6);
  assert.equal(await pg.locator('[data-ac-filtro=categoria][data-valor=interface]').getAttribute('aria-pressed'), 'true');
  assert.equal(await pg.locator('[data-ac-filtro=categoria][data-valor=""]').getAttribute('aria-pressed'), 'false');
  assert.equal(await n('status', 'vigente'), '3', 'status com a categoria Interface');
  assert.equal(await n('status', 'em-avaliacao'), '3');
  assert.equal(await n('categoria', 'personagens'), '2', 'categoria Personagens, com o status ainda livre');
  assert.match(await pg.locator('[data-ac-total]').textContent(), /^6 de 14 itens$/);
  assert.match(await pg.locator('#cat-interface > summary [data-ac-cont]').textContent(), /^6 de 6 itens$|^6 itens$/);
  await pg.locator('[data-ac-filtro=status][data-valor=vigente]').click();
  assert.equal(await visiveis(pg), 3);
  await pg.locator('[data-ac-busca]').fill('CURSOR 3');
  assert.equal(await visiveis(pg), 1);
  assert.equal(await pg.locator('.ac-item:not([hidden])').getAttribute('id'), 'item-cursor-3');
  assert.equal(await pg.locator('#fam-interface-cursores').evaluate((d) => d.open), true, 'a busca abre a família com resultado');
  assert.equal(await pg.locator('details.ac-cat:not([hidden])').count(), 1, 'categorias sem resultado somem');
  await pg.locator('[data-ac-busca]').fill('naoexiste');
  assert.equal(await pg.locator('[data-ac-vazio]').isVisible(), true);
  await pg.locator('[data-ac-busca]').fill('');
  assert.equal(await pg.locator('#fam-interface-cursores').evaluate((d) => d.open), false, 'terminada a busca, a família volta a fechar');
  await pg.locator('[data-ac-filtro=status][data-valor=""]').click();
  await pg.locator('[data-ac-filtro=categoria][data-valor=""]').click();
  assert.equal(await visiveis(pg), 14);
  assert.equal(await pg.locator('[data-ac-vazio]').isVisible(), false);
  // busca ignora acento: "Português" acha a faixa; "Japao" acha Japão
  await pg.locator('[data-ac-busca]').fill('japao');
  assert.equal(await visiveis(pg), 1);
  await pg.fechar();
});

test('expandir e recolher tudo atuam só nas famílias visíveis', { skip: pula() }, async () => {
  const pg = await abrir();
  await pg.locator('[data-ac-filtro=categoria][data-valor=audio]').click();
  await pg.locator('[data-ac-expandir]').click();
  assert.equal(await pg.locator('details.ac-fam[open]').count(), 2);
  assert.equal(await pg.locator('[data-ac-expandir]').isDisabled(), true);
  await pg.locator('[data-ac-filtro=categoria][data-valor=""]').click();
  assert.equal(await pg.locator('details.ac-fam[open]').count(), 2, 'as de outras categorias seguem fechadas');
  assert.equal(await pg.locator('[data-ac-expandir]').isDisabled(), false);
  await pg.locator('[data-ac-recolher]').click();
  assert.equal(await pg.locator('details.ac-fam[open]').count(), 0);
  await pg.fechar();
});

test('link direto #item-… abre a seção e mostra o item', { skip: pula() }, async () => {
  const pg = await abrir({ hash: '#item-sapador' });
  await pg.waitForTimeout(200);
  assert.equal(await pg.locator('#fam-personagens-unidades').evaluate((d) => d.open), true);
  assert.equal(await pg.locator('#item-sapador').isVisible(), true);
  await pg.fechar();
});

test('comparar: deslizar com a faixa, lado a lado, trocar imagens e fechar', { skip: pula() }, async () => {
  for (const largura of [390, 1280]) {
    const pg = await abrir({ largura });
    await pg.locator('#fam-personagens-unidades > summary').click();
    const botao = pg.locator('#item-fuzileiro [data-ac-comparar]');
    await botao.click();
    const painel = pg.locator('#item-fuzileiro .ac-comp');
    assert.equal(await painel.count(), 1);
    assert.equal(await botao.getAttribute('aria-expanded'), 'true');
    assert.equal(await painel.locator('select').first().locator('option').count(), 3);
    assert.equal(await painel.locator('.ac-comp-palco img').count(), 2);
    await painel.locator('input[type=range]').fill('25');
    assert.match(await painel.locator('.ac-comp-topo').getAttribute('style'), /inset\(0(px)? 75%/);
    assert.match(await painel.locator('.ac-comp-linha').getAttribute('style'), /left: 25%/);
    // arrastar no palco move a divisão
    const caixa = await painel.locator('.ac-comp-palco').boundingBox();
    await pg.mouse.move(caixa.x + 5, caixa.y + caixa.height / 2);
    await pg.mouse.down();
    await pg.mouse.move(caixa.x + caixa.width * 0.8, caixa.y + caixa.height / 2);
    await pg.mouse.up();
    assert.ok(Number(await painel.locator('input[type=range]').inputValue()) > 70);
    // trocar a imagem da esquerda para a mesma da direita troca a direita
    await painel.locator('select').first().selectOption('1');
    assert.notEqual(await painel.locator('select').nth(1).inputValue(), '1');
    assert.match(await painel.locator('.ac-comp-rot').textContent(), /Esquerda: Leitura na câmera/);
    await painel.getByRole('button', { name: 'Lado a lado' }).click();
    assert.equal(await painel.locator('.ac-comp-palco.ac-lado figure').count(), 2);
    assert.equal(await painel.locator('input[type=range]').isHidden(), true);
    const duas = await painel.locator('.ac-comp-palco.ac-lado img').evaluateAll((l) => l.map((i) => Math.round(i.getBoundingClientRect().width)));
    assert.ok(duas.every((w) => w > 120), `lado a lado em ${largura}px: ${duas}`);
    await capturar(pg, `comparar-${largura}`);
    await painel.getByRole('button', { name: 'Fechar' }).click();
    assert.equal(await pg.locator('#item-fuzileiro .ac-comp').count(), 0);
    assert.equal(await botao.getAttribute('aria-expanded'), 'false');
    assert.deepEqual([pg.errosDeConsole, pg.falhas], [[], []]);
    await pg.fechar();
  }
});

test('só um painel aberto por vez e o botão de novo clique fecha', { skip: pula() }, async () => {
  const pg = await abrir();
  await pg.locator('#fam-personagens-unidades > summary').click();
  await pg.locator('#item-fuzileiro [data-ac-comparar]').click();
  await pg.locator('#item-fuzileiro [data-ac-3d]').click();
  assert.equal(await pg.locator('#item-fuzileiro .ac-comp').count(), 0);
  assert.equal(await pg.locator('#item-fuzileiro .ac-3d').count(), 1);
  await pg.locator('#item-fuzileiro [data-ac-3d]').click();
  assert.equal(await pg.locator('#item-fuzileiro .ac-3d').count(), 0);
  await pg.fechar();
});

test('3D: a biblioteca do card só é baixada no primeiro clique', { skip: pula() || (existsSync(LIB_GE) && existsSync(GLB_GE) ? false : 'sem lib/GLB do card Global Empires') }, async () => {
  const pg = await abrir({ largura: 390 });
  const pedidos = [];
  pg.on('request', (r) => pedidos.push(new URL(r.url()).pathname));
  await pg.locator('#fam-personagens-unidades > summary').click();
  await pg.waitForTimeout(300);
  assert.equal(pedidos.some((p) => /model-viewer|\.glb$/.test(p)), false, 'nada de 3D antes do clique');
  await pg.locator('#item-fuzileiro [data-ac-3d]').click();
  await pg.waitForFunction(() => document.querySelector('#item-fuzileiro model-viewer'), null, { timeout: 15000 });
  assert.ok(pedidos.includes('/workspace/card/lib/model-viewer-umd.min.js'));
  await pg.waitForFunction(() => document.querySelectorAll('#item-fuzileiro .ac-painel-barra select option').length > 0, null, { timeout: 25000 });
  assert.ok(pedidos.includes('/workspace/card/media/personagens/unidades/fuzileiro-v02.glb'));
  assert.equal(await pg.locator('#item-fuzileiro .ac-3d model-viewer').count(), 1);
  await capturar(pg, '3d-390');
  await pg.locator('#item-fuzileiro .ac-3d').getByRole('button', { name: 'Fechar' }).click();
  assert.equal(await pg.locator('#item-fuzileiro model-viewer').count(), 0);
  // segundo clique reaproveita a biblioteca
  const n = pedidos.filter((p) => /model-viewer-umd/.test(p)).length;
  await pg.locator('#item-fuzileiro [data-ac-3d]').click();
  await pg.waitForFunction(() => document.querySelector('#item-fuzileiro model-viewer'));
  assert.equal(pedidos.filter((p) => /model-viewer-umd/.test(p)).length, n);
  assert.deepEqual([pg.errosDeConsole, pg.falhas], [[], []]);
  await pg.fechar();
});

test('3D sem a biblioteca no card: aviso claro e link para baixar o GLB', { skip: pula() }, async () => {
  const pg = await abrir({ pagina: 'card-sem-lib' });
  await pg.locator('#fam-personagens-unidades > summary').click();
  await pg.locator('#item-fuzileiro [data-ac-3d]').click();
  const aviso = pg.locator('#item-fuzileiro .ac-painel-aviso');
  await aviso.waitFor({ state: 'visible' });
  await pg.waitForFunction(() => /indisponível/.test(document.querySelector('#item-fuzileiro .ac-painel-aviso')?.textContent ?? ''), null, { timeout: 10000 });
  assert.match(await aviso.textContent(), /Visualizador 3D indisponível: não encontrei lib\/model-viewer-umd\.min\.js no card/);
  assert.match(await pg.locator('#item-fuzileiro .ac-3d a[download]').getAttribute('href'), /fuzileiro-v02\.glb$/);
  await pg.fechar();
});

test('imagens abrem a prévia do report.js, com download', { skip: pula() }, async () => {
  const pg = await abrir({ largura: 390 });
  await pg.locator('#fam-personagens-unidades > summary').click();
  await pg.locator('#item-sapador .ac-midia img').tap();
  const dialogo = pg.locator('dialog.mak-lightbox[open]');
  await dialogo.waitFor();
  assert.match(await dialogo.locator('a[download]').getAttribute('href'), /sapador-v01\.webp$/);
  assert.equal(await dialogo.locator('.mak-lightbox-caption').textContent(), 'Sapador');
  await dialogo.getByRole('button', { name: 'Close' }).click();
  assert.equal(await pg.locator('dialog.mak-lightbox[open]').count(), 0);
  // uma vista também abre
  await pg.locator('#item-fuzileiro .ac-vistas img').first().tap();
  assert.match(await pg.locator('dialog.mak-lightbox[open] .mak-lightbox-caption').textContent(), /Fuzileiro, Leitura na câmera/);
  await pg.fechar();
});

test('legibilidade: contraste mínimo de 4,5:1 no texto principal, claro e escuro', { skip: pula() }, async () => {
  for (const tema of ['dark', 'light']) {
    const pg = await abrir({ tema });
    await pg.locator('#fam-personagens-unidades > summary').click();
    const medidas = await pg.evaluate(() => {
      const cor = (s) => {
        const m = s.match(/-?[\d.]+(?:e-?\d+)?/g).map(Number);
        if (s.startsWith('color(')) return { r: m[0] * 255, g: m[1] * 255, b: m[2] * 255, a: m[3] ?? 1 }; // color-mix() volta como color(srgb r g b / a)
        return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 };
      };
      const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
      const fundoDe = (el) => { for (let n = el; n; n = n.parentElement) { const c = cor(getComputedStyle(n).backgroundColor); if (c.a > 0.9) return c; } return { r: 255, g: 255, b: 255 }; };
      const alvos = { nomeItem: '#item-fuzileiro h3', nota: '#item-fuzileiro .ac-nota', familia: '.ac-nome-fam', chipStatus: '#item-fuzileiro .mk-chip', botao: '#item-fuzileiro [data-ac-comparar]', total: '[data-ac-total]', legenda: '.ac-legenda' };
      const saida = {};
      for (const [nome, sel] of Object.entries(alvos)) {
        const el = document.querySelector(sel);
        const f = cor(getComputedStyle(el).color);
        const bg = fundoDe(el);
        const [a, b] = [lum(f), lum(bg)].sort((x, y) => y - x);
        saida[nome] = Math.round(((a + 0.05) / (b + 0.05)) * 10) / 10;
      }
      return saida;
    });
    for (const [nome, razao] of Object.entries(medidas)) assert.ok(razao >= 4.5, `${tema}: ${nome} com contraste ${razao}`);
    await pg.fechar();
  }
});

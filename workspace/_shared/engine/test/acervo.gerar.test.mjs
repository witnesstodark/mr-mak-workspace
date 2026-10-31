import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gerar, validar } from '../modulos/acervo.mjs';
import { criarFabrica } from '../nucleo/contexto.mjs';
import { comPadroes } from '../nucleo/projeto.mjs';
import { criarCard, itensBase, ctxDeMentira, PROJETO_BASE } from './acervo-fixture.mjs';

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const contagem = (html, re) => (html.match(re) ?? []).length;
const clonar = (x) => JSON.parse(JSON.stringify(x));
const gerarFixture = (itens = itensBase(), extra = {}) => gerar({ itens, ...extra.dados }, ctxDeMentira(extra.ctx));

test('estrutura: categorias na ordem fixa (extras no fim), famílias recolhidas e contagens', () => {
  const html = gerarFixture();
  const cats = [...html.matchAll(/<details class="ac-cat" open data-categoria="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(cats, ['personagens', 'construcoes-objetos', 'interface', 'audio', 'arte-chave', 'civilizacoes']);
  const fams = [...html.matchAll(/<details class="ac-fam" data-familia="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(fams, ['unidades', 'construcoes', 'telas', 'musica', 'efeitos', 'menu-primeira-guerra', 'civilizacoes']);
  assert.equal(contagem(html, /<details class="ac-fam"[^>]* open/g), 0, 'famílias começam recolhidas');
  assert.equal(contagem(html, /<details/g), contagem(html, /<\/details>/g));
  assert.match(html, /<span class="ac-cont" data-ac-cont>2 itens<\/span>/);
  assert.match(html, /<span class="ac-cont" data-ac-cont>1 item<\/span>/);
  assert.match(html, /9 itens|10 itens/);
  assert.equal(contagem(html, /<article class="ac-item"/g), 9);
});

test('cabeçalho e subtítulo contam os itens por status', () => {
  const html = gerarFixture();
  assert.match(html, /<h1>Acervo<\/h1>/);
  assert.match(html, /9 itens · 5 vigentes · 3 em avaliação · 1 descartada/);
});

test('filtros por categoria e por status com contagens, busca e ações em massa', () => {
  const html = gerarFixture();
  assert.match(html, /data-ac-filtro="categoria" data-valor="" aria-pressed="true">Todas <small data-ac-n>9<\/small>/);
  assert.match(html, /data-ac-filtro="categoria" data-valor="personagens"[^>]*><span class="mk-ico mk-i-pessoa"[^>]*><\/span>Personagens <small data-ac-n>2<\/small>/);
  assert.match(html, /data-ac-filtro="status" data-valor="em-avaliacao"[^>]*>.*Em avaliação <small data-ac-n>3<\/small>/);
  assert.match(html, /data-ac-filtro="status" data-valor="descartada"[^>]*>.*Descartada <small data-ac-n>1<\/small>/);
  assert.match(html, /<input type="search"[^>]*data-ac-busca[^>]*aria-label="Buscar no acervo"/);
  assert.match(html, /data-ac-expandir>Expandir tudo/);
  assert.match(html, /data-ac-recolher>Recolher tudo/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.doesNotMatch(html, /data-valor="cenario"/, 'categoria sem itens não ganha filtro');
});

test('cada item tem um selo de status só, a versão e os dados para o filtro', () => {
  const html = gerarFixture();
  const fuz = html.match(/<article class="ac-item" id="item-fuzileiro"[\s\S]*?<\/article>/)[0];
  assert.match(fuz, /data-status="vigente"/);
  assert.equal(contagem(fuz, /class="mk-chip /g), 2, 'selo do item e selo da versão anterior');
  assert.equal(contagem(fuz.split('<details class="ac-hist">')[0], /class="mk-chip /g), 1);
  assert.match(fuz, /<span class="mk-id">v02<\/span>/);
  assert.match(fuz, /<span class="mk-id">3D<\/span>/);
  assert.match(fuz, /data-busca="[^"]*fuzileiro[^"]*conceito/);
});

test('imagens: todas <img> com alt, lazy loading; miniatura e vistas; ícones são CSS', () => {
  const html = gerarFixture();
  const imgs = html.match(/<img [^>]*>/g);
  assert.equal(imgs.length, 12, '8 miniaturas + 2 vistas + 3 do histórico (2 do Brasil e 1 do Fuzileiro) - menos os 2 itens só de áudio');
  for (const tag of imgs) {
    assert.match(tag, /loading="lazy"/);
    assert.match(tag, /decoding="async"/);
    assert.match(tag, /alt="[^"]{3,}"/, tag);
    assert.match(tag, /src="media\//);
  }
  assert.match(html, /alt="Fuzileiro, Modelo 3D"/);
  assert.match(html, /alt="Sapador"/, 'miniatura sem rótulo usa só o nome');
  assert.match(html, /alt="Fuzileiro, Conceito"/);
  assert.match(html, /alt="Brasil, versão v02"/);
  assert.equal(contagem(html, /<img [^>]*mk-ico/g), 0);
  assert.ok(contagem(html, /<span class="mk-ico /g) > 10, 'ícones decorativos em CSS');
  assert.doesNotMatch(html, /<img[^>]*class="mk-ico/);
});

test('áudio sempre com preload="none" e rótulo acessível', () => {
  const html = gerarFixture();
  const tags = html.match(/<audio [^>]*>/g);
  assert.equal(tags.length, 3);
  for (const t of tags) {
    assert.match(t, /preload="none"/);
    assert.match(t, /controls/);
    assert.match(t, /aria-label="[^"]+"/);
  }
  assert.match(html, /<span>Latim 1<\/span><audio controls preload="none" src="media\/audio\/musica\/terra-de-ninguem-v01-latim-1\.ogg"/);
  assert.match(html, /aria-label="Terra de Ninguém, Português 1"/);
});

test('"Comparar" só em item com 2 ou mais imagens; "Ver em 3D" só com modelo', () => {
  const html = gerarFixture();
  const cartao = (id) => html.match(new RegExp(`<article class="ac-item" id="item-${id}"[\\s\\S]*?</article>`))[0];
  assert.match(cartao('fuzileiro'), /data-ac-comparar/);
  assert.match(cartao('fuzileiro'), /data-ac-3d data-glb="media\/personagens\/unidades\/fuzileiro-v02\.glb" data-titulo="Fuzileiro"/);
  assert.doesNotMatch(cartao('sapador'), /data-ac-comparar|data-ac-3d/);
  assert.doesNotMatch(cartao('brasil'), /data-ac-comparar/, 'histórico não conta como vista');
  assert.equal(contagem(html, /data-ac-comparar/g), 1);
  assert.equal(contagem(html, /data-ac-3d/g), 1);
  // com duas vistas na miniatura + 1 vista, passa a comparar
  const itens = clonar(itensBase());
  itens[1].vistas = [{ rotulo: 'Costas', arquivo: 'media/personagens/unidades/sapador-v01-costas.webp' }];
  assert.match(gerarFixture(itens).match(/<article class="ac-item" id="item-sapador"[\s\S]*?<\/article>/)[0], /data-ac-comparar/);
});

test('histórico fica recolhido dentro do item, da versão mais nova para a mais antiga', () => {
  const html = gerarFixture();
  const brasil = html.match(/<article class="ac-item" id="item-brasil"[\s\S]*?<\/article>/)[0];
  assert.match(brasil, /<details class="ac-hist"><summary>Versões anteriores \(2\)<\/summary>/);
  assert.ok(brasil.indexOf('v02') < brasil.indexOf('v01'));
  assert.doesNotMatch(brasil, /<details class="ac-hist" open/);
  assert.match(brasil, /Descartada/);
});

test('original e prompt: caminho do original, link de download do prompt do card, caminho de prompt de fora', () => {
  const itens = clonar(itensBase());
  itens[1].prompt = 'GE-game/Art/Concepts/U07.prompt.md';
  itens[2].prompt = [{ rotulo: 'Montagem', arquivo: 'media/construcoes-objetos/construcoes/centro-urbano-v01-montagem.prompt.md' }, { rotulo: 'Peças', arquivo: 'media/construcoes-objetos/construcoes/centro-urbano-v01-pecas.prompt.md' }];
  const html = gerarFixture(itens);
  assert.match(html, /<p class="ac-orig"><b>Original:<\/b> <code>GE-game\/Unity_Import\/Assets\/_Project\/Art\/Concepts\/Units\/U04\.png<\/code><\/p>/);
  assert.match(html, /<a href="media\/personagens\/unidades\/fuzileiro-v02\.prompt\.md" download>Prompt<\/a>/);
  assert.match(html, /<code>GE-game\/Art\/Concepts\/U07\.prompt\.md<\/code>/);
  assert.match(html, /download>Prompt \(Montagem\)<\/a> <a href="[^"]+pecas\.prompt\.md" download>Prompt \(Peças\)<\/a>/);
});

test('texto vindo do JSON é escapado; crases viram <code>', () => {
  const itens = clonar(itensBase());
  itens[1].nome = '<script>alert(1)</script> "Sapador"';
  itens[1].nota = 'x <img src=x onerror=alert(1)> `código`';
  itens[1].original = '"><b>x</b>';
  const html = gerarFixture(itens);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &quot;Sapador&quot;/);
  assert.match(html, /<code>código<\/code>/);
  assert.match(html, /<code>&quot;&gt;&lt;b&gt;x&lt;\/b&gt;<\/code>/);
  assert.match(gerarFixture().match(/<article class="ac-item" id="item-fuzileiro"[\s\S]*?<\/article>/)[0], /Aprovado em <code>U04<\/code>/);
});

test('nomes de família: "familias" do acervo.json ou o id legível', () => {
  const html = gerarFixture(itensBase(), { dados: { familias: { 'personagens/unidades': 'Unidades do jogo' } } });
  assert.match(html, /<span class="ac-nome-fam">Unidades do jogo<\/span>/);
  assert.match(html, /<span class="ac-nome-fam">Menu primeira guerra<\/span>/);
});

test('categoria extra aparece com o nome do projeto', () => {
  assert.match(gerarFixture(), /<h2 class="mk-t"><span class="mk-ico mk-i-livro"[^>]*><\/span>Civilizações<\/h2>/);
});

test('sem itens: mensagem em vez de seções', () => {
  const html = gerar({ itens: [] }, ctxDeMentira());
  assert.match(html, /O acervo ainda não tem itens/);
  assert.equal(contagem(html, /<article/g), 0);
});

test('o script do acervo é carregado de _shared/engine e nada depende de rede ou do app', () => {
  const html = gerarFixture();
  assert.match(html, /<script defer src="\.\.\/_shared\/engine\/acervo\.js"><\/script>/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(gerarFixture(itensBase(), { ctx: { engine: 'engine' } }), /<script defer src="engine\/acervo\.js">/);
  const js = readFileSync(join(ENGINE, 'acervo.js'), 'utf8');
  for (const proibido of [/localStorage|sessionStorage|indexedDB/, /window\.top|parent\.document|window\.parent(?!\.postMessage\(| [!=]==| \|\|)/, /https?:\/\//, /fetch\(|XMLHttpRequest/, /localhost|127\.0\.0\.1|\/api\//, /\binnerHTML\b/, /\beval\(|new Function/]) {
    assert.doesNotMatch(js, proibido, String(proibido));
  }
  // O único contato com o app é a mensagem do "Enviar ao agente", e a resposta só vale vinda dele.
  assert.match(js, /window\.parent\.postMessage\(\{ type: 'mrmak:asset-request'/);
  assert.match(js, /evento\.source !== window\.parent/);
});

test('o item mostra o job de geração e os botões para o agente', () => {
  const itens = itensBase();
  itens[0].geracao = { provedor: 'Meshy', job: 'job-123', modelo: 'meshy-5', data: '2026-10-29', custo: 20 };
  const html = gerarFixture(itens);
  assert.match(html, /<b>Geração:<\/b> Meshy · job <code>job-123<\/code> · meshy-5 · 2026-10-29 · 20 créditos/);
  assert.match(html, /Sem registro de geração/);
  assert.match(html, /data-ac-agente="enviar"/);
  assert.match(html, /data-ac-agente="variacao"/);
  assert.match(html, /&quot;job&quot;:&quot;job-123&quot;/);
});

test('a biblioteca 3D é a do card (lib/), nunca uma cópia em _shared', () => {
  const card = criarCard();
  try {
    mkdirSync(join(card.pasta, 'lib'), { recursive: true });
    writeFileSync(join(card.pasta, 'lib', 'model-viewer-umd.min.js'), '/* lib */');
    const com = gerar({ itens: itensBase() }, ctxDeMentira({ pasta: card.pasta }));
    assert.match(com, /data-ac-lib="lib\/model-viewer-umd\.min\.js" data-ac-lib-ok="sim"/);
    const sem = gerar({ itens: itensBase() }, ctxDeMentira({ pasta: join(card.pasta, 'nao-existe') }));
    assert.match(sem, /data-ac-lib-ok="nao"/);
    assert.doesNotMatch(com, /_shared\/lib|model-viewer[^"]*\.js"><\/script>/);
  } finally { card.limpar(); }
});

test('com o núcleo real: página completa, tema base, report.js e aviso de gerada', () => {
  const card = criarCard();
  try {
    const projeto = comPadroes(PROJETO_BASE);
    const fab = criarFabrica({ pasta: card.pasta, projeto, hoje: '2026-10-17', engineDir: ENGINE });
    const aba = { modulo: 'acervo', nome: 'Acervo', base: 'acervo' };
    const ctx = fab.contexto({ aba, modulo: 'acervo', fonte: 'acervo' });
    const dados = JSON.parse(readFileSync(join(card.pasta, 'acervo.json'), 'utf8'));
    const r = validar(dados, ctx);
    assert.deepEqual(r.erros, []);
    const html = gerar(dados, ctx);
    assert.match(html, /^<!-- Gerado — não edite à mão\. Fonte: acervo\.json/);
    assert.match(html, /<html lang="pt-BR" data-mak-report="document"/);
    assert.match(html, /engine\/tema-base\.css/);
    assert.match(html, /<script defer src="[^"]*\/_shared\/report\.js">/);
    assert.match(html, /<script defer src="[^"]*\/_shared\/engine\/acervo\.js">/);
    assert.match(html, /<meta name="viewport"/);
    assert.match(html, /<title>Acervo · Jogo de Teste<\/title>/);
  } finally { card.limpar(); }
});

test('o CSS do módulo é prefixado com .ac e não define cor fixa (segue o tema claro e escuro)', () => {
  const html = gerarFixture();
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const seletores = [...css.matchAll(/([^{}@]+)\{/g)].map((m) => m[1].trim()).filter((s) => !/^media/.test(s));
  assert.ok(seletores.length > 40);
  for (const s of seletores) for (const parte of s.split(',')) assert.match(parte.trim(), /^\.ac\b/, parte);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, 'cores só por variáveis do tema');
  assert.doesNotMatch(css, /rgb\(|hsl\(/);
});

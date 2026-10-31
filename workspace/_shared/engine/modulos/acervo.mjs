// Módulo Acervo: lê <card>/acervo.json e escreve <card>/acervo.html.
//
// Contrato do motor: validar(dados, ctx) e gerar(dados, ctx). O comportamento do navegador (filtros, comparar,
// visualizador 3D sob demanda) fica em _shared/engine/acervo.js; esta página só carrega o script.
//
// acervo.json
//   itens[]:
//     id            texto em minúsculas, números e hífen; único
//     nome          nome legível
//     categoria     personagens | cenario | construcoes-objetos | interface | audio | arte-chave | uma de categoriasExtras
//     familia       agrupador livre do projeto (minúsculas, números e hífen); vira uma seção recolhível
//     status        vigente | em-avaliacao | descartada   (um eixo só; "main local" etc. vão em `original`/`nota`)
//     versao        número inteiro (1 = v01)
//     miniatura     media/<categoria>/<familia>/<id>-vNN.webp, até 150 KB (opcional só em item de áudio)
//     miniaturaRotulo?  nome da vista que a miniatura mostra (padrão: "Principal")
//     vistas?[]     { rotulo, arquivo: media/<categoria>/<familia>/<id>-vNN-<vista>.webp }
//     modelo3d?     media/.../<id>-vNN.glb, até 3 MB (pede miniatura; o visualizador abre sob demanda)
//     audio?        caminho .ogg/.mp3/.wav/.m4a, ou lista de { rotulo, arquivo } (preload="none")
//     original?     onde está o arquivo de verdade (repositório do jogo, cópia local...), só texto
//     prompt?       media/.../<id>-vNN.prompt.md (vira link), um texto/caminho qualquer, ou lista de { rotulo, arquivo }
//     nota?         texto curto (aceita `código`)
//     geracao?      job que gerou a versão vigente: { provedor, job, modelo?, data? (AAAA-MM-DD), custo? (número de créditos ou texto) }.
//                   Sem ele o item mostra "Sem registro de geração". As skills de geração gravam este bloco quando o job termina.
//     historico?[]  versões anteriores: { versao, miniatura?|audio?, status?, nota? }; ficam recolhidas dentro do item
//   familias?       { "<categoria>/<familia>": "Nome legível" } (padrão: o id com hífens trocados por espaços)
//
// "Comparar" aparece quando o item tem duas ou mais imagens (a miniatura conta como a primeira vista).
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const CATEGORIAS_COMUNS = [
  { id: 'personagens', nome: 'Personagens', icone: 'pessoa' },
  { id: 'cenario', nome: 'Cenário', icone: 'mundo' },
  { id: 'construcoes-objetos', nome: 'Construções e objetos', icone: 'caixa' },
  { id: 'interface', nome: 'Interface', icone: 'painel' },
  { id: 'audio', nome: 'Áudio', icone: 'audio' },
  { id: 'arte-chave', nome: 'Arte-chave', icone: 'estrela' },
];
export const STATUS = {
  vigente: { nome: 'Vigente', tom: 'ok', icone: 'check' },
  'em-avaliacao': { nome: 'Em avaliação', tom: 'atencao', icone: 'relogio' },
  descartada: { nome: 'Descartada', tom: 'neutro', icone: 'arquivo' },
};
export const LIMITE_MINIATURA = 150 * 1024;
export const LIMITE_MODELO = 3 * 1024 * 1024;
export const EXTENSOES_AUDIO = ['ogg', 'mp3', 'wav', 'm4a'];
export const BIBLIOTECA_3D = 'lib/model-viewer-umd.min.js';

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SEG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEXTO_MAX_NOTA = 600;

// ---------- utilidades locais (o módulo funciona também com um ctx mínimo) ----------
const escLocal = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const textoLocal = (s) => escLocal(s).replace(/`([^`\n]+)`/g, '<code>$1</code>');
const urlLocal = (c) => encodeURI(String(c).replace(/\\/g, '/')).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const slugar = (s) => semAcento(s).toLowerCase().trim().replace(/[\s_]+/g, '-');
const ehTexto = (v) => typeof v === 'string' && v.trim() !== '';
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const pad2 = (n) => String(n).padStart(2, '0');
const humanizar = (id) => {
  const t = String(id).replace(/-/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Categorias válidas do projeto: as comuns, na ordem fixa, mais as extras de projeto.json (texto = nome legível). */
export function categoriasDoProjeto(projeto) {
  const extras = [];
  for (const c of projeto?.categoriasExtras ?? []) {
    if (!ehTexto(c)) continue;
    const id = slugar(c);
    if (CATEGORIAS_COMUNS.some((x) => x.id === id) || extras.some((x) => x.id === id)) continue;
    extras.push({ id, nome: c === id ? humanizar(id) : c.trim(), icone: 'livro', extra: true });
  }
  return [...CATEGORIAS_COMUNS, ...extras];
}

/** Nome esperado de um arquivo de mídia deste item. `vista` e `ext` são opcionais. */
export function nomeEsperado(item, versao = item.versao, { vista, ext = 'webp' } = {}) {
  return `media/${item.categoria}/${item.familia}/${item.id}-v${pad2(versao)}${vista ? `-${vista}` : ''}.${ext}`;
}

const ERE = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function padraoNome(item, versao, exts) {
  return new RegExp(`^media/${ERE(item.categoria)}/${ERE(item.familia)}/${ERE(item.id)}-v${pad2(versao)}(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?\\.(?:${exts.map(ERE).join('|')})$`);
}

/** Texto do padrão de nome para este arquivo: media/<categoria>/<familia>/<id>-vNN[-vista].webp. */
export function descricaoPadrao(item, f) {
  return `media/${item.categoria}/${item.familia}/${item.id}-v${pad2(f.versao)}[-vista].${f.exts.length > 1 ? `{${f.exts.join('|')}}` : f.exts[0]}`;
}

/** Lista todos os arquivos que um item usa: [{ caminho, papel, versao, ext: [..], max }] (para validar e conferir mídia). */
export function arquivosDoItem(item) {
  const lista = [];
  const add = (caminho, papel, versao, exts, max) => {
    if (ehTexto(caminho)) lista.push({ caminho, papel, versao, exts, max });
  };
  const v = item.versao;
  add(item.miniatura, 'miniatura', v, ['webp'], LIMITE_MINIATURA);
  for (const [i, vis] of (Array.isArray(item.vistas) ? item.vistas : []).entries()) add(vis?.arquivo, `vista ${i + 1}`, v, ['webp'], LIMITE_MINIATURA);
  add(item.modelo3d, 'modelo 3D', v, ['glb'], LIMITE_MODELO);
  for (const [i, a] of faixasDe(item.audio).entries()) add(a.arquivo, `áudio ${i + 1}`, v, EXTENSOES_AUDIO);
  if (typeof item.prompt === 'string' && item.prompt.startsWith('media/')) add(item.prompt, 'prompt', v, ['prompt.md', 'prompt.txt']);
  if (Array.isArray(item.prompt)) for (const [i, p] of item.prompt.entries()) add(p?.arquivo, `prompt ${i + 1}`, v, ['prompt.md', 'prompt.txt']);
  for (const [i, h] of (Array.isArray(item.historico) ? item.historico : []).entries()) {
    const hv = Number.isInteger(h?.versao) ? h.versao : v;
    add(h?.miniatura, `histórico ${i + 1} (v${pad2(hv)}) miniatura`, hv, ['webp'], LIMITE_MINIATURA);
    for (const [k, a] of faixasDe(h?.audio).entries()) add(a.arquivo, `histórico ${i + 1} (v${pad2(hv)}) áudio ${k + 1}`, hv, EXTENSOES_AUDIO);
  }
  return lista;
}

/** audio aceita texto ou lista de textos ou lista de { rotulo, arquivo }. */
function faixasDe(audio) {
  if (audio == null) return [];
  if (typeof audio === 'string') return [{ rotulo: '', arquivo: audio }];
  if (Array.isArray(audio)) return audio.map((a) => (typeof a === 'string' ? { rotulo: '', arquivo: a } : { rotulo: a?.rotulo ?? '', arquivo: a?.arquivo }));
  return [];
}
function promptsDe(prompt) {
  if (prompt == null) return [];
  if (typeof prompt === 'string') return [{ rotulo: '', arquivo: prompt }];
  if (Array.isArray(prompt)) return prompt.map((p) => ({ rotulo: p?.rotulo ?? '', arquivo: p?.arquivo }));
  return [];
}

// ---------- validação ----------
/**
 * Devolve { erros, avisos }. Com ctx.pasta confere que os arquivos existem e respeitam os limites
 * (ctx.verificarArquivos === false pula essa parte e confere só os campos e os nomes).
 */
export function validar(dados, ctx = {}) {
  const erros = [];
  const avisos = [];
  const onde = 'acervo'; // o motor troca o prefixo "acervo: " por "acervo.json: "
  if (!ehObjeto(dados)) return { erros: [`${onde}: deve ser um objeto com "itens"`], avisos };
  if (!Array.isArray(dados.itens)) return { erros: [`${onde}: falta "itens" (lista)`], avisos };
  if (!dados.itens.length) avisos.push(`${onde}: "itens" está vazia; a aba fica sem conteúdo`);
  const categorias = categoriasDoProjeto(ctx.projeto);
  const idsCategoria = categorias.map((c) => c.id);
  const pasta = ctx.verificarArquivos === false ? undefined : ctx.pasta;

  const ids = new Map(); // id -> posição
  const usados = new Map(); // arquivo -> item
  let temModelo = false;

  dados.itens.forEach((item, i) => {
    if (!ehObjeto(item)) {
      erros.push(`${onde}: item ${i + 1} deve ser um objeto`);
      return;
    }
    const nomeItem = ehTexto(item.nome) ? ` (${item.nome})` : '';
    const q = `${onde}: item ${ehTexto(item.id) ? `"${item.id}"` : i + 1}${nomeItem}`;
    const E = (m) => erros.push(`${q}: ${m}`);

    if (!ehTexto(item.id)) E('falta "id" (texto)');
    else if (!ID.test(item.id)) E(`id "${item.id}" deve ter só minúsculas, números e hífen (ex.: fuzileiro-aco)`);
    else if (ids.has(item.id)) E(`id repetido (já usado no item ${ids.get(item.id) + 1})`);
    if (ehTexto(item.id) && !ids.has(item.id)) ids.set(item.id, i);
    if (!ehTexto(item.nome)) E('falta "nome" (texto legível)');
    if (!ehTexto(item.categoria)) E(`falta "categoria" (uma de: ${idsCategoria.join(', ')})`);
    else if (!idsCategoria.includes(item.categoria)) {
      E(`categoria "${item.categoria}" fora de ${idsCategoria.join(', ')}; para criar uma, liste-a em "categoriasExtras" do projeto.json`);
    }
    if (!ehTexto(item.familia)) E('falta "familia" (texto: minúsculas, números e hífen)');
    else if (!SEG.test(item.familia)) E(`familia "${item.familia}" deve ter só minúsculas, números e hífen (ex.: unidades-modulares)`);
    if (!ehTexto(item.status)) E(`falta "status" (um de: ${Object.keys(STATUS).join(', ')})`);
    else if (!STATUS[item.status]) {
      const dica = STATUS[slugar(item.status)] ? `; escreva exatamente "${slugar(item.status)}"` : '';
      E(`status "${item.status}" fora de ${Object.keys(STATUS).join(', ')}${dica}. "main local", "só no GitHub" e "fora do repositório" não são status: ponha em "original" ou "nota"`);
    }
    if (!Number.isInteger(item.versao) || item.versao < 1 || item.versao > 999) E('"versao" deve ser um número inteiro de 1 a 999 (1 vira v01)');
    if (item.nota !== undefined) {
      if (!ehTexto(item.nota)) E('"nota" deve ser texto');
      else if (item.nota.length > TEXTO_MAX_NOTA) avisos.push(`${q}: "nota" com ${item.nota.length} caracteres; prefira até ${TEXTO_MAX_NOTA}`);
    }
    if (item.original !== undefined && !ehTexto(item.original)) E('"original" deve ser texto (caminho no repositório do jogo)');
    if (item.miniaturaRotulo !== undefined && !ehTexto(item.miniaturaRotulo)) E('"miniaturaRotulo" deve ser texto');

    const temAudio = item.audio !== undefined && item.audio !== null;
    if (!ehTexto(item.miniatura) && !temAudio) E('falta "miniatura" (media/<categoria>/<familia>/<id>-vNN.webp); só item de áudio pode ficar sem imagem');
    if (item.modelo3d && !ehTexto(item.miniatura)) E('"modelo3d" pede "miniatura": ela é a imagem do item antes de abrir o 3D');
    if (item.vistas !== undefined && !Array.isArray(item.vistas)) E('"vistas" deve ser uma lista de { rotulo, arquivo }');
    if (Array.isArray(item.vistas)) {
      const rotulos = new Set();
      item.vistas.forEach((v, k) => {
        if (!ehObjeto(v) || !ehTexto(v.rotulo) || !ehTexto(v.arquivo)) E(`vista ${k + 1} deve ter "rotulo" e "arquivo"`);
        else {
          if (rotulos.has(v.rotulo)) avisos.push(`${q}: vista com rótulo repetido: "${v.rotulo}"`);
          rotulos.add(v.rotulo);
        }
      });
    }
    if (item.audio !== undefined && item.audio !== null) {
      const a = item.audio;
      const ok = typeof a === 'string' || (Array.isArray(a) && a.length && a.every((x) => typeof x === 'string' || (ehObjeto(x) && ehTexto(x.arquivo))));
      if (!ok) E('"audio" deve ser um caminho ou uma lista de { rotulo, arquivo }');
      else if (Array.isArray(a) && a.length > 1 && !a.every((x) => ehObjeto(x) && ehTexto(x.rotulo))) E('"audio" com várias faixas pede "rotulo" em cada uma');
    }
    if (item.prompt !== undefined && item.prompt !== null) {
      const p = item.prompt;
      const ok = typeof p === 'string' ? ehTexto(p) : Array.isArray(p) && p.length && p.every((x) => ehObjeto(x) && ehTexto(x.arquivo) && ehTexto(x.rotulo));
      if (!ok) E('"prompt" deve ser texto ou uma lista de { rotulo, arquivo }');
    }

    if (item.geracao !== undefined && item.geracao !== null) {
      const g = item.geracao;
      if (!ehObjeto(g)) E('"geracao" deve ser um objeto { provedor, job, modelo?, data?, custo? }');
      else {
        if (!ehTexto(g.provedor)) E('"geracao.provedor" deve ser o nome do provedor (Meshy, Higgsfield, fal, ElevenLabs...)');
        if (!ehTexto(g.job)) E('"geracao.job" deve ser o ID do job no provedor');
        if (g.modelo !== undefined && !ehTexto(g.modelo)) E('"geracao.modelo" deve ser texto');
        if (g.data !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(g.data))) E('"geracao.data" deve estar no formato AAAA-MM-DD');
        if (g.custo !== undefined && !(typeof g.custo === 'number' && g.custo >= 0) && !ehTexto(g.custo)) E('"geracao.custo" deve ser um número de créditos ou um texto');
        const extras = Object.keys(g).filter((k) => !['provedor', 'job', 'modelo', 'data', 'custo'].includes(k));
        if (extras.length) E(`"geracao" não aceita ${extras.join(', ')}: guarde só provedor, job, modelo, data e custo`);
      }
    }

    // histórico
    if (item.historico !== undefined && !Array.isArray(item.historico)) E('"historico" deve ser uma lista');
    if (Array.isArray(item.historico)) {
      const vs = new Set();
      item.historico.forEach((h, k) => {
        const qh = `histórico ${k + 1}`;
        if (!ehObjeto(h)) { E(`${qh} deve ser um objeto`); return; }
        if (!Number.isInteger(h.versao) || h.versao < 1) E(`${qh}: "versao" deve ser um número inteiro (v01 = 1)`);
        else {
          if (h.versao === item.versao) E(`${qh}: a v${pad2(h.versao)} é a versão vigente; o histórico guarda só as anteriores`);
          else if (Number.isInteger(item.versao) && h.versao > item.versao) avisos.push(`${q}: ${qh} (v${pad2(h.versao)}) é mais nova que a versão vigente (v${pad2(item.versao)})`);
          if (vs.has(h.versao)) E(`${qh}: versão v${pad2(h.versao)} repetida`);
          vs.add(h.versao);
        }
        if (h.status !== undefined && !STATUS[h.status]) E(`${qh}: status "${h.status}" fora de ${Object.keys(STATUS).join(', ')}`);
        if (h.nota !== undefined && !ehTexto(h.nota)) E(`${qh}: "nota" deve ser texto`);
        if (!ehTexto(h.miniatura) && (h.audio === undefined || h.audio === null)) E(`${qh}: falta "miniatura" (ou "audio")`);
      });
    }

    // arquivos: nome, existência e limites
    if (ehTexto(item.id) && ehTexto(item.categoria) && ehTexto(item.familia) && Number.isInteger(item.versao)) {
      for (const f of arquivosDoItem(item)) {
        const rotulo = `${f.papel} "${f.caminho}"`;
        if (/^[a-z][a-z0-9+.-]*:/i.test(f.caminho) || f.caminho.startsWith('/') || f.caminho.includes('\\') || f.caminho.split('/').includes('..')) {
          E(`${rotulo}: use um caminho relativo à pasta do card, com "/" e sem ".."`);
          continue;
        }
        if (!padraoNome(item, f.versao, f.exts).test(f.caminho)) E(`${rotulo} fora do padrão; para este item use ${descricaoPadrao(item, f)}`);
        const dono = usados.get(f.caminho);
        if (dono && dono !== item.id) E(`${rotulo} já é usado pelo item "${dono}"`);
        else if (dono === item.id) E(`${rotulo} aparece duas vezes no mesmo item`);
        usados.set(f.caminho, item.id);
        if (pasta) {
          const arq = join(pasta, f.caminho);
          if (!existsSync(arq) || !statSync(arq).isFile()) E(`${rotulo}: arquivo não existe`);
          else if (f.max && statSync(arq).size > f.max) E(`${rotulo} tem ${Math.ceil(statSync(arq).size / 1024)} KB, acima do limite de ${Math.round(f.max / 1024)} KB`);
        }
      }
    }
    if (item.modelo3d) temModelo = true;
  });

  if (dados.familias !== undefined) {
    if (!ehObjeto(dados.familias)) erros.push(`${onde}: "familias" deve ser um objeto { "categoria/familia": "Nome" }`);
    else {
      for (const [k, v] of Object.entries(dados.familias)) {
        if (!ehTexto(v)) erros.push(`${onde}: familias "${k}": o nome deve ser texto`);
        else if (!dados.itens.some((it) => ehObjeto(it) && `${it.categoria}/${it.familia}` === k)) avisos.push(`${onde}: familias "${k}": nenhum item usa essa família`);
      }
    }
  }
  if (temModelo && pasta && !existsSync(join(pasta, BIBLIOTECA_3D))) {
    avisos.push(`${onde}: há modelos 3D, mas falta ${BIBLIOTECA_3D} no card; o botão "Ver em 3D" vai avisar que o visualizador não está disponível`);
  }
  return { erros, avisos };
}

// ---------- geração ----------
const CSS_BRUTO = `
.ac{margin:0}
.ac *{box-sizing:border-box}
.ac [hidden]{display:none!important}
.ac-barra{display:grid;gap:12px;margin:0 0 18px;padding:14px 16px;border:1px solid var(--mk-linha);border-radius:var(--mk-raio);background:var(--mk-fundo-1)}
.ac-grupo{display:grid;gap:5px;min-width:0}
.ac-grupo>b{font:600 11px/1.4 var(--mak-font);letter-spacing:.12em;text-transform:uppercase;color:var(--mk-suave)}
.ac-filtros{display:flex;flex-wrap:wrap;gap:6px}
.ac-filtros .mk-filtro{min-height:38px}
.ac-filtros .mk-filtro small{font-weight:500;color:var(--mk-suave)}
.ac-filtros .mk-filtro[aria-pressed=true] small{color:inherit}
.ac-linha{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px}
.ac-busca{flex:1 1 220px;min-width:0}
.ac-busca input{width:100%;min-height:38px;padding:7px 12px;border:1px solid var(--mk-linha-forte);border-radius:8px;background:var(--mak-bg);color:var(--mak-text);font:500 14px var(--mak-font)}
.ac-busca input::placeholder{color:var(--mk-suave)}
.ac-total{margin:0;font-size:13px;color:var(--mk-suave)}
.ac-acoes-gerais{display:flex;gap:6px}
.ac-acoes-gerais .mk-filtro:disabled{opacity:.45;cursor:default}
.ac-cat{margin:0 0 16px;padding:0;border:1px solid var(--mk-linha);border-radius:var(--mk-raio);background:var(--mk-fundo-1)}
.ac-cat>summary,.ac-fam>summary{display:flex;align-items:center;gap:10px;cursor:pointer;list-style:none}
.ac-cat>summary::-webkit-details-marker,.ac-fam>summary::-webkit-details-marker{display:none}
.ac-cat>summary{padding:14px clamp(14px,2vw,20px)}
.ac-cat>summary h2{flex:1;min-width:0;margin:0}
.ac-cat>summary::after,.ac-fam>summary::after{content:"";flex:none;width:8px;height:8px;border-right:2px solid var(--mk-suave);border-bottom:2px solid var(--mk-suave);transform:rotate(-45deg);margin-right:4px}
.ac-cat[open]>summary::after,.ac-fam[open]>summary::after{transform:rotate(45deg)}
.ac-cat-corpo{padding:0 clamp(10px,2vw,16px) 12px}
.ac-cont{flex:none;font:500 12.5px var(--mak-font);color:var(--mk-suave);white-space:nowrap}
.ac-fam{margin:0 0 8px;border:1px solid var(--mk-linha);border-radius:8px;background:var(--mak-bg)}
.ac-fam>summary{padding:11px 14px;min-height:46px}
.ac-fam>summary .ac-nome-fam{flex:1;min-width:0;font:600 14.5px/1.4 var(--mak-font)}
.ac-grade{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,232px),1fr));gap:12px;padding:4px 12px 14px;align-items:start}
.ac-item{min-width:0;display:flex;flex-direction:column;border:1px solid var(--mk-linha);border-radius:8px;background:var(--mk-fundo-1);overflow:hidden}
.ac-item.ac-ampliado{grid-column:1/-1}
.ac-midia{display:grid;place-items:center;aspect-ratio:4/3;border-bottom:1px solid var(--mk-linha);background-color:var(--mk-fundo-2);background-image:conic-gradient(var(--mk-fundo-1) 25%,transparent 0 50%,var(--mk-fundo-1) 0 75%,transparent 0);background-size:16px 16px}
.ac-midia img{display:block;width:100%;height:100%;object-fit:contain}
.ac-som{display:grid;place-items:center;color:var(--mk-acento-texto)}
.ac-som .mk-ico{width:44px;height:44px}
.ac-corpo{display:flex;flex-direction:column;gap:8px;padding:10px 12px 12px;min-width:0}
.ac-item h3{margin:0;padding:0;border:0;font:600 15px/1.35 var(--mak-font);letter-spacing:0}
.ac-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0}
.ac-vistas{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}
.ac-vistas figure{width:68px;margin:0}
.ac-vistas img{display:block;width:68px;height:51px;object-fit:cover;border:1px solid var(--mk-linha);border-radius:6px;background:var(--mk-fundo-2)}
.ac-vistas figcaption{margin-top:3px;font-size:10.5px;line-height:1.25;color:var(--mk-suave);overflow-wrap:anywhere;max-height:2.6em;overflow:hidden}
.ac-faixas{display:grid;gap:8px;margin:0;padding:0;list-style:none}
.ac-faixas li{display:grid;gap:3px}
.ac-faixas span{font-size:12px;color:var(--mk-suave)}
.ac-faixas audio{width:100%;height:36px}
.ac-geracao code{font-size:11.5px}.ac-sem-registro{opacity:.7;font-style:italic}.ac-aviso{margin:4px 0 0;font-size:12px;color:var(--mk-suave)}
.ac-nota,.ac-orig,.ac-prompt,.ac-geracao{margin:0;font-size:12.5px;line-height:1.55;color:var(--mk-suave)}
.ac-nota{color:var(--mak-text);font-size:13px}
.ac-orig code{font-size:11.5px;overflow-wrap:anywhere}
.ac-orig b,.ac-prompt b{font-weight:600;color:var(--mak-text)}
.ac-prompt a{margin-right:10px}
.ac-botoes{display:flex;flex-wrap:wrap;gap:6px;margin:0}
.ac-botoes .mk-filtro{min-height:36px}
.ac-hist{margin:0;border-top:1px solid var(--mk-linha);padding-top:6px}
.ac-hist>summary{cursor:pointer;font:600 12.5px var(--mak-font);color:var(--mk-suave);padding:4px 0}
.ac-hist ul{display:grid;gap:10px;margin:8px 0 0;padding:0;list-style:none}
.ac-hist li{display:grid;grid-template-columns:72px minmax(0,1fr);gap:4px 10px;align-items:start}
.ac-hist li img{display:block;width:72px;height:54px;object-fit:cover;border:1px solid var(--mk-linha);border-radius:6px;background:var(--mk-fundo-2)}
.ac-hist li div{display:grid;gap:3px;min-width:0;font-size:12.5px;line-height:1.5}
.ac-hist li audio{grid-column:1/-1;width:100%;height:36px}
.ac-painel{margin:0;border:1px solid var(--mk-linha-forte);border-radius:8px;background:var(--mak-bg);overflow:hidden}
.ac-painel-barra{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:8px 10px;border-bottom:1px solid var(--mk-linha)}
.ac-painel-barra strong{flex:1 1 140px;min-width:0;font:600 13px var(--mak-font)}
.ac-painel-barra label{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--mk-suave)}
.ac-painel-barra select{min-height:34px;max-width:100%;padding:3px 8px;border:1px solid var(--mk-linha-forte);border-radius:6px;background:var(--mak-bg);color:var(--mak-text);font:500 12.5px var(--mak-font)}
.ac-painel-barra .mk-filtro{min-height:34px;padding:4px 10px}
.ac-painel-aviso{margin:0;padding:12px;font-size:13px;color:var(--mk-suave)}
.ac-3d model-viewer{display:block;width:100%;height:min(62vh,360px);background:var(--mk-fundo-2)}
.ac-comp-palco{position:relative;width:100%;max-height:70vh;margin:0 auto;background-color:var(--mk-fundo-2);overflow:hidden;touch-action:pan-y;user-select:none;-webkit-user-select:none}
.ac-comp-palco img{pointer-events:none;position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.ac-comp-topo{position:absolute;inset:0;clip-path:inset(0 50% 0 0)}
.ac-comp-linha{position:absolute;top:0;bottom:0;left:50%;width:2px;margin-left:-1px;background:var(--mk-acento);box-shadow:0 0 0 1px color-mix(in srgb,var(--mak-bg) 70%,transparent);pointer-events:none}
.ac-comp-linha::after{content:"";position:absolute;top:50%;left:50%;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:2px solid var(--mk-acento);background:var(--mak-bg)}
.ac-comp-palco.ac-lado{display:grid;grid-template-columns:1fr 1fr;gap:2px;aspect-ratio:auto!important}
.ac-comp-palco.ac-lado figure{position:relative;margin:0;aspect-ratio:var(--ac-razao,4/3);background:var(--mk-fundo-2)}
.ac-comp-palco.ac-lado img{pointer-events:auto;cursor:zoom-in}
.ac-comp-palco.ac-lado .ac-comp-linha,.ac-comp-palco.ac-lado .ac-comp-topo{display:none}
.ac-comp-ctrl{display:grid;gap:6px;padding:10px 12px 12px}
.ac-comp-ctrl input[type=range]{width:100%;height:30px;accent-color:var(--mk-acento)}
.ac-comp-rot{display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--mk-suave)}
.ac-comp-rot span{min-width:0;overflow-wrap:anywhere}
.ac-modos{display:flex;gap:4px}
.ac-vazio{margin:0;padding:18px;text-align:center}
.ac-legenda{margin:18px 0 0;font-size:12px;color:var(--mk-suave)}
@media(max-width:600px){
  .ac-barra{padding:12px}
  .ac-fam>summary{padding:10px 12px}
  .ac-grade{padding:4px 8px 12px}
  .ac-painel-barra select{max-width:42vw}
}
`;

// Todo seletor ganha o prefixo .ac para vencer o report.css (html[data-mak-report=document] p, h3, img...) sem !important.
const CSS = CSS_BRUTO.replace(/([^{}@]+)\{([^{}]*)\}/g, (_, sels, corpo) => `${sels.split(',').map((x) => {
  const t = x.trim();
  return /^\.ac(?:$|[\s.[:>#])/.test(t) ? t : `.ac ${t}`;
}).join(',')}{${corpo}}`);

export function gerar(dados, ctx) {
  const esc = ctx.esc ?? escLocal;
  const texto = ctx.texto ?? textoLocal;
  const urlRel = (c) => urlLocal(c);
  const icone = (nome, extra = '') => (ctx.ui?.icone ? ctx.ui.icone(nome, ctx, extra) : `<span class="mk-ico mk-i-${nome}${extra ? ' ' + extra : ''}" aria-hidden="true"></span>`);
  const chip = (rotulo, tom, ic) => (ctx.ui?.chip ? ctx.ui.chip(rotulo, tom, ic) : `<span class="mk-chip mk-${tom}">${ic}${esc(rotulo)}</span>`);
  const categorias = categoriasDoProjeto(ctx.projeto);
  const itens = (dados.itens ?? []).filter(ehObjeto);
  const familiasNomes = ehObjeto(dados.familias) ? dados.familias : {};
  const nomeFamilia = (cat, fam) => familiasNomes[`${cat}/${fam}`] ?? humanizar(fam);
  const total = itens.length;
  const porStatus = Object.fromEntries(Object.keys(STATUS).map((s) => [s, itens.filter((i) => i.status === s).length]));
  const lib = BIBLIOTECA_3D;
  const libExiste = Boolean(ctx.pasta && existsSync(join(ctx.pasta, BIBLIOTECA_3D)));
  const n = (k, s, p) => `${k} ${k === 1 ? s : p}`;

  const imagem = (arquivo, alt, rotulo) => `<img src="${esc(urlRel(arquivo))}" alt="${esc(alt)}" loading="lazy" decoding="async" data-ac-img data-rotulo="${esc(rotulo)}">`;

  const cartao = (item) => {
    const st = STATUS[item.status] ?? STATUS['em-avaliacao'];
    const cat = categorias.find((c) => c.id === item.categoria);
    const imagens = [];
    if (item.miniatura) imagens.push({ arquivo: item.miniatura, rotulo: item.miniaturaRotulo || 'Principal', principal: true });
    for (const v of Array.isArray(item.vistas) ? item.vistas : []) if (ehObjeto(v) && v.arquivo) imagens.push({ arquivo: v.arquivo, rotulo: v.rotulo || 'Vista' });
    const faixas = faixasDe(item.audio).filter((a) => a.arquivo);
    const prompts = promptsDe(item.prompt).filter((p) => p.arquivo);
    const hist = (Array.isArray(item.historico) ? item.historico : []).filter(ehObjeto).slice().sort((a, b) => (b.versao ?? 0) - (a.versao ?? 0));
    const altDe = (rotulo, principal) => (principal && !item.miniaturaRotulo ? item.nome : `${item.nome}, ${rotulo}`);

    const busca = semAcento([item.nome, item.id, cat?.nome, nomeFamilia(item.categoria, item.familia), item.nota, item.original, ...imagens.map((x) => x.rotulo)].filter(Boolean).join(' ')).toLowerCase();

    let midia;
    if (imagens.length) midia = `<div class="ac-midia">${imagem(imagens[0].arquivo, altDe(imagens[0].rotulo, true), imagens[0].rotulo)}</div>`;
    else midia = `<div class="ac-midia ac-som">${icone('audio')}</div>`;

    const vistas = imagens.length > 1
      ? `\n      <ul class="ac-vistas" aria-label="Vistas de ${esc(item.nome)}">${imagens.slice(1).map((v) => `<li><figure>${imagem(v.arquivo, altDe(v.rotulo), v.rotulo)}<figcaption>${esc(v.rotulo)}</figcaption></figure></li>`).join('')}</ul>`
      : '';
    const audio = faixas.length
      ? `\n      <ul class="ac-faixas">${faixas.map((a) => `<li>${a.rotulo ? `<span>${esc(a.rotulo)}</span>` : ''}<audio controls preload="none" src="${esc(urlRel(a.arquivo))}" aria-label="${esc(a.rotulo ? `${item.nome}, ${a.rotulo}` : item.nome)}"></audio></li>`).join('')}</ul>`
      : '';
    const nota = item.nota ? `\n      <p class="ac-nota">${texto(item.nota)}</p>` : '';
    const original = item.original ? `\n      <p class="ac-orig"><b>Original:</b> <code>${esc(item.original)}</code></p>` : '';
    let prompt = '';
    if (prompts.length) {
      const partes = prompts.map((p) => {
        const rot = p.rotulo ? ` (${esc(p.rotulo)})` : '';
        return /^media\//.test(p.arquivo)
          ? `<a href="${esc(urlRel(p.arquivo))}" download>Prompt${rot}</a>`
          : `<code>${esc(p.arquivo)}</code>${rot}`;
      });
      prompt = `\n      <p class="ac-prompt"><b>Prompt:</b> ${partes.join(' ')}</p>`;
    }
    const g = ehObjeto(item.geracao) ? item.geracao : null;
    const geracao = g
      ? `
      <p class="ac-geracao"><b>Geração:</b> ${[esc(g.provedor), `job <code>${esc(g.job)}</code>`, g.modelo && esc(g.modelo), g.data && esc(g.data), g.custo !== undefined && (typeof g.custo === 'number' ? `${g.custo} créditos` : esc(g.custo))].filter(Boolean).join(' · ')}</p>`
      : `
      <p class="ac-geracao ac-sem-registro">Sem registro de geração</p>`;
    // O que o app recebe quando o dono manda o item para um agente.
    const ativo = { card: ctx.projeto?.id, projeto: ctx.projeto?.titulo, repositorio: ctx.projeto?.repositorio, id: item.id, nome: item.nome, categoria: item.categoria, versao: item.versao ?? 1, status: item.status, original: item.original, prompt: prompts.map((p) => (p.rotulo ? `${p.rotulo}: ${p.arquivo}` : p.arquivo)), geracao: g, miniatura: item.miniatura };
    const botoes = [];
    botoes.push(`<button type="button" class="mk-filtro" data-ac-agente="enviar" data-ativo="${esc(JSON.stringify(ativo))}">Enviar ao agente</button>`);
    botoes.push(`<button type="button" class="mk-filtro" data-ac-agente="variacao" data-ativo="${esc(JSON.stringify(ativo))}">Gerar variação</button>`);
    if (imagens.length >= 2) botoes.push(`<button type="button" class="mk-filtro" data-ac-comparar aria-expanded="false">Comparar</button>`);
    if (item.modelo3d) botoes.push(`<button type="button" class="mk-filtro" data-ac-3d data-glb="${esc(urlRel(item.modelo3d))}" data-titulo="${esc(item.nome)}" aria-expanded="false">Ver em 3D</button>`);
    const acoes = botoes.length ? `\n      <p class="ac-botoes">${botoes.join('')}</p>` : '';
    const historico = hist.length
      ? `\n      <details class="ac-hist"><summary>Versões anteriores (${hist.length})</summary><ul>${hist.map((h) => {
        const hs = STATUS[h.status] ?? STATUS.descartada;
        const nomeVersao = `v${pad2(h.versao ?? 0)}`;
        const img = h.miniatura ? imagem(h.miniatura, `${item.nome}, versão ${nomeVersao}`, nomeVersao) : `<div class="ac-som">${icone('audio')}</div>`;
        const aud = faixasDe(h.audio).filter((a) => a.arquivo).map((a) => `<audio controls preload="none" src="${esc(urlRel(a.arquivo))}" aria-label="${esc(`${item.nome}, ${nomeVersao}${a.rotulo ? ', ' + a.rotulo : ''}`)}"></audio>`).join('');
        return `<li>${img}<div><span>${chip(hs.nome, hs.tom, icone(hs.icone))} <span class="mk-id">${nomeVersao}</span></span>${h.nota ? `<span>${texto(h.nota)}</span>` : ''}</div>${aud}</li>`;
      }).join('')}</ul></details>`
      : '';

    return `    <article class="ac-item" id="item-${esc(item.id)}" data-id="${esc(item.id)}" data-categoria="${esc(item.categoria)}" data-familia="${esc(item.familia)}" data-status="${esc(item.status)}" data-busca="${esc(busca)}">
      ${midia}
      <div class="ac-corpo">
      <h3>${esc(item.nome)}</h3>
      <p class="ac-meta">${chip(st.nome, st.tom, icone(st.icone))}<span class="mk-id">v${pad2(item.versao ?? 1)}</span>${item.modelo3d ? '<span class="mk-id">3D</span>' : ''}</p>${vistas}${audio}${nota}${original}${prompt}${geracao}${acoes}<p class="ac-aviso" data-ac-aviso role="status" hidden></p>${historico}
      </div>
    </article>`;
  };

  // categorias na ordem fixa; famílias na ordem em que aparecem no JSON
  const blocos = [];
  for (const cat of categorias) {
    const daCat = itens.filter((i) => i.categoria === cat.id);
    if (!daCat.length) continue;
    const familias = [];
    for (const i of daCat) if (!familias.includes(i.familia)) familias.push(i.familia);
    const secoes = familias.map((fam) => {
      const lista = daCat.filter((i) => i.familia === fam);
      return `  <details class="ac-fam" data-familia="${esc(fam)}" data-total="${lista.length}" id="fam-${esc(cat.id)}-${esc(fam)}">
    <summary><span class="ac-nome-fam">${esc(nomeFamilia(cat.id, fam))}</span><span class="ac-cont" data-ac-cont>${n(lista.length, 'item', 'itens')}</span></summary>
    <div class="ac-grade">
${lista.map(cartao).join('\n')}
    </div>
  </details>`;
    });
    blocos.push(`<details class="ac-cat" open data-categoria="${esc(cat.id)}" data-total="${daCat.length}" id="cat-${esc(cat.id)}">
  <summary><h2 class="mk-t">${icone(cat.icone)}${esc(cat.nome)}</h2><span class="ac-cont" data-ac-cont>${n(daCat.length, 'item', 'itens')}</span></summary>
  <div class="ac-cat-corpo">
${secoes.join('\n')}
  </div>
</details>`);
  }

  const botaoFiltro = (tipo, valor, rotulo, quantidade, ic = '') => `<button type="button" class="mk-filtro" data-ac-filtro="${tipo}" data-valor="${esc(valor)}" aria-pressed="${valor === '' ? 'true' : 'false'}">${ic}${esc(rotulo)} <small data-ac-n>${quantidade}</small></button>`;
  const catComItens = categorias.filter((c) => itens.some((i) => i.categoria === c.id));
  const barra = `<section class="ac-barra" aria-label="Filtros do acervo">
  <div class="ac-grupo"><b id="ac-rot-cat">Categoria</b>
    <div class="ac-filtros" role="group" aria-labelledby="ac-rot-cat">${botaoFiltro('categoria', '', 'Todas', total)}${catComItens.map((c) => botaoFiltro('categoria', c.id, c.nome, itens.filter((i) => i.categoria === c.id).length, icone(c.icone))).join('')}</div></div>
  <div class="ac-grupo"><b id="ac-rot-st">Status</b>
    <div class="ac-filtros" role="group" aria-labelledby="ac-rot-st">${botaoFiltro('status', '', 'Todos', total)}${Object.entries(STATUS).map(([id, s]) => botaoFiltro('status', id, s.nome, porStatus[id], icone(s.icone))).join('')}</div></div>
  <div class="ac-linha">
    <label class="ac-busca"><input type="search" placeholder="Buscar por nome, nota ou original" data-ac-busca autocomplete="off" aria-label="Buscar no acervo"></label>
    <div class="ac-acoes-gerais" role="group" aria-label="Seções">
      <button type="button" class="mk-filtro" data-ac-expandir>Expandir tudo</button>
      <button type="button" class="mk-filtro" data-ac-recolher>Recolher tudo</button>
    </div>
  </div>
  <p class="ac-total" data-ac-total role="status" aria-live="polite">${n(total, 'item', 'itens')}</p>
</section>`;

  const vazio = `<p class="ac-vazio mk-vazio" data-ac-vazio hidden>Nenhum item com esses filtros.</p>`;
  const corpo = `<style>${CSS}</style>
<div class="ac mk-pag" data-ac data-ac-lib="${esc(lib)}" data-ac-lib-ok="${libExiste ? 'sim' : 'nao'}">
${barra}
${vazio}
${blocos.length ? blocos.join('\n') : '<p class="ac-vazio mk-vazio">O acervo ainda não tem itens.</p>'}
<p class="ac-legenda">Toque numa imagem para ampliar e baixar a prévia. O original fica no repositório do jogo, no caminho indicado em cada item.</p>
</div>`;

  const partesSub = [n(total, 'item', 'itens'), n(porStatus.vigente, 'vigente', 'vigentes'), `${porStatus['em-avaliacao']} em avaliação`, n(porStatus.descartada, 'descartada', 'descartadas')];
  return ctx.pagina({
    titulo: ctx.aba?.nome ?? 'Acervo',
    subtitulo: esc(partesSub.join(' · ')),
    corpo,
    scripts: `<script defer src="${esc(`${ctx.engine ?? '../_shared/engine'}/acervo.js`)}"></script>`,
  });
}

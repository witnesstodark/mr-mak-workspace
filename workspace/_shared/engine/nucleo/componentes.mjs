// Peças de HTML reaproveitadas pelos módulos. Todo texto vindo do JSON passa por esc() ou texto().
import { esc, texto, urlRelativa } from './esc.mjs';
import { ICONES } from './icones.mjs';
import { miniaturasDe } from './calculos.mjs';
import { dataLonga } from './datas.mjs';

const NOME_ICONE = /^[a-z0-9-]+$/;

/** Ícone de CSS. Num tema próprio qualquer nome vale (o temaCss o define); no base, nome desconhecido vira ponto. */
export function icone(nome, ctx = {}, extra = '') {
  const n = typeof nome === 'string' && NOME_ICONE.test(nome) ? nome : 'ponto';
  const usado = ctx.custom || ICONES[n] ? n : 'ponto';
  return `<span class="mk-ico mk-i-${usado}${extra ? ' ' + extra : ''}" aria-hidden="true"></span>`;
}

/** tom: ok, atencao, erro, info, neutro, destaque. */
export function chip(conteudo, tom = 'neutro', iconeHtml = '') {
  return `<span class="mk-chip mk-${tom}">${iconeHtml}${esc(conteudo)}</span>`;
}

export function porcentagem(feito, total) {
  if (!total || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((feito / total) * 1000) / 10));
}

/** Barra de progresso acessível. `legenda` descreve o que está sendo medido. */
export function barra(feito, total, { legenda = 'Progresso', mini = false } = {}) {
  const p = porcentagem(feito, total);
  return `<div class="mk-barra${mini ? ' mk-barra-mini' : ''}" role="progressbar" aria-label="${esc(legenda)}" aria-valuemin="0" aria-valuemax="${Number(total) || 0}" aria-valuenow="${Number(feito) || 0}"><i style="width:${p}%"></i></div>`;
}

/** Linha de progresso por fases: feita, atual e futura. */
export function linhaFases(fases) {
  // fases: [{ nome, estado: 'feita' | 'atual' | 'futura', rotulo }]
  const itens = fases.map(f => {
    const classe = { feita: 'mk-feita', atual: 'mk-atual', futura: 'mk-futura' }[f.estado] ?? 'mk-futura';
    return `<li class="${classe}"${f.estado === 'atual' ? ' aria-current="step"' : ''}>${esc(f.nome)}<small>${esc(f.rotulo ?? f.estado)}</small></li>`;
  });
  return `<ol class="mk-fases" aria-label="Fases do roteiro">\n${itens.join('\n')}\n</ol>`;
}

export function bloco(titulo, conteudo, { icone: ic, ctx, classe = '', id } = {}) {
  const cab = titulo ? `<h2 class="mk-t">${ic ? icone(ic, ctx) : ''}${esc(titulo)}</h2>\n` : '';
  return `<section class="mk-bloco${classe ? ' ' + classe : ''}"${id ? ` id="${esc(id)}"` : ''}>\n${cab}${conteudo}\n</section>`;
}

/** tabela: cabecalho = [texto], linhas = [[htmlDaCelula]]; centro = índices de colunas centralizadas. */
export function tabela({ cabecalho, linhas, classe = '', centro = [], legenda }) {
  const c = i => (centro.includes(i) ? ' class="mk-c"' : '');
  const th = cabecalho.map((h, i) => `<th${c(i)} scope="col">${esc(h)}</th>`).join('');
  const tr = linhas.map(l => `<tr>${l.map((cel, i) => `<td${c(i)}>${cel}</td>`).join('')}</tr>`).join('\n');
  return `<div class="mk-rolagem"><table class="mk-tabela ${classe}">${legenda ? `<caption class="mk-nota">${esc(legenda)}</caption>` : ''}\n<thead><tr>${th}</tr></thead>\n<tbody>\n${tr}\n</tbody>\n</table></div>`;
}

/** <img> comum: o report.js abre a prévia com download. Nada de ícone ou capa aqui. */
export function imagem(arquivo, alt) {
  return `<img src="${esc(urlRelativa(arquivo))}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
}

export function miniaturasHtml(e) {
  const itens = miniaturasDe(e);
  if (!itens.length) return '';
  const imgs = itens.map((m, i) => imagem(m.arquivo, m.legenda ?? (itens.length > 1 ? `${e.titulo} (${i + 1} de ${itens.length})` : e.titulo))).join('\n    ');
  return `\n  <div class="mk-miniaturas" data-n="${Math.min(itens.length, 2)}">\n    ${imgs}\n  </div>`;
}

function areaDe(projeto, id) {
  return (projeto?.areas ?? []).find(a => a.id === id);
}

/** Cartão de uma entrega. Mesmo conteúdo e ordem do cartão do Global Empires. */
export function cartaoEntrega(e, ctx) {
  const area = areaDe(ctx.projeto, e.area);
  const pendente = e.estado !== 'main' ? ' mk-pendente' : '';
  const links = (e.links ?? []).map(l => `<a href="${esc(l.url)}">${esc(l.rotulo)}</a>`).join('');
  const refs = (e.refs ?? []).map(r => `<code>${esc(r)}</code>`).join(' ');
  const cor = area?.cor ? ` style="--mk-cor:${esc(area.cor)}"` : '';
  return `<article class="mk-entrega" data-area="${esc(e.area)}"${cor}>
  <div class="mk-corpo">
    <div class="mk-meta"><span class="mk-tag">${icone(area?.icone, ctx)}${esc(e.area)}</span><span class="mk-estado${pendente}">${esc(e.estado)}</span>${refs}</div>
    <h3>${texto(e.titulo)}</h3>
    <p>${texto(e.resumo)}</p>${e.olhar ? `\n    <p class="mk-olhar"><strong>O que olhar:</strong> ${texto(e.olhar)}</p>` : ''}${links ? `\n    <p class="mk-links">${links}</p>` : ''}
  </div>${miniaturasHtml(e)}
</article>`;
}

/** Agrupa por dia (a lista já vem ordenada) e desenha um grupo por dia. */
export function entregasPorDia(lista, ctx) {
  const dias = new Map();
  for (const e of lista) { if (!dias.has(e.data)) dias.set(e.data, []); dias.get(e.data).push(e); }
  return [...dias].map(([dia, itens]) => `<div class="mk-grupo" data-dia="${dia}">\n<h2 class="mk-dia">${dataLonga(dia)}</h2>\n${itens.map(e => cartaoEntrega(e, ctx)).join('\n')}\n</div>`).join('\n');
}

/** Lista de textos ou de { titulo, texto }. */
export function listaItens(itens) {
  const li = itens.map(i => (typeof i === 'string'
    ? `<li>${texto(i)}</li>`
    : `<li><b>${texto(i.titulo)}</b>${i.texto ? texto(i.texto) : ''}</li>`));
  return `<ul class="mk-lista">\n${li.join('\n')}\n</ul>`;
}

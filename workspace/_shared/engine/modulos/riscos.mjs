// Aba Riscos: lista agrupada por fase, com contador CALCULADO (aberto = tudo que não está fechado).
// Fonte: riscos.json -> { riscos: [{ id, titulo, severidade, fase, dono, fechaCom, estado, descricao? }] }
import {
  ehObjeto, exigirTexto, opcionalTexto, listaDe, itensObjeto, idsUnicos, enumeracao,
} from '../nucleo/validacao.mjs';
import { ESTADOS_RISCO, SEVERIDADES, contarRiscos, rotulo } from '../nucleo/calculos.mjs';
import { texto, esc, slug, plural } from '../nucleo/esc.mjs';
import { bloco, chip } from '../nucleo/componentes.mjs';

export const fonte = 'riscos';
const TOM_SEVERIDADE = { alta: 'erro', media: 'atencao', baixa: 'info' };
const TOM_ESTADO = { aberto: 'atencao', mitigando: 'info', fechado: 'ok' };

export function validar(dados) {
  const erros = [];
  if (!ehObjeto(dados)) return ['o arquivo deve ser um objeto com a lista "riscos"'];
  const riscos = itensObjeto(erros, 'riscos', listaDe(erros, 'riscos', dados, 'riscos', { obrigatoria: true }), 'risco');
  riscos.forEach((r, i) => {
    const onde = `risco ${i + 1} (${r.id ?? 'sem id'})`;
    for (const campo of ['id', 'titulo', 'fase', 'dono', 'fechaCom']) exigirTexto(erros, onde, r, campo);
    opcionalTexto(erros, onde, r, 'descricao');
    enumeracao(erros, onde, r, 'severidade', SEVERIDADES);
    enumeracao(erros, onde, r, 'estado', ESTADOS_RISCO);
  });
  idsUnicos(erros, 'riscos', riscos, 'risco');
  return erros;
}

function cartao(r, comFase = false) {
  const sev = slug(r.severidade), estado = slug(r.estado);
  return `<article class="mk-item mk-${sev}${estado === 'fechado' ? ' mk-fechado' : ''}" data-severidade="${sev}" data-estado="${estado}">
  <div class="mk-item-topo"><span class="mk-id">${esc(r.id)}</span><h3>${texto(r.titulo)}</h3>${chip(`severidade ${rotulo(sev)}`, TOM_SEVERIDADE[sev])}${chip(rotulo(estado), TOM_ESTADO[estado])}</div>${r.descricao ? `\n  <p>${texto(r.descricao)}</p>` : ''}
  <div class="mk-ficha"><div><b>Dono</b><span>${texto(r.dono)}</span></div>${comFase ? `<div><b>Fase</b><span>${texto(r.fase)}</span></div>` : ''}<div><b>Fecha com</b><span>${texto(r.fechaCom)}</span></div></div>
</article>`;
}

export function gerar(dados, ctx) {
  const c = contarRiscos(dados.riscos);
  const abertos = dados.riscos.filter(r => slug(r.estado) !== 'fechado');
  const fechados = dados.riscos.filter(r => slug(r.estado) === 'fechado');
  const ordemSev = Object.fromEntries(SEVERIDADES.map((s, i) => [s, i]));
  const porFase = new Map();
  for (const r of abertos.map((r, i) => ({ r, i })).sort((a, b) => ordemSev[slug(a.r.severidade)] - ordemSev[slug(b.r.severidade)] || a.i - b.i).map(x => x.r)) {
    if (!porFase.has(r.fase)) porFase.set(r.fase, []);
    porFase.get(r.fase).push(r);
  }
  const sevChips = SEVERIDADES.filter(s => c.abertosPorSeveridade[s]).map(s => chip(`severidade ${rotulo(s)}: ${c.abertosPorSeveridade[s]}`, TOM_SEVERIDADE[s])).join(' ');
  const estadoChips = ESTADOS_RISCO.filter(e => e !== 'fechado' && c.porEstado[e]).map(e => chip(`${rotulo(e)}: ${c.porEstado[e]}`, TOM_ESTADO[e])).join(' ');
  const topo = `<div class="mk-contadores"><span><b>${c.abertos}</b> ${c.abertos === 1 ? 'risco aberto' : 'riscos abertos'}</span> ${sevChips} ${estadoChips}</div>
<p class="mk-nota">Total: ${plural(c.total, 'risco')}, ${c.fechados} fechado${c.fechados === 1 ? '' : 's'}. O contador é calculado da lista abaixo; cada risco fecha com a evidência indicada.</p>`;
  const grupos = [...porFase].map(([fase, lista]) => `<h2 class="mk-t" style="margin-top:22px">${texto(fase)}</h2>\n${lista.map(r => cartao(r)).join('\n')}`).join('\n');
  const fechadosHtml = fechados.length
    ? `<details>\n<summary>Riscos fechados (${fechados.length})</summary>\n${fechados.map(r => cartao(r, true)).join('\n')}\n</details>` : '';
  return ctx.pagina({
    titulo: ctx.aba.nome,
    subtitulo: `${plural(c.abertos, 'risco aberto', 'riscos abertos')} · atualizado em ${ctx.dataLonga(ctx.hoje)}.`,
    corpo: [bloco(null, topo), grupos, fechadosHtml].filter(Boolean).join('\n') || '<p class="mk-vazio">Nenhum risco registrado.</p>',
  });
}

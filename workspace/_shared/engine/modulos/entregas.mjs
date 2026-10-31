// Aba Entregas: o que chegou nos últimos `janelaDias` dias, por dia, com filtro por área.
// As entregas mais antigas vão para a aba Arquivo (modulos/arquivo.mjs).
// Fonte: entregas.json -> { entregas: [{ id, data, area, titulo, resumo, olhar?, estado, refs?[], miniaturas?[], links?[] }] }
import {
  ehObjeto, exigirTexto, exigirData, listaDe, itensObjeto, idsUnicos, validarMiniatura, validarLinksPdf,
} from '../nucleo/validacao.mjs';
import { miniaturasDe, particionarEntregas } from '../nucleo/calculos.mjs';
import { dataLonga } from '../nucleo/datas.mjs';
import { plural } from '../nucleo/esc.mjs';
import { icone, entregasPorDia } from '../nucleo/componentes.mjs';

export const fonte = 'entregas';
const RESUMO_MAX = 280;

export function validar(dados, ctx) {
  const erros = [];
  if (!ehObjeto(dados)) return ['o arquivo deve ser um objeto com a lista "entregas"'];
  const lista = itensObjeto(erros, 'entregas', listaDe(erros, 'entregas', dados, 'entregas', { obrigatoria: true }), 'entrega');
  const areas = ctx.projeto.areas ?? [];
  const estados = ctx.projeto.estadosEntrega;
  lista.forEach((e, i) => {
    const onde = `entrega ${i + 1} (${e.id ?? 'sem id'})`;
    for (const campo of ['id', 'titulo', 'resumo', 'estado', 'area']) exigirTexto(erros, onde, e, campo);
    exigirData(erros, onde, e, 'data');
    if (areas.length && typeof e.area === 'string' && e.area.trim() && !areas.some(a => a.id === e.area)) {
      erros.push(`${onde}: área "${e.area}" fora de ${areas.map(a => a.id).join(', ')}`);
    }
    if (typeof e.estado === 'string' && e.estado.trim() && estados?.length && !estados.includes(e.estado)) {
      erros.push(`${onde}: estado "${e.estado}" fora de ${estados.join(', ')}`);
    }
    if (typeof e.resumo === 'string' && e.resumo.length > RESUMO_MAX) erros.push(`${onde}: resumo com mais de ${RESUMO_MAX} caracteres`);
    if (e.olhar !== undefined && typeof e.olhar !== 'string') erros.push(`${onde}: "olhar" deve ser texto`);
    if (e.refs !== undefined && !(Array.isArray(e.refs) && e.refs.every(r => typeof r === 'string'))) erros.push(`${onde}: refs deve ser lista de textos`);
    validarLinksPdf(erros, onde, e.links);
    if (e.miniaturas !== undefined && !Array.isArray(e.miniaturas)) erros.push(`${onde}: miniaturas deve ser lista`);
    for (const m of miniaturasDe(e)) {
      if (!ehObjeto(m) || typeof m.arquivo !== 'string') { erros.push(`${onde}: cada miniatura é um caminho ou { arquivo, legenda }`); continue; }
      validarMiniatura(erros, `${onde}: miniatura`, m.arquivo, ctx.pasta);
    }
  });
  idsUnicos(erros, 'entregas', lista, 'entrega');
  const avisos = [];
  if (!erros.length && !ctx.projeto.abas.some(a => a.modulo === 'arquivo')) {
    const n = particionarEntregas(lista, ctx.hoje, ctx.janelaDias).antigas.length;
    if (n) avisos.push(`${plural(n, 'entrega')} com mais de ${ctx.janelaDias} dias não aparece${n === 1 ? '' : 'm'} em nenhuma aba: inclua o módulo "arquivo" em abas`);
  }
  return { erros, avisos };
}

export function gerar(dados, ctx) {
  const { recentes, desde } = particionarEntregas(dados.entregas, ctx.hoje, ctx.janelaDias);
  const areas = ctx.projeto.areas;
  const contagem = (areas.length ? areas.map(a => a.id) : [...new Set(recentes.map(e => e.area))])
    .map(a => [a, recentes.filter(e => e.area === a).length]).filter(([, n]) => n);
  const filtros = `<div class="mk-resumo" id="mk-filtros" hidden>
<button class="mk-filtro" type="button" data-filtro="" aria-pressed="true">todas (${recentes.length})</button>
${contagem.map(([a, n]) => `<button class="mk-filtro" type="button" data-filtro="${ctx.esc(a)}" aria-pressed="false">${icone(areas.find(x => x.id === a)?.icone, ctx)}${ctx.esc(a)} (${n})</button>`).join('\n')}
</div>`;
  const script = `(() => {
  const barra = document.getElementById('mk-filtros');
  if (!barra) return;
  barra.hidden = false;
  barra.addEventListener('click', ev => {
    const botao = ev.target.closest('[data-filtro]');
    if (!botao) return;
    const area = botao.dataset.filtro;
    barra.querySelectorAll('[data-filtro]').forEach(b => b.setAttribute('aria-pressed', String(b === botao)));
    document.querySelectorAll('.mk-entrega').forEach(c => { c.hidden = Boolean(area) && c.dataset.area !== area; });
    document.querySelectorAll('.mk-grupo').forEach(g => { g.hidden = !g.querySelector('.mk-entrega:not([hidden])'); });
  });
})();`;
  const corpo = recentes.length
    ? `${filtros}\n${entregasPorDia(recentes, ctx)}`
    : `<p class="mk-vazio">Nenhuma entrega nos últimos ${plural(ctx.janelaDias, 'dia')}.</p>`;
  const temArquivo = ctx.projeto.abas.some(a => a.modulo === 'arquivo');
  const pendentes = recentes.some(e => e.estado !== 'main');
  const subtitulo = `Últimos ${plural(ctx.janelaDias, 'dia')} (desde ${dataLonga(desde)}) · atualizado em ${dataLonga(ctx.hoje)}.`
    + (temArquivo ? ' As mais antigas ficam na aba Arquivo.' : '')
    + (pendentes ? ' Estado diferente de <em>main</em>: a entrega ainda não chegou na main do repositório.' : '');
  return ctx.pagina({ titulo: ctx.aba.nome, subtitulo, corpo, scripts: recentes.length ? script : '' });
}

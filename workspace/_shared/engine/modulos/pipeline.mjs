// Aba Pipeline: etapas por asset (por exemplo Meshy -> Blender -> Unreal), agrupadas por tipo de asset.
// Fonte: pipeline.json -> { etapas: [{ id, nome }], assets: [{ id, nome, grupo?, etapas: { <idEtapa>: estado | { estado } } }] }
import {
  ehObjeto, exigirTexto, opcionalTexto, listaDe, itensObjeto, idsUnicos,
} from '../nucleo/validacao.mjs';
import { ESTADOS_ETAPA, estadoEtapa, progressoAsset, rotulo } from '../nucleo/calculos.mjs';
import { esc, texto, slug, plural } from '../nucleo/esc.mjs';
import { bloco, chip, tabela, barra } from '../nucleo/componentes.mjs';

export const fonte = 'pipeline';
const TOM = { feito: 'ok', 'em-andamento': 'info', pendente: 'neutro', bloqueado: 'erro', na: 'neutro' };

export function validar(dados) {
  const erros = [];
  if (!ehObjeto(dados)) return ['o arquivo deve ser um objeto com "etapas" e "assets"'];
  const etapas = itensObjeto(erros, 'pipeline', listaDe(erros, 'pipeline', dados, 'etapas', { obrigatoria: true }), 'etapa');
  if (Array.isArray(dados.etapas) && !dados.etapas.length) erros.push('pipeline: "etapas" está vazia');
  etapas.forEach((e, i) => {
    const onde = `etapa ${i + 1} (${e.id ?? 'sem id'})`;
    exigirTexto(erros, onde, e, 'id');
    exigirTexto(erros, onde, e, 'nome');
  });
  const ids = idsUnicos(erros, 'pipeline', etapas, 'etapa');
  const assets = itensObjeto(erros, 'pipeline', listaDe(erros, 'pipeline', dados, 'assets', { obrigatoria: true }), 'asset');
  assets.forEach((a, i) => {
    const onde = `asset ${i + 1} (${a.id ?? 'sem id'})`;
    exigirTexto(erros, onde, a, 'id');
    exigirTexto(erros, onde, a, 'nome');
    opcionalTexto(erros, onde, a, 'grupo');
    if (!ehObjeto(a.etapas)) { erros.push(`${onde}: falta "etapas" (objeto { idDaEtapa: estado })`); return; }
    for (const [idEtapa, v] of Object.entries(a.etapas)) {
      if (!ids.has(idEtapa)) { erros.push(`${onde}: etapa "${idEtapa}" não existe em "etapas" (existem: ${[...ids].join(', ')})`); continue; }
      const s = slug(ehObjeto(v) ? v.estado : v);
      if (!ESTADOS_ETAPA.includes(s)) erros.push(`${onde}: estado "${ehObjeto(v) ? v.estado : v}" na etapa ${idEtapa} fora de ${ESTADOS_ETAPA.join(', ')}`);
    }
  });
  idsUnicos(erros, 'pipeline', assets, 'asset');
  return erros;
}

const celula = estado => (estado === 'na' ? '<span class="mk-nota">—</span>' : chip(rotulo(estado), TOM[estado]));

export function gerar(dados, ctx) {
  const grupos = new Map();
  for (const a of dados.assets) { const g = a.grupo ?? 'Assets'; if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(a); }
  const feitosPorEtapa = dados.etapas.map(e => ({ nome: e.nome, n: dados.assets.filter(a => estadoEtapa(a, e.id) === 'feito').length }));
  const resumo = `<div class="mk-contadores"><span><b>${dados.assets.length}</b> ${dados.assets.length === 1 ? 'asset' : 'assets'}</span> ${feitosPorEtapa.map(e => chip(`${e.nome}: ${e.n} de ${dados.assets.length}`, e.n === dados.assets.length && e.n ? 'ok' : 'neutro')).join(' ')}</div>
<p class="mk-nota">Cada célula mostra a situação do asset naquela etapa. “—” quer dizer que a etapa não se aplica.</p>`;
  const tabelas = [...grupos].map(([grupo, lista]) => {
    const linhas = lista.map(a => {
      const p = progressoAsset(a, dados.etapas);
      return [`<strong>${texto(a.nome)}</strong>`, ...dados.etapas.map(e => celula(estadoEtapa(a, e.id))),
        `${p.feitas} de ${p.total}${barra(p.feitas, p.total, { legenda: `${a.nome}: ${p.feitas} de ${p.total} etapas`, mini: true })}`];
    });
    return bloco(`${grupo} · ${plural(lista.length, 'asset')}`, tabela({
      cabecalho: ['Asset', ...dados.etapas.map(e => e.nome), 'Progresso'],
      linhas, classe: 'mk-matriz', centro: dados.etapas.map((_, i) => i + 1),
    }), { icone: 'pipeline', ctx });
  }).join('\n');
  return ctx.pagina({
    titulo: ctx.aba.nome,
    subtitulo: `${plural(dados.assets.length, 'asset')} em ${plural(dados.etapas.length, 'etapa')} (${dados.etapas.map(e => esc(e.nome)).join(' → ')}) · atualizado em ${ctx.dataLonga(ctx.hoje)}.`,
    corpo: `${bloco(null, resumo)}\n${tabelas || '<p class="mk-vazio">Nenhum asset registrado.</p>'}`,
  });
}

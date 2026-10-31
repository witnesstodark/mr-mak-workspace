// Aba Decisões: resumo por tema e o que espera aprovação. Preenchida pelo coletor ou pelo agente
// a partir do registro de decisões do repositório do projeto.
// Fonte: decisoes.json -> { temas: [{ nome, resumo?, decisoes: [{ id, titulo, estado, data?, nota? }] }], espera?: [texto | { titulo, texto? }],
//                           notas?: [texto | { titulo, texto? }], fonte? }
// Com algum `resumo`, a aba ganha a tabela "Resumo por tema" (o que vale hoje e os códigos de cada tema).
// `notas` são anotações que não estão no registro; `fonte` diz de onde e quando os dados vieram.
// O coletor coletores/decisoes-md.mjs preenche este arquivo a partir do registro em Markdown.
import {
  ehObjeto, exigirTexto, opcionalTexto, exigirData, listaDe, itensObjeto, idsUnicos, enumeracao,
} from '../nucleo/validacao.mjs';
import { ESTADOS_DECISAO, contarDecisoes, rotulo } from '../nucleo/calculos.mjs';
import { esc, texto, slug, plural } from '../nucleo/esc.mjs';
import { bloco, chip, tabela, listaItens } from '../nucleo/componentes.mjs';

export const fonte = 'decisoes';

export function validar(dados) {
  const erros = [];
  if (!ehObjeto(dados)) return ['o arquivo deve ser um objeto com a lista "temas"'];
  const temas = itensObjeto(erros, 'decisões', listaDe(erros, 'decisões', dados, 'temas', { obrigatoria: true }), 'tema');
  const todas = [];
  temas.forEach((t, i) => {
    const onde = `tema ${i + 1} (${t.nome ?? 'sem nome'})`;
    exigirTexto(erros, onde, t, 'nome');
    opcionalTexto(erros, onde, t, 'resumo');
    const ds = itensObjeto(erros, onde, listaDe(erros, onde, t, 'decisoes', { obrigatoria: true }), 'decisão');
    ds.forEach((d, j) => {
      const qual = `${onde} › decisão ${j + 1} (${d.id ?? 'sem id'})`;
      exigirTexto(erros, qual, d, 'id');
      exigirTexto(erros, qual, d, 'titulo');
      enumeracao(erros, qual, d, 'estado', ESTADOS_DECISAO);
      exigirData(erros, qual, d, 'data', { obrigatoria: false });
      opcionalTexto(erros, qual, d, 'nota');
    });
    todas.push(...ds);
  });
  idsUnicos(erros, 'decisões', todas, 'decisão');
  for (const campo of ['espera', 'notas']) {
    listaDe(erros, 'decisões', dados, campo).forEach((e, i) => {
      if (typeof e === 'string' ? !e.trim() : !(ehObjeto(e) && typeof e.titulo === 'string' && e.titulo.trim())) {
        erros.push(`decisões: item ${i + 1} de "${campo}" deve ser um texto ou { titulo, texto }`);
      }
    });
  }
  opcionalTexto(erros, 'decisões', dados, 'fonte');
  return erros;
}

const prefixoCodigo = id => /^[A-Za-z]+/.exec(id)?.[0].toUpperCase() ?? id;
const numeroCodigo = id => { const m = /^[A-Za-z]+-?(\d+)$/.exec(id); return m ? Number(m[1]) : null; };

/** ["J12","J13","J14","J20","M8a"] -> "J12–J14, J20, M8a": junta só códigos seguidos do mesmo prefixo, na ordem dada. */
export function comprimirCodigos(ids) {
  const partes = [];
  let ini = null, fim = null;
  const fechar = () => { if (ini) partes.push(ini === fim ? ini : `${ini}–${fim}`); ini = fim = null; };
  for (const id of ids) {
    const n = numeroCodigo(id);
    if (ini && n !== null && prefixoCodigo(id) === prefixoCodigo(fim) && n === numeroCodigo(fim) + 1) { fim = id; continue; }
    fechar();
    if (n === null) partes.push(id); else { ini = fim = id; }
  }
  fechar();
  return partes.join(', ');
}

export function gerar(dados, ctx) {
  const c = contarDecisoes(dados);
  const resumo = `<div class="mk-contadores"><span><b>${c.pendentes}</b> ${c.pendentes === 1 ? 'pendente' : 'pendentes'}</span> ${chip(`${plural(c.confirmadas, 'confirmada')}`, 'ok')} ${chip(plural(dados.temas.length, 'tema'), 'neutro')}</div>`
    + (dados.fonte ? `\n<p class="mk-nota">Fonte: ${texto(dados.fonte)}</p>` : '');
  const espera = dados.espera?.length
    ? bloco('Espera aprovação', listaItens(dados.espera), { icone: 'check', ctx }) : '';
  const comResumo = dados.temas.filter(t => t.resumo);
  const tabelaResumo = comResumo.length
    ? bloco('Resumo por tema', tabela({
      cabecalho: ['Tema', 'O que vale hoje', 'Códigos'],
      linhas: comResumo.map(t => [`<b>${texto(t.nome)}</b>`, texto(t.resumo), `<small>${esc(comprimirCodigos(t.decisoes.map(d => d.id)))}</small>`]),
    }), { icone: 'livro', ctx, classe: 'mk-decisoes-resumo' }) : '';
  const notas = dados.notas?.length ? bloco('Anotações fora do registro', listaItens(dados.notas), { icone: 'documento', ctx }) : '';
  const temas = dados.temas.map((t, i) => {
    const ct = c.porTema[i];
    const linhas = t.decisoes.map(d => [
      `<span class="mk-id">${esc(d.id)}</span>`,
      texto(d.titulo) + (d.nota ? `<br><small class="mk-nota">${texto(d.nota)}</small>` : ''),
      chip(rotulo(d.estado), slug(d.estado) === 'pendente' ? 'atencao' : 'ok'),
      d.data ? ctx.dataLonga(d.data) : '—',
    ]);
    const tab = linhas.length ? tabela({ cabecalho: ['Id', 'Decisão', 'Estado', 'Data'], linhas }) : '<p class="mk-vazio">Sem decisões neste tema.</p>';
    // Com a tabela de resumo e a lista "Espera aprovação", as listas completas começam fechadas (a aba não vira um rolo).
    return `<details${ct.pendentes && !comResumo.length ? ' open' : ''}>
<summary>${texto(t.nome)} · ${plural(ct.total, 'decisão', 'decisões')}${ct.pendentes ? ` · <span class="mk-chip mk-atencao">${ct.pendentes} ${ct.pendentes === 1 ? 'pendente' : 'pendentes'}</span>` : ''}</summary>
${tab}
</details>`;
  }).join('\n');
  return ctx.pagina({
    titulo: ctx.aba.nome,
    subtitulo: `${plural(c.pendentes, 'decisão pendente', 'decisões pendentes')} de ${c.total} · atualizado em ${ctx.dataLonga(ctx.hoje)}.`,
    corpo: [bloco(null, resumo), espera, tabelaResumo, notas,
      bloco(comResumo.length ? 'Todas as decisões, por tema' : 'Por tema', temas || '<p class="mk-vazio">Nenhuma decisão registrada.</p>', { icone: 'livro', ctx })].filter(Boolean).join('\n'),
  });
}

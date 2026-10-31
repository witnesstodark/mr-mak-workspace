// Aba Playtest: só a iteração aberta. As fechadas vão para a aba Arquivo.
// Fonte: playtest.json -> { iteracoes: [{ id, nome, aberta, achados: [{ id, tipo, titulo, estado }] }] }
import {
  ehObjeto, exigirTexto, opcionalTexto, listaDe, itensObjeto, idsUnicos, enumeracao,
} from '../nucleo/validacao.mjs';
import { ESTADOS_ACHADO, contarAchados, rotulo } from '../nucleo/calculos.mjs';
import { esc, texto, slug, plural } from '../nucleo/esc.mjs';
import { bloco, chip, tabela } from '../nucleo/componentes.mjs';

export const fonte = 'playtest';
const TOM_ACHADO = { aberto: 'atencao', 'em-correcao': 'info', corrigido: 'ok', descartado: 'neutro' };

export function validar(dados) {
  const erros = [];
  if (!ehObjeto(dados)) return ['o arquivo deve ser um objeto com a lista "iteracoes"'];
  const iteracoes = itensObjeto(erros, 'playtest', listaDe(erros, 'playtest', dados, 'iteracoes', { obrigatoria: true }), 'iteração');
  iteracoes.forEach((it, i) => {
    const onde = `iteração ${i + 1} (${it.id ?? 'sem id'})`;
    exigirTexto(erros, onde, it, 'id');
    exigirTexto(erros, onde, it, 'nome');
    opcionalTexto(erros, onde, it, 'resumo');
    if (typeof it.aberta !== 'boolean') erros.push(`${onde}: "aberta" deve ser true ou false`);
    const achados = itensObjeto(erros, onde, listaDe(erros, onde, it, 'achados', { obrigatoria: true }), 'achado');
    achados.forEach((a, j) => {
      const qual = `${onde} › achado ${j + 1} (${a.id ?? 'sem id'})`;
      exigirTexto(erros, qual, a, 'id');
      exigirTexto(erros, qual, a, 'tipo');
      exigirTexto(erros, qual, a, 'titulo');
      enumeracao(erros, qual, a, 'estado', ESTADOS_ACHADO);
    });
    idsUnicos(erros, onde, achados, 'achado');
  });
  idsUnicos(erros, 'playtest', iteracoes, 'iteração');
  const abertas = iteracoes.filter(it => it.aberta === true);
  if (abertas.length > 1) erros.push(`playtest: só uma iteração pode estar aberta; abertas agora: ${abertas.map(it => it.id).join(', ')}`);
  return erros;
}

/** Tabela de achados de uma iteração (reaproveitada pela aba Arquivo). */
export function tabelaAchados(iteracao) {
  if (!iteracao.achados.length) return '<p class="mk-vazio">Nenhum achado registrado.</p>';
  const linhas = iteracao.achados.map(a => [
    `<span class="mk-id">${esc(a.id)}</span>`,
    esc(a.tipo),
    texto(a.titulo),
    chip(rotulo(a.estado), TOM_ACHADO[slug(a.estado)] ?? 'neutro'),
  ]);
  return tabela({ cabecalho: ['Id', 'Tipo', 'Achado', 'Estado'], linhas, classe: 'mk-achados' });
}

export function gerar(dados, ctx) {
  const aberta = dados.iteracoes.find(it => it.aberta === true);
  const fechadas = dados.iteracoes.length - (aberta ? 1 : 0);
  if (!aberta) {
    return ctx.pagina({
      titulo: ctx.aba.nome,
      subtitulo: `Atualizado em ${ctx.dataLonga(ctx.hoje)}.`,
      corpo: bloco(null, `<p class="mk-vazio">Nenhum playtest aberto. ${fechadas ? `${plural(fechadas, 'iteração fechada', 'iterações fechadas')} na aba Arquivo.` : 'Quando houver o primeiro teste, ele aparece aqui.'}</p>`),
    });
  }
  const c = contarAchados(aberta);
  const porEstado = ESTADOS_ACHADO
    .map(e => [e, aberta.achados.filter(a => slug(a.estado) === e).length]).filter(([, n]) => n)
    .map(([e, n]) => chip(`${n} ${rotulo(e)}`, TOM_ACHADO[e])).join(' ');
  const topo = `<div class="mk-contadores"><span><b>${c.abertos}</b> em aberto de ${c.total}</span> ${porEstado}</div>${aberta.resumo ? `\n<p>${ctx.texto(aberta.resumo)}</p>` : ''}`;
  const tipos = [...new Set(aberta.achados.map(a => a.tipo))];
  const corpo = bloco(aberta.nome, `${topo}\n${tabelaAchados(aberta)}`, { icone: 'playtest', ctx })
    + (tipos.length > 1 ? `\n<p class="mk-nota">Tipos nesta iteração: ${tipos.map(ctx.esc).join(', ')}.</p>` : '');
  return ctx.pagina({
    titulo: ctx.aba.nome,
    subtitulo: `Iteração aberta: <strong>${ctx.esc(aberta.nome)}</strong> · atualizado em ${ctx.dataLonga(ctx.hoje)}.${fechadas ? ` ${fechadas === 1 ? 'A iteração fechada fica' : 'As iterações fechadas ficam'} na aba Arquivo.` : ''}`,
    corpo,
  });
}


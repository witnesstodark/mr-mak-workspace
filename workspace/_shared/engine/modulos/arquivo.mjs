// Aba Arquivo: entregas com mais de `janelaDias` dias (um bloco por mês) e iterações de playtest fechadas.
// Fonte: entregas.json (a mesma da aba Entregas); lê também playtest.json, se existir.
import { validar as validarEntregas } from './entregas.mjs';
import { tabelaAchados } from './playtest.mjs';
import { particionarEntregas, contarAchados } from '../nucleo/calculos.mjs';
import { mesLongo } from '../nucleo/datas.mjs';
import { plural } from '../nucleo/esc.mjs';
import { entregasPorDia, bloco } from '../nucleo/componentes.mjs';

export const fonte = 'entregas';

// Mesmas regras da aba Entregas (o motor junta as mensagens repetidas).
export const validar = validarEntregas;

export function gerar(dados, ctx) {
  const { antigas } = particionarEntregas(dados.entregas, ctx.hoje, ctx.janelaDias);
  const meses = new Map();
  for (const e of antigas) { const m = e.data.slice(0, 7); if (!meses.has(m)) meses.set(m, []); meses.get(m).push(e); }
  const blocosMes = [...meses].map(([mes, itens]) =>
    `<details>\n<summary>${mesLongo(mes)} · ${plural(itens.length, 'entrega')}</summary>\n${entregasPorDia(itens, ctx)}\n</details>`).join('\n');

  const playtest = ctx.carregar('playtest');
  const fechadas = (playtest?.iteracoes ?? []).filter(it => it.aberta !== true);
  const blocosPlaytest = fechadas.map(it => {
    const c = contarAchados(it);
    return `<details>\n<summary>${ctx.esc(it.nome)} · ${plural(c.total, 'achado')}${c.abertos ? ` (${c.abertos} sem resolver)` : ''}</summary>\n${it.resumo ? `<p>${ctx.texto(it.resumo)}</p>\n` : ''}${tabelaAchados(it)}\n</details>`;
  }).join('\n');

  const corpo = [
    antigas.length ? bloco('Entregas anteriores', blocosMes, { icone: 'entrega', ctx }) : '',
    fechadas.length ? bloco('Playtests fechados', blocosPlaytest, { icone: 'playtest', ctx }) : '',
  ].filter(Boolean).join('\n') || '<p class="mk-vazio">Nada arquivado ainda: as entregas recentes estão na aba Entregas.</p>';
  return ctx.pagina({
    titulo: ctx.aba.nome,
    subtitulo: `Entregas com mais de ${plural(ctx.janelaDias, 'dia')}, um bloco por mês, e as iterações de playtest já fechadas. Só cresce; nada aqui é reescrito.`,
    corpo,
  });
}

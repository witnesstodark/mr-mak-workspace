// Aba Métricas: valores medidos por marco, com a meta ao lado.
// Fonte: metricas.json -> { marcos: [{ id, nome, valores: [{ rotulo, valor, unidade?, meta?, sentido? }] }] }
// `sentido` ("maior" ou "menor") diz qual lado da meta é bom; com valor e meta numéricos o motor mostra se a meta foi atingida.
import {
  ehObjeto, exigirTexto, opcionalTexto, listaDe, itensObjeto, idsUnicos, enumeracao, ehTexto,
} from '../nucleo/validacao.mjs';
import { SENTIDOS_METRICA } from '../nucleo/calculos.mjs';
import { esc, texto, slug } from '../nucleo/esc.mjs';
import { bloco, chip } from '../nucleo/componentes.mjs';

export const fonte = 'metricas';
const ehValor = v => (typeof v === 'number' && Number.isFinite(v)) || ehTexto(v);

export function validar(dados) {
  const erros = [];
  if (!ehObjeto(dados)) return ['o arquivo deve ser um objeto com a lista "marcos"'];
  const marcos = itensObjeto(erros, 'métricas', listaDe(erros, 'métricas', dados, 'marcos', { obrigatoria: true }), 'marco');
  marcos.forEach((m, i) => {
    const onde = `marco ${i + 1} (${m.id ?? 'sem id'})`;
    exigirTexto(erros, onde, m, 'id');
    exigirTexto(erros, onde, m, 'nome');
    const valores = itensObjeto(erros, onde, listaDe(erros, onde, m, 'valores', { obrigatoria: true }), 'valor');
    valores.forEach((v, j) => {
      const qual = `${onde} › valor ${j + 1} (${v.rotulo ?? 'sem rótulo'})`;
      exigirTexto(erros, qual, v, 'rotulo');
      if (!ehValor(v.valor)) erros.push(`${qual}: falta "valor" (número ou texto)`);
      if (v.meta !== undefined && !ehValor(v.meta)) erros.push(`${qual}: "meta" deve ser número ou texto`);
      opcionalTexto(erros, qual, v, 'unidade', 20);
      if (v.sentido !== undefined) {
        enumeracao(erros, qual, v, 'sentido', SENTIDOS_METRICA);
        if (typeof v.valor !== 'number' || typeof v.meta !== 'number') erros.push(`${qual}: "sentido" só vale com valor e meta numéricos`);
      }
    });
  });
  idsUnicos(erros, 'métricas', marcos, 'marco');
  return erros;
}

/** 'ok' | 'fora' | null: só quando há sentido, valor e meta numéricos. */
export function situacaoMeta(v) {
  if (typeof v.valor !== 'number' || typeof v.meta !== 'number') return null;
  const sentido = slug(v.sentido);
  if (sentido === 'maior') return v.valor >= v.meta ? 'ok' : 'fora';
  if (sentido === 'menor') return v.valor <= v.meta ? 'ok' : 'fora';
  return null;
}

const numero = v => (typeof v === 'number' ? v.toLocaleString('pt-BR') : v);

export function gerar(dados, ctx) {
  const total = dados.marcos.reduce((s, m) => s + m.valores.length, 0);
  const blocos = dados.marcos.map(m => {
    const tiles = m.valores.map(v => {
      const s = situacaoMeta(v);
      const meta = v.meta !== undefined ? `<span>meta ${esc(numero(v.meta))}${v.unidade ? ' ' + esc(v.unidade) : ''}</span>` : '';
      const estado = s ? chip(s === 'ok' ? 'dentro da meta' : 'fora da meta', s === 'ok' ? 'ok' : 'atencao') : '';
      return `<div class="mk-metrica"><small>${texto(v.rotulo)}</small><b>${esc(numero(v.valor))}${v.unidade ? ` <span>${esc(v.unidade)}</span>` : ''}</b>${meta || estado ? `<div>${meta}${estado}</div>` : ''}</div>`;
    }).join('\n');
    return bloco(m.nome, `<div class="mk-metricas">\n${tiles || '<p class="mk-vazio">Sem valores.</p>'}\n</div>`, { icone: 'grafico', ctx });
  }).join('\n');
  return ctx.pagina({
    titulo: ctx.aba.nome,
    subtitulo: `${total} ${total === 1 ? 'valor' : 'valores'} em ${dados.marcos.length} ${dados.marcos.length === 1 ? 'marco' : 'marcos'} · atualizado em ${ctx.dataLonga(ctx.hoje)}.`,
    corpo: blocos || '<p class="mk-vazio">Nenhuma métrica registrada.</p>',
  });
}

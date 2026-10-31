#!/usr/bin/env node
// Coletor da aba Decisões: lê o registro de decisões do projeto (Markdown) e escreve o decisoes.json do card.
//
// Uso: node workspace/_shared/engine/coletores/decisoes-md.mjs <registro.md> <saida.json> [--hoje AAAA-MM-DD]
//
// Formato lido (o das skills domain-modeling e grilling, com variações toleradas):
//   ## Seção                      (### também conta; vira o tema quando não há agrupamento)
//   | # | Decisão | Valor atual | Status |       ou  | Código | Assunto | Decisão | Status |
//   |---|---|---|---|
//   | V1 | Objetivo | Jogo comercial | Confirmado (2026-10-09) |
// - A coluna do código se chama #, ID, Id, Código ou Cód.; a do estado, Status, Estado ou Situação.
// - O título é Assunto/Tema/Título quando existe; senão, a coluna Decisão. O resto (Valor atual, Valor,
//   Decisão) vira a nota.
// - Estado: começa com Confirmado/Confirmada/Aprovado/Decidido/Aceito/Fechado (ou ✅) = Confirmada;
//   começa com Pendente/Aberto/A decidir/Em aberto/Proposta (ou ⏳, ❓) = Pendente. Outro texto
//   ("Substituído pela H16", "Mudado pelo H39"...) fica fora da aba e é contado em "fora".
// - A data é a primeira AAAA-MM-DD da célula de estado. Linhas sem código (ex.: tabelas de pesquisas) ficam fora.
//
// O que o agente escreve à mão no decisoes.json fica preservado entre coletas:
//   coletor.agrupamento[]  { nome, prefixos: ["V", "E"], codigos?: ["J83"], resumo? }  temas por prefixo de código,
//                          na ordem da lista (codigos vence prefixos; sem agrupamento, o tema é a seção do registro)
//   notas[]                textos ou { titulo, texto } mostrados abaixo dos temas
// O resto (temas, espera, fonte, coletor.contagem) é reescrito a cada coleta.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { comprimirCodigos } from '../modulos/decisoes.mjs';

const semAcento = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const chave = s => semAcento(s).toLowerCase().trim();
const CODIGO = /^[A-Z][A-Za-z]{0,4}-?\d+[a-z]?$/;
const DATA = /\b(\d{4}-\d{2}-\d{2})\b/;

const COL_ID = /^(#|id|codigo|cod\.?|n\.?º?)$/;
const COL_ESTADO = /^(status|estado|situacao)$/;
const COL_TITULO = /^(assunto|tema|titulo)$/;
const COL_DECISAO = /^decis(ao|oes)$/;
const COL_VALOR = /^(valor atual|valor|o que vale|detalhe|detalhes|descricao)$/;

/** Confirmada, Pendente ou null (substituída, mudada, respondida...). */
export function classificarEstado(texto) {
  const t = chave(texto).replace(/^[*_\s]+/, '');
  if (/^(✅|✔)/.test(t) || /^(confirmad[oa]s?|aprovad[oa]s?|decidid[oa]s?|aceit[oa]s?|fechad[oa]s?|vigente)\b/.test(t)) return 'Confirmada';
  if (/^(⏳|❓|❔)/.test(t) || /^(pendentes?|em aberto|abert[oa]|a decidir|proposta|propost[oa]|aguarda)\b/.test(t)) return 'Pendente';
  return null;
}

/** Tira a marcação de Markdown que não serve na aba; mantém `código`. */
export function limparMd(s) {
  return String(s ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\\\|/g, '|')
    .replace(/\s+/g, ' ')
    .trim();
}

function celulas(linha) {
  // "| a | b \| c | d |" -> ["a", "b | c", "d"]
  const corpo = linha.trim().replace(/^\|/, '').replace(/\|\s*$/, '');
  return corpo.split(/(?<!\\)\|/).map(c => c.trim());
}

const ehSeparador = linha => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(linha.trim());

/** Mapa das colunas de uma tabela, ou null se não for tabela de decisões. */
export function mapearColunas(cabecalho) {
  const c = cabecalho.map(chave);
  const id = c.findIndex(x => COL_ID.test(x));
  const estado = c.findIndex(x => COL_ESTADO.test(x));
  if (id < 0 || estado < 0) return null;
  let titulo = c.findIndex(x => COL_TITULO.test(x));
  let valor;
  if (titulo >= 0) valor = c.findIndex((x, i) => i !== titulo && (COL_DECISAO.test(x) || COL_VALOR.test(x)));
  else {
    titulo = c.findIndex(x => COL_DECISAO.test(x));
    valor = c.findIndex((x, i) => i !== titulo && COL_VALOR.test(x));
  }
  if (titulo < 0) titulo = c.findIndex((x, i) => i !== id && i !== estado);
  return { id, estado, titulo, valor: valor >= 0 ? valor : -1 };
}

/**
 * Lê o registro. Devolve { decisoes: [{ id, titulo, nota, estado, statusTexto, data, secao }], fora: [{ id, status, secao }] }.
 * `estado` é Confirmada ou Pendente; as linhas com outro status vão para `fora`.
 */
export function lerRegistro(md) {
  const linhas = String(md).replace(/^﻿/, '').split(/\r?\n/);
  const decisoes = [], fora = [];
  let secao = null, colunas = null, ultimas = null;
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    const h = /^(#{2,4})\s+(.+?)\s*#*\s*$/.exec(linha);
    if (h) { secao = limparMd(h[2]); colunas = ultimas = null; continue; }
    if (!linha.trim().startsWith('|')) { colunas = null; continue; }
    if (ehSeparador(linha)) continue;
    const cel = celulas(linha);
    if (!colunas) {
      // Cabeçalho só se a próxima linha for o separador. Linha de tabela sem cabeçalho logo depois de uma
      // tabela da mesma seção (uma linha em branco no meio) continua aquela tabela.
      if (i + 1 < linhas.length && ehSeparador(linhas[i + 1])) { colunas = ultimas = mapearColunas(cel) ?? { ignorar: true }; continue; }
      if (!ultimas) continue;
      colunas = ultimas;
    }
    if (colunas.ignorar) continue;
    const id = limparMd(cel[colunas.id] ?? '').replace(/\s*✓$/, '');
    if (!CODIGO.test(id)) continue;
    const statusTexto = limparMd(cel[colunas.estado] ?? '');
    const estado = classificarEstado(statusTexto);
    if (!estado) { fora.push({ id, status: statusTexto, secao }); continue; }
    const titulo = limparMd(cel[colunas.titulo] ?? '') || id;
    const nota = colunas.valor >= 0 ? limparMd(cel[colunas.valor] ?? '') : '';
    const data = DATA.exec(statusTexto)?.[1];
    decisoes.push({ id, titulo, nota, estado, statusTexto, data, secao });
  }
  return { decisoes, fora };
}

const prefixo = id => /^[A-Za-z]+/.exec(id)?.[0].toUpperCase() ?? id;
const numero = id => { const m = /^[A-Za-z]+-?(\d+)$/.exec(id); return m ? Number(m[1]) : null; };
export { comprimirCodigos };

function ordenarCodigos(a, b) {
  const pa = prefixo(a), pb = prefixo(b);
  if (pa !== pb) return pa.localeCompare(pb);
  const na = numero(a), nb = numero(b);
  if (na !== null && nb !== null && na !== nb) return na - nb;
  return a.localeCompare(b, 'pt-BR', { numeric: true });
}

/**
 * Monta o decisoes.json. `anterior` é o decisoes.json que já existe (preserva coletor.agrupamento, resumos e notas).
 * Devolve { dados, avisos }.
 */
export function montarDecisoes(registro, { anterior, fonte, hoje } = {}) {
  const avisos = [];
  const agrupamento = Array.isArray(anterior?.coletor?.agrupamento) ? anterior.coletor.agrupamento : null;
  const temas = new Map();
  const tema = (nome, resumo) => {
    if (!temas.has(nome)) temas.set(nome, { nome, ...(resumo ? { resumo } : {}), decisoes: [] });
    return temas.get(nome);
  };
  if (agrupamento) for (const g of agrupamento) tema(g.nome, g.resumo);
  const porCodigo = new Map(), porPrefixo = new Map();
  for (const g of agrupamento ?? []) {
    for (const c of g.codigos ?? []) porCodigo.set(c, g.nome);
    for (const p of g.prefixos ?? []) porPrefixo.set(String(p).toUpperCase(), g.nome);
  }
  const vistos = new Set();
  const semGrupo = new Set();
  for (const d of registro.decisoes) {
    if (vistos.has(d.id)) { avisos.push(`código repetido no registro: ${d.id} (fica a primeira linha)`); continue; }
    vistos.add(d.id);
    let nome;
    if (agrupamento) {
      nome = porCodigo.get(d.id) ?? porPrefixo.get(prefixo(d.id));
      if (!nome) { nome = 'Outros'; semGrupo.add(prefixo(d.id)); }
    } else nome = d.secao ?? 'Sem seção';
    const item = { id: d.id, titulo: d.titulo, estado: d.estado };
    if (d.data) item.data = d.data;
    if (d.nota) item.nota = d.nota;
    tema(nome).decisoes.push(item);
  }
  if (semGrupo.size) avisos.push(`prefixos sem tema no agrupamento (foram para "Outros"): ${[...semGrupo].sort().join(', ')}`);
  const lista = [...temas.values()].filter(t => t.decisoes.length);
  if (agrupamento) for (const t of lista) t.decisoes.sort((a, b) => ordenarCodigos(a.id, b.id));
  const espera = lista
    .map(t => ({ titulo: t.nome, ids: t.decisoes.filter(d => d.estado === 'Pendente').map(d => d.id) }))
    .filter(e => e.ids.length)
    .map(e => ({ titulo: `${e.titulo} (${e.ids.length})`, texto: comprimirCodigos(e.ids) }));
  const confirmadas = registro.decisoes.filter(d => d.estado === 'Confirmada').length;
  const pendentes = registro.decisoes.length - confirmadas;
  const dados = {
    sobre: 'Gerado pelo coletor (node workspace/_shared/engine/coletores/decisoes-md.mjs <registro.md> <este arquivo>). Edite à mão só coletor.agrupamento e notas; o resto é reescrito a cada coleta.',
    fonte: `${fonte ?? 'registro de decisões'}${hoje ? `, coletado em ${hoje}` : ''}: ${confirmadas} confirmadas e ${pendentes} pendentes`
      + (registro.fora.length ? `; ${registro.fora.length} linhas substituídas ou respondidas por outras ficam só no registro (${comprimirCodigos([...registro.fora.map(f => f.id)].sort(ordenarCodigos))})` : '')
      + '.',
    coletor: {
      ...(anterior?.coletor ?? {}),
      contagem: { confirmadas, pendentes, fora: registro.fora.length },
    },
    temas: lista,
    espera,
    ...(Array.isArray(anterior?.notas) && anterior.notas.length ? { notas: anterior.notas } : {}),
  };
  return { dados, avisos };
}

export function coletar(arquivoMd, arquivoSaida, { hoje } = {}) {
  const md = readFileSync(arquivoMd, 'utf8');
  const anterior = existsSync(arquivoSaida) ? JSON.parse(readFileSync(arquivoSaida, 'utf8').replace(/^﻿/, '')) : undefined;
  const registro = lerRegistro(md);
  const fonte = anterior?.coletor?.fonteRotulo ?? basename(arquivoMd);
  const r = montarDecisoes(registro, { anterior, fonte, hoje });
  writeFileSync(arquivoSaida, JSON.stringify(r.dados, null, 2) + '\n');
  return { ...r, registro };
}

function hojeLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--hoje');
  const hoje = i >= 0 ? args.splice(i, 2)[1] : hojeLocal();
  if (args.length !== 2) {
    console.error('Uso: node workspace/_shared/engine/coletores/decisoes-md.mjs <registro.md> <saida.json> [--hoje AAAA-MM-DD]');
    process.exitCode = 1;
  } else {
    try {
      const r = coletar(args[0], args[1], { hoje });
      for (const a of r.avisos) console.warn(`aviso: ${a}`);
      const c = r.dados.coletor.contagem;
      console.log(`${args[1]}: ${c.confirmadas} confirmadas, ${c.pendentes} pendentes, ${r.dados.temas.length} temas; ${c.fora} linhas fora (substituídas ou respondidas).`);
    } catch (e) {
      console.error(`erro: ${e.message}`);
      process.exitCode = 1;
    }
  }
}

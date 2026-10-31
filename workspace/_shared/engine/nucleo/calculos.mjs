// Tudo o que o motor CALCULA em vez de aceitar digitado: progresso do roteiro, contador de riscos,
// totais de decisões e achados, janela de entregas. Painel, módulos e registro usam as mesmas funções,
// então os números de uma aba nunca contradizem os de outra.
import { slug } from './esc.mjs';
import { somarDias } from './datas.mjs';

export const ESTADOS_ITEM = ['feito', 'em-andamento', 'a-fazer', 'bloqueado'];
export const ESTADOS_FASE = ['feita', 'atual', 'futura'];
export const ESTADOS_RISCO = ['aberto', 'mitigando', 'fechado'];
export const SEVERIDADES = ['alta', 'media', 'baixa'];
export const ESTADOS_ACHADO = ['aberto', 'em-correcao', 'corrigido', 'descartado'];
export const ESTADOS_DECISAO = ['confirmada', 'pendente'];
export const ESTADOS_ETAPA = ['feito', 'em-andamento', 'pendente', 'bloqueado', 'na'];
export const SENTIDOS_METRICA = ['maior', 'menor'];
export const ESTADOS_ENTREGA_PADRAO = ['main', 'main local', 'branch local', 'PR aberto'];
export const JANELA_PADRAO = 30;

/** Texto de tela para cada valor normalizado. */
export const ROTULO = {
  feito: 'feito', 'em-andamento': 'em andamento', 'a-fazer': 'a fazer', bloqueado: 'bloqueado',
  feita: 'feita', atual: 'atual', futura: 'futura',
  aberto: 'aberto', mitigando: 'mitigando', fechado: 'fechado',
  alta: 'alta', media: 'média', baixa: 'baixa',
  'em-correcao': 'em correção', corrigido: 'corrigido', descartado: 'descartado',
  confirmada: 'Confirmada', pendente: 'Pendente', na: 'não se aplica',
};
export const rotulo = valor => ROTULO[slug(valor)] ?? String(valor);

const itensDe = fase => (Array.isArray(fase?.itens) ? fase.itens : []);

/**
 * Progresso do marco, calculado do roteiro:
 * - há fase atual com itens: feitos / itens da fase atual;
 * - há fase atual sem itens: fases feitas / fases;
 * - sem fase atual: feitos / itens de todo o roteiro (ou fases feitas / fases, se não houver itens).
 */
export function calcularProgresso(roteiro) {
  const fases = Array.isArray(roteiro?.fases) ? roteiro.fases : [];
  const unidade = typeof roteiro?.unidade === 'string' && roteiro.unidade.trim() ? roteiro.unidade.trim() : 'itens';
  const todos = fases.flatMap(itensDe);
  const feito = item => slug(item.estado) === 'feito';
  const fasesFeitas = fases.filter(f => slug(f.estado) === 'feita').length;
  const atual = fases.find(f => slug(f.estado) === 'atual') ?? null;
  const itens = {
    total: todos.length,
    feitos: todos.filter(feito).length,
    emAndamento: todos.filter(i => slug(i.estado) === 'em-andamento').length,
    bloqueados: todos.filter(i => slug(i.estado) === 'bloqueado').length,
  };
  let marco;
  if (atual && itensDe(atual).length) marco = { done: itensDe(atual).filter(feito).length, total: itensDe(atual).length, label: unidade, escopo: 'fase' };
  else if (atual || !todos.length) marco = { done: fasesFeitas, total: fases.length, label: 'fases', escopo: 'fases' };
  else marco = { done: itens.feitos, total: itens.total, label: unidade, escopo: 'roteiro' };
  return {
    unidade,
    fases: { total: fases.length, feitas: fasesFeitas, atual: atual ? { id: atual.id, nome: atual.nome } : null },
    itens,
    marco,
    fase: atual?.nome ?? null,
    texto: `${marco.done} de ${marco.total} ${marco.label}`,
  };
}

/** Contador de riscos: aberto = tudo que não está fechado. Única fonte do número em qualquer aba. */
export function contarRiscos(riscos) {
  const lista = Array.isArray(riscos) ? riscos : [];
  const por = (campo, valor) => lista.filter(r => slug(r[campo]) === valor).length;
  const abertosLista = lista.filter(r => slug(r.estado) !== 'fechado');
  return {
    total: lista.length,
    abertos: abertosLista.length,
    fechados: lista.length - abertosLista.length,
    porEstado: Object.fromEntries(ESTADOS_RISCO.map(e => [e, por('estado', e)])),
    abertosPorSeveridade: Object.fromEntries(SEVERIDADES.map(s => [s, abertosLista.filter(r => slug(r.severidade) === s).length])),
  };
}

export function contarDecisoes(dados) {
  const temas = Array.isArray(dados?.temas) ? dados.temas : [];
  const porTema = temas.map(t => {
    const ds = Array.isArray(t.decisoes) ? t.decisoes : [];
    const pendentes = ds.filter(d => slug(d.estado) === 'pendente').length;
    return { nome: t.nome, total: ds.length, pendentes, confirmadas: ds.length - pendentes };
  });
  const total = porTema.reduce((s, t) => s + t.total, 0);
  const pendentes = porTema.reduce((s, t) => s + t.pendentes, 0);
  return { total, pendentes, confirmadas: total - pendentes, porTema, espera: Array.isArray(dados?.espera) ? dados.espera.length : 0 };
}

export const achadoAberto = a => ['aberto', 'em-correcao'].includes(slug(a.estado));

export function contarAchados(iteracao) {
  const achados = Array.isArray(iteracao?.achados) ? iteracao.achados : [];
  const abertos = achados.filter(achadoAberto).length;
  return { total: achados.length, abertos, resolvidos: achados.length - abertos };
}

/** Etapas que contam para o progresso de um asset: todas menos as "não se aplica". */
export function progressoAsset(asset, etapas) {
  const estados = (Array.isArray(etapas) ? etapas : []).map(e => estadoEtapa(asset, e.id)).filter(s => s !== 'na');
  return { feitas: estados.filter(s => s === 'feito').length, total: estados.length };
}

export function estadoEtapa(asset, idEtapa) {
  const v = asset?.etapas?.[idEtapa];
  const s = slug(typeof v === 'object' && v !== null ? v.estado : v);
  return s || 'pendente';
}

// ---- entregas -----------------------------------------------------------------------------------

/** Uma entrega pode trazer `miniaturas[]` (texto ou { arquivo, legenda }) ou o antigo `miniatura`. */
export function miniaturasDe(e) {
  const lista = Array.isArray(e.miniaturas) ? e.miniaturas : [];
  const itens = lista.map(m => (typeof m === 'string' ? { arquivo: m } : m));
  if (typeof e.miniatura === 'string' && e.miniatura.trim()) itens.unshift({ arquivo: e.miniatura });
  return itens;
}

/** A ordem no arquivo é a ordem de chegada; dentro do mesmo dia, a mais nova aparece primeiro. */
export function ordenarEntregas(entregas) {
  return entregas.map((e, i) => ({ ...e, ordem: i })).sort((a, b) => b.data.localeCompare(a.data) || b.ordem - a.ordem);
}

/** Recentes: depois do corte (hoje - janelaDias). Antigas: no dia do corte ou antes. */
export function particionarEntregas(entregas, hoje, janelaDias = JANELA_PADRAO) {
  const ordenadas = ordenarEntregas(entregas);
  const corte = somarDias(hoje, -janelaDias);
  return {
    corte,
    desde: somarDias(corte, 1),
    recentes: ordenadas.filter(e => e.data > corte),
    antigas: ordenadas.filter(e => e.data <= corte),
  };
}

// ---- referências usadas em painel.json (numeros[].valor = "@riscos.abertos") ---------------------------

const REF = {
  'entregas.recentes': c => c.entregas && particionarEntregas(c.entregas.entregas ?? [], c.hoje, c.janelaDias).recentes.length,
  'entregas.arquivadas': c => c.entregas && particionarEntregas(c.entregas.entregas ?? [], c.hoje, c.janelaDias).antigas.length,
  'entregas.total': c => c.entregas && (c.entregas.entregas ?? []).length,
  'roteiro.progresso': c => c.roteiro && calcularProgresso(c.roteiro).texto,
  'roteiro.feitos': c => c.roteiro && calcularProgresso(c.roteiro).marco.done,
  'roteiro.total': c => c.roteiro && calcularProgresso(c.roteiro).marco.total,
  'roteiro.fase': c => c.roteiro && (calcularProgresso(c.roteiro).fase ?? '—'),
  'riscos.abertos': c => c.riscos && contarRiscos(c.riscos.riscos).abertos,
  'riscos.fechados': c => c.riscos && contarRiscos(c.riscos.riscos).fechados,
  'riscos.total': c => c.riscos && contarRiscos(c.riscos.riscos).total,
  'decisoes.pendentes': c => c.decisoes && contarDecisoes(c.decisoes).pendentes,
  'decisoes.confirmadas': c => c.decisoes && contarDecisoes(c.decisoes).confirmadas,
  'decisoes.total': c => c.decisoes && contarDecisoes(c.decisoes).total,
  'playtest.abertos': c => c.playtest && (c.playtest.iteracoes ?? []).filter(i => i.aberta === true).reduce((s, i) => s + contarAchados(i).abertos, 0),
  'playtest.achados': c => c.playtest && (c.playtest.iteracoes ?? []).filter(i => i.aberta === true).reduce((s, i) => s + contarAchados(i).total, 0),
};
export const REFERENCIAS = Object.keys(REF);

/** "@riscos.abertos" -> valor calculado. `fontes` = { entregas, roteiro, riscos, decisoes, playtest, hoje, janelaDias }. */
export function resolverReferencia(ref, fontes) {
  const nome = String(ref).replace(/^@/, '');
  if (!REF[nome]) return { erro: `referência "${ref}" desconhecida (use uma de: ${REFERENCIAS.map(r => '@' + r).join(', ')})` };
  const arquivo = nome.split('.')[0];
  if (!fontes[arquivo]) return { erro: `"${ref}" precisa de ${arquivo}.json, que não existe neste card` };
  return { valor: REF[nome](fontes) };
}


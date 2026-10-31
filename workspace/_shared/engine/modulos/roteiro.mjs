// Aba Roteiro: fases (eras, marcos, milestones) e as tarefas de cada uma, com dependências e pendências.
// O progresso é CALCULADO daqui: o Painel e o card da tela inicial usam o mesmo cálculo (nucleo/calculos.mjs).
// Fonte: roteiro.json -> { unidade?, fases: [{ id, nome, estado, descricao?, itens?: [{ id, titulo, estado, depende?[], pendencias?[], resumo? }] }] }
import {
  ehObjeto, exigirTexto, opcionalTexto, listaDe, itensObjeto, idsUnicos, enumeracao, ehTexto,
} from '../nucleo/validacao.mjs';
import { ESTADOS_FASE, ESTADOS_ITEM, calcularProgresso, rotulo } from '../nucleo/calculos.mjs';
import { esc, texto, slug, plural } from '../nucleo/esc.mjs';
import { bloco, chip, barra, linhaFases } from '../nucleo/componentes.mjs';

export const fonte = 'roteiro';
const TOM_ITEM = { feito: 'ok', 'em-andamento': 'info', 'a-fazer': 'neutro', bloqueado: 'erro' };
const TOM_FASE = { feita: 'ok', atual: 'destaque', futura: 'neutro' };
const PEND_ABERTAS = 3;

/** Acha um ciclo em depende[] e devolve o caminho (["A", "B", "A"]) ou null. */
export function acharCiclo(itens) {
  const mapa = new Map(itens.map(i => [i.id, i.depende ?? []]));
  const estado = new Map(); // 1 = em visita, 2 = pronto
  const pilha = [];
  const visitar = id => {
    if (estado.get(id) === 2) return null;
    if (estado.get(id) === 1) return [...pilha.slice(pilha.indexOf(id)), id];
    estado.set(id, 1); pilha.push(id);
    for (const d of mapa.get(id) ?? []) {
      if (!mapa.has(d)) continue;
      const ciclo = visitar(d);
      if (ciclo) return ciclo;
    }
    pilha.pop(); estado.set(id, 2);
    return null;
  };
  for (const id of mapa.keys()) { const c = visitar(id); if (c) return c; }
  return null;
}

export function validar(dados) {
  const erros = [], avisos = [];
  if (!ehObjeto(dados)) return ['o arquivo deve ser um objeto com a lista "fases"'];
  opcionalTexto(erros, 'roteiro', dados, 'unidade', 30);
  const fases = itensObjeto(erros, 'roteiro', listaDe(erros, 'roteiro', dados, 'fases', { obrigatoria: true }), 'fase');
  if (Array.isArray(dados.fases) && !dados.fases.length) erros.push('roteiro: "fases" está vazia');
  const todos = [];
  fases.forEach((f, i) => {
    const onde = `fase ${i + 1} (${f.id ?? 'sem id'})`;
    exigirTexto(erros, onde, f, 'id');
    exigirTexto(erros, onde, f, 'nome');
    opcionalTexto(erros, onde, f, 'descricao');
    enumeracao(erros, onde, f, 'estado', ESTADOS_FASE);
    const itens = itensObjeto(erros, onde, listaDe(erros, onde, f, 'itens'), 'item');
    itens.forEach((it, j) => {
      const qual = `${onde} › item ${j + 1} (${it.id ?? 'sem id'})`;
      exigirTexto(erros, qual, it, 'id');
      exigirTexto(erros, qual, it, 'titulo');
      opcionalTexto(erros, qual, it, 'resumo');
      enumeracao(erros, qual, it, 'estado', ESTADOS_ITEM);
      for (const campo of ['depende', 'pendencias']) {
        const lista = listaDe(erros, qual, it, campo);
        if (lista.some(x => !ehTexto(x))) erros.push(`${qual}: "${campo}" deve ter só textos`);
      }
      todos.push({ ...it, fase: f });
    });
    idsUnicos(erros, onde, itens, 'item');
  });
  idsUnicos(erros, 'roteiro', fases, 'fase');
  // Ids de item únicos no roteiro inteiro: "depende" aponta para eles sem dizer a fase.
  const vistos = new Map();
  for (const it of todos) {
    if (!ehTexto(it.id)) continue;
    if (vistos.has(it.id) && vistos.get(it.id) !== it.fase) erros.push(`roteiro: item "${it.id}" aparece em duas fases (${vistos.get(it.id).id} e ${it.fase.id}); o id precisa ser único no roteiro`);
    vistos.set(it.id, it.fase);
  }
  for (const it of todos) {
    for (const d of Array.isArray(it.depende) ? it.depende : []) {
      if (d === it.id) erros.push(`item ${it.id}: depende de si mesmo`);
      else if (!vistos.has(d)) erros.push(`item ${it.id}: depende de "${d}", que não existe no roteiro`);
    }
  }
  const ciclo = acharCiclo(todos.filter(it => ehTexto(it.id)));
  if (ciclo) erros.push(`roteiro: dependência circular: ${ciclo.join(' → ')}`);
  const atuais = fases.filter(f => slug(f.estado) === 'atual');
  if (atuais.length > 1) erros.push(`roteiro: só uma fase pode ser "atual"; marcadas: ${atuais.map(f => f.id).join(', ')}`);
  if (!erros.length) {
    for (const f of fases) {
      const itens = Array.isArray(f.itens) ? f.itens : [];
      if (slug(f.estado) === 'feita' && itens.some(i => slug(i.estado) !== 'feito')) avisos.push(`fase ${f.id} está "feita", mas tem item sem estar feito`);
      if (slug(f.estado) === 'futura' && itens.some(i => slug(i.estado) === 'feito')) avisos.push(`fase ${f.id} está "futura", mas tem item já feito`);
    }
  }
  return { erros, avisos };
}

function tarefa(it, porId, ctx) {
  const estado = slug(it.estado);
  const deps = (it.depende ?? []).map(d => {
    const pronto = slug(porId.get(d)?.estado) === 'feito';
    return `<span class="mk-id ${pronto ? 'mk-pronto' : 'mk-aberta'}" title="${pronto ? 'feita' : 'ainda não feita'}">${esc(d)}</span>`;
  });
  const n = it.pendencias?.length ?? 0;
  const pend = n ? `<ul class="mk-pend">${it.pendencias.map(p => `<li>${texto(p)}</li>`).join('')}</ul>` : '';
  // Muitas pendências recolhidas: a tarefa continua cabendo numa linha de leitura.
  const blocoPend = n > PEND_ABERTAS
    ? `<details class="mk-pend-grupo"><summary>${plural(n, 'pendência')}</summary>${pend}</details>`
    : `<div>${n === 1 ? 'Pendência' : 'Pendências'}:${pend}</div>`;
  const corpo = [
    it.resumo ? `<p>${texto(it.resumo)}</p>` : '',
    deps.length ? `<div class="mk-dep"><span>Depende de</span> ${deps.join(' ')}</div>` : '',
    n ? blocoPend : '',
  ].filter(Boolean).join('\n');
  return `<li class="mk-tarefa" data-estado="${estado}">
  <span class="mk-bola mk-${estado}" role="img" aria-label="${esc(rotulo(estado))}"></span>
  <div class="mk-tarefa-titulo"><span class="mk-id">${esc(it.id)}</span><b>${texto(it.titulo)}</b>${chip(rotulo(estado), TOM_ITEM[estado])}</div>${corpo ? `\n  <div class="mk-tarefa-corpo">\n${corpo}\n  </div>` : ''}
</li>`;
}

export function gerar(dados, ctx) {
  const calc = calcularProgresso(dados);
  const porId = new Map(dados.fases.flatMap(f => f.itens ?? []).map(i => [i.id, i]));
  const unidade = calc.unidade;
  const doMarco = calc.marco;
  const quemMarco = doMarco.escopo === 'fase' ? `Fase atual: ${calc.fase}` : doMarco.escopo === 'roteiro' ? 'Roteiro inteiro' : `Fases feitas${calc.fase ? ` · fase atual: ${calc.fase}` : ''}`;
  const resumo = `<div class="mk-progresso-topo"><b>${esc(calc.texto)}</b><span>${esc(quemMarco)}</span></div>
${barra(doMarco.done, doMarco.total, { legenda: `Progresso: ${calc.texto}` })}
<p class="mk-nota" style="margin-top:10px">${plural(calc.fases.feitas, 'fase feita', 'fases feitas')} de ${calc.fases.total}`
    + (calc.itens.total ? ` · roteiro todo: ${calc.itens.feitos} de ${calc.itens.total} ${esc(unidade)}` : '')
    + (calc.itens.emAndamento ? ` · ${calc.itens.emAndamento} em andamento` : '')
    + (calc.itens.bloqueados ? ` · ${calc.itens.bloqueados} bloqueado${calc.itens.bloqueados === 1 ? '' : 's'}` : '') + '.</p>'
    + linhaFases(dados.fases.map(f => ({ nome: f.nome, estado: slug(f.estado), rotulo: rotulo(f.estado) })));

  const fases = dados.fases.map(f => {
    const estado = slug(f.estado);
    const itens = f.itens ?? [];
    const feitos = itens.filter(i => slug(i.estado) === 'feito').length;
    const conta = itens.length
      ? `<div class="mk-fase-conta"><span>${feitos} de ${itens.length} ${esc(unidade)}</span>${barra(feitos, itens.length, { legenda: `Fase ${f.nome}`, mini: true })}</div>`
      : '<div class="mk-fase-conta"><span>Sem tarefas detalhadas ainda</span></div>';
    const lista = itens.length ? `<ul class="mk-tarefas">\n${itens.map(i => tarefa(i, porId, ctx)).join('\n')}\n</ul>` : '';
    return `<details class="mk-fase${estado === 'atual' ? ' mk-atual' : ''}" id="fase-${esc(f.id)}"${estado === 'atual' ? ' open' : ''}>
<summary><span class="mk-fase-nome"><span class="mk-id">${esc(f.id)}</span>${texto(f.nome)} ${chip(rotulo(estado), TOM_FASE[estado])}</span>${conta}</summary>
<div class="mk-fase-corpo">${f.descricao ? `\n<p>${texto(f.descricao)}</p>` : ''}${lista ? `\n${lista}` : ''}
</div>
</details>`;
  }).join('\n');

  return ctx.pagina({
    titulo: ctx.aba.nome,
    subtitulo: `${esc(calc.texto)}${calc.fase ? ` · fase atual: ${esc(calc.fase)}` : ''} · atualizado em ${ctx.dataLonga(ctx.hoje)}.`,
    corpo: `${bloco('Progresso', resumo, { icone: 'marco', ctx })}\n<h2 class="mk-t" style="margin-top:26px">Fases e tarefas</h2>\n${fases}`,
  });
}

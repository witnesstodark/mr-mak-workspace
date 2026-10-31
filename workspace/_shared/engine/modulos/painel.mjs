// Aba Painel, com esqueleto fixo: capa, barra de números, progresso do marco, "Agora / Com você"
// e a tira das últimas imagens.
// Fonte: painel.json -> { estado?, numeros?: [{ rotulo, valor, icone? }], agora?: [], comVoce?: [], links?: [] }
// A faixa de capa vem de projeto.json. O progresso sai de roteiro.json e a tira de entregas.json.
// `valor` de um número pode ser um texto ou uma referência calculada, como "@riscos.abertos" (lista em nucleo/calculos.mjs):
// assim o número do Painel nunca discorda do da aba correspondente.
import {
  ehObjeto, exigirTexto, opcionalTexto, listaDe, itensObjeto, validarLinksPdf, ehTexto, normalizarResultado, semRepetidas,
} from '../nucleo/validacao.mjs';
import { calcularProgresso, resolverReferencia, miniaturasDe, ordenarEntregas, rotulo } from '../nucleo/calculos.mjs';
import { esc, texto, slug } from '../nucleo/esc.mjs';
import { icone, chip, barra, linhaFases, bloco, listaItens, imagem } from '../nucleo/componentes.mjs';
import * as modEntregas from './entregas.mjs';
import * as modRoteiro from './roteiro.mjs';
import * as modRiscos from './riscos.mjs';
import * as modDecisoes from './decisoes.mjs';
import * as modPlaytest from './playtest.mjs';

export const fonte = 'painel';
const MAX_IMAGENS = 8;
const OUTRAS_FONTES = { entregas: modEntregas, roteiro: modRoteiro, riscos: modRiscos, decisoes: modDecisoes, playtest: modPlaytest };

/** Os arquivos que o Painel lê além do próprio. */
function fontesLidas(ctx) {
  return Object.fromEntries(Object.keys(OUTRAS_FONTES).map(n => [n, ctx.carregar(n)]));
}

export function validar(dados, ctx) {
  const erros = [];
  if (!ehObjeto(dados)) return ['o arquivo deve ser um objeto'];
  opcionalTexto(erros, 'painel', dados, 'estado', 100);
  const numeros = itensObjeto(erros, 'painel', listaDe(erros, 'painel', dados, 'numeros'), 'número');
  const fontes = { ...fontesLidas(ctx), hoje: ctx.hoje, janelaDias: ctx.janelaDias };
  const usadas = new Set(['entregas', 'roteiro']);
  numeros.forEach((n, i) => {
    const onde = `número ${i + 1} (${n.rotulo ?? 'sem rótulo'})`;
    exigirTexto(erros, onde, n, 'rotulo');
    if (!(ehTexto(n.valor) || (typeof n.valor === 'number' && Number.isFinite(n.valor)))) erros.push(`${onde}: falta "valor" (texto, número ou referência como "@riscos.abertos")`);
    if (n.icone !== undefined && !/^[a-z0-9-]+$/.test(n.icone ?? '')) erros.push(`${onde}: icone deve ter só minúsculas, números e hífen`);
    if (typeof n.valor === 'string' && n.valor.startsWith('@')) {
      usadas.add(n.valor.slice(1).split('.')[0]);
      let r;
      try { r = resolverReferencia(n.valor, fontes); } catch { r = {}; } // dados quebrados: a aba de origem acusa o erro
      if (r.erro) erros.push(`${onde}: ${r.erro}`);
    }
  });
  for (const campo of ['agora', 'comVoce']) {
    listaDe(erros, 'painel', dados, campo).forEach((x, i) => {
      if (typeof x === 'string' ? !x.trim() : !(ehObjeto(x) && ehTexto(x.titulo))) erros.push(`painel: item ${i + 1} de "${campo}" deve ser um texto ou { titulo, texto }`);
    });
  }
  validarLinksPdf(erros, 'painel', dados.links);
  // Os arquivos que o Painel lê precisam estar íntegros mesmo sem a aba correspondente.
  const abas = ctx.projeto.abas.map(a => a.modulo);
  for (const nome of usadas) {
    const mod = OUTRAS_FONTES[nome], dadosFonte = fontes[nome];
    if (!mod || dadosFonte === undefined || abas.includes(nome)) continue;
    const r = normalizarResultado(mod.validar(dadosFonte, ctx));
    for (const m of r.erros) erros.push(`${nome}.json: ${m}`);
  }
  return semRepetidas(erros);
}

function valorDoNumero(n, fontes) {
  if (typeof n.valor === 'string' && n.valor.startsWith('@')) return String(resolverReferencia(n.valor, fontes).valor ?? '—');
  return String(n.valor);
}

export function gerar(dados, ctx) {
  const outras = fontesLidas(ctx);
  const fontes = { ...outras, hoje: ctx.hoje, janelaDias: ctx.janelaDias };
  const partes = [];

  if (dados.numeros?.length) {
    partes.push(`<div class="mk-numeros">\n${dados.numeros.map(n =>
      `<div class="mk-numero">${n.icone ? icone(n.icone, ctx) : ''}<div><small>${texto(n.rotulo)}</small><b>${esc(valorDoNumero(n, fontes))}</b></div></div>`).join('\n')}\n</div>`);
  }

  if (outras.roteiro) {
    const calc = calcularProgresso(outras.roteiro);
    const m = calc.marco;
    const quem = m.escopo === 'fase' ? `Fase atual: ${calc.fase}` : m.escopo === 'fases' ? `Fases feitas${calc.fase ? ` · fase atual: ${calc.fase}` : ''}` : 'Roteiro inteiro';
    const corpo = `<div class="mk-progresso-topo"><b>${esc(calc.texto)}</b><span>${esc(quem)}</span></div>
${barra(m.done, m.total, { legenda: `Progresso do marco: ${calc.texto}` })}
${linhaFases(outras.roteiro.fases.map(f => ({ nome: f.nome, estado: slug(f.estado), rotulo: rotulo(f.estado) })))}`;
    partes.push(bloco('Progresso do marco', corpo, { icone: 'marco', ctx }));
  }

  const lista = (itens, vazio) => (itens?.length ? listaItens(itens) : `<p class="mk-vazio">${vazio}</p>`);
  partes.push(`<div class="mk-duas">\n${bloco('Agora', lista(dados.agora, 'Nada em andamento registrado.'), { icone: 'agora', ctx })}\n${bloco('Com você', lista(dados.comVoce, 'Nada esperando por você.'), { icone: 'pessoa', ctx })}\n</div>`);

  if (outras.entregas) {
    const imagens = [];
    for (const e of ordenarEntregas(outras.entregas.entregas ?? [])) {
      for (const [i, m] of miniaturasDe(e).entries()) imagens.push({ ...m, titulo: e.titulo, data: e.data, i });
      if (imagens.length >= MAX_IMAGENS) break;
    }
    const tira = imagens.slice(0, MAX_IMAGENS);
    if (tira.length) {
      partes.push(bloco('Últimas imagens', `<div class="mk-tira">\n${tira.map(m =>
        `<figure>${imagem(m.arquivo, m.legenda ?? m.titulo)}<figcaption>${ctx.esc(m.titulo)}</figcaption></figure>`).join('\n')}\n</div>`, { icone: 'imagem', ctx }));
    }
  }

  if (dados.links?.length) {
    partes.push(`<p class="mk-links">${dados.links.map(l => `<a href="${esc(l.url)}">${esc(l.rotulo)}</a>`).join('')}</p>`);
  }

  return ctx.pagina({
    titulo: ctx.projeto.titulo,
    eyebrow: ctx.aba.nome,
    subtitulo: [ctx.projeto.sobre ? texto(ctx.projeto.sobre) : '', `Atualizado em ${ctx.dataLonga(ctx.hoje)}.`].filter(Boolean).join(' '),
    selo: dados.estado ? chip(dados.estado, 'destaque') : undefined,
    alto: true,
    corpo: partes.join('\n'),
  });
}

// projeto.json: leitura e validação. É o único arquivo obrigatório de um card.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ehObjeto, ehTexto, exigirTexto, opcionalTexto, listaDe, itensObjeto, idsUnicos, validarCor, validarIdSlug, validarCaminho,
} from './validacao.mjs';
import { JANELA_PADRAO, ESTADOS_ENTREGA_PADRAO } from './calculos.mjs';

/** Lê um JSON do card. Devolve undefined se o arquivo não existir; lança Error com mensagem clara se estiver quebrado. */
export function lerJson(pasta, arquivo) {
  const caminho = join(pasta, arquivo);
  if (!existsSync(caminho)) return undefined;
  const bruto = readFileSync(caminho, 'utf8').replace(/^﻿/, '');
  try {
    return JSON.parse(bruto);
  } catch (erro) {
    throw new Error(`${arquivo}: JSON inválido (${erro.message})`);
  }
}

const IMAGENS_CAPA = ['webp', 'jpg', 'jpeg', 'png'];

/** Devolve { erros, avisos }. `pasta` serve para conferir que capa e temaCss existem. */
export function validarProjeto(p, pasta) {
  const erros = [];
  const avisos = [];
  const onde = 'projeto.json';
  if (!ehObjeto(p)) return { erros: [`${onde}: deve ser um objeto`], avisos };
  validarIdSlug(erros, onde, p.id);
  exigirTexto(erros, onde, p, 'titulo');
  opcionalTexto(erros, onde, p, 'sobre', 400);
  opcionalTexto(erros, onde, p, 'repositorio');
  validarCor(erros, onde, p.destaque, 'destaque');
  const tema = p.tema ?? 'base';
  if (!['base', 'custom'].includes(tema)) erros.push(`${onde}: tema "${p.tema}" deve ser base ou custom`);
  if (tema === 'custom') {
    if (!ehTexto(p.temaCss)) erros.push(`${onde}: tema custom pede "temaCss" (caminho do CSS do projeto)`);
    else validarCaminho(erros, `${onde} › temaCss`, p.temaCss, { pasta, extensoes: ['css'] });
  } else if (p.temaCss !== undefined) {
    erros.push(`${onde}: "temaCss" só vale com "tema": "custom"`);
  }
  if (p.capa !== undefined) validarCaminho(erros, `${onde} › capa`, p.capa, { pasta, extensoes: IMAGENS_CAPA });
  if (p.janelaDias !== undefined && !(Number.isInteger(p.janelaDias) && p.janelaDias >= 1 && p.janelaDias <= 3650)) {
    erros.push(`${onde}: janelaDias deve ser um número inteiro de 1 a 3650`);
  }
  const areas = itensObjeto(erros, onde, listaDe(erros, onde, p, 'areas'), 'área');
  areas.forEach((a, i) => {
    const qual = `${onde} › área ${i + 1} (${a.id ?? 'sem id'})`;
    exigirTexto(erros, qual, a, 'id');
    validarCor(erros, qual, a.cor, 'cor');
    if (a.icone !== undefined && !/^[a-z0-9-]+$/.test(a.icone ?? '')) erros.push(`${qual}: icone deve ter só minúsculas, números e hífen`);
  });
  idsUnicos(erros, onde, areas, 'área');
  for (const c of listaDe(erros, onde, p, 'categoriasExtras')) if (!ehTexto(c)) erros.push(`${onde}: categoriasExtras deve ter só textos`);
  for (const s of listaDe(erros, onde, p, 'estadosEntrega')) if (!ehTexto(s)) erros.push(`${onde}: estadosEntrega deve ter só textos`);

  const abas = listaDe(erros, onde, p, 'abas', { obrigatoria: true });
  if (Array.isArray(p.abas) && !abas.length) erros.push(`${onde}: "abas" está vazia (liste ao menos o painel)`);
  const bases = new Set(), nomes = new Set();
  itensObjeto(erros, onde, abas, 'aba').forEach((a, i) => {
    const qual = `${onde} › aba ${i + 1} (${a.nome ?? a.modulo ?? 'sem nome'})`;
    validarIdSlug(erros, qual, a.modulo, 'modulo');
    exigirTexto(erros, qual, a, 'nome');
    if (a.base !== undefined) validarIdSlug(erros, qual, a.base, 'base');
    const base = a.base ?? a.modulo;
    if (ehTexto(base)) { if (bases.has(base)) erros.push(`${qual}: dois módulos usariam ${base}.json; dê um "base" diferente à segunda aba`); bases.add(base); }
    if (ehTexto(a.nome)) { if (nomes.has(a.nome)) erros.push(`${qual}: nome de aba repetido`); nomes.add(a.nome); }
  });
  if (p.tipo !== undefined && !['jogo', 'ferramenta', 'outro'].includes(p.tipo)) erros.push(`${onde}: "tipo" deve ser jogo, ferramenta ou outro`);
  // Todo card de jogo tem Acervo, para a biblioteca de assets, os jobs e o "Enviar ao agente".
  if (p.tipo === 'jogo' && abas.length && !abas.some(a => a?.modulo === 'acervo')) erros.push(`${onde}: card de jogo ("tipo": "jogo") pede a aba "acervo"`);
  if (p.tipo === 'jogo' && !ehTexto(p.repositorio)) erros.push(`${onde}: card de jogo pede "repositorio" (a pasta do jogo), para o "Enviar ao agente" achar o chat`);
  if (abas.length && !abas.some(a => a?.modulo === 'painel')) avisos.push(`${onde}: o núcleo fixo pede a aba "painel" (primeira da lista)`);
  return { erros, avisos };
}

/** Projeto com os padrões aplicados. */
export function comPadroes(p) {
  return {
    ...p,
    destaque: p.destaque ?? '#5b7cfa',
    tema: p.tema ?? 'base',
    janelaDias: p.janelaDias ?? JANELA_PADRAO,
    areas: p.areas ?? [],
    categoriasExtras: p.categoriasExtras ?? [],
    estadosEntrega: p.estadosEntrega ?? ESTADOS_ENTREGA_PADRAO,
    abas: (p.abas ?? []).map(a => ({ ...a, base: a.base ?? a.modulo })),
  };
}

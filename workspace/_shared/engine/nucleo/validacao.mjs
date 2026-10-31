// Validação comum. Cada função acrescenta mensagens claras (em português) à lista `erros` e não lança.
// O motor junta as mensagens de todos os módulos, mostra todas de uma vez e só gera as páginas se não houver erro.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { diaValido } from './datas.mjs';
import { slug } from './esc.mjs';

export const MINIATURA_MAX = 150 * 1024;
export const EXTENSOES_IMAGEM = ['webp', 'jpg', 'jpeg', 'png'];
const COR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const ID_SLUG = /^[a-z][a-z0-9-]*$/;

export const ehTexto = v => typeof v === 'string' && v.trim() !== '';
export const ehObjeto = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Aceita o que `validar` de um módulo pode devolver e normaliza para { erros, avisos }. */
export function normalizarResultado(ret) {
  if (ret == null || ret === true) return { erros: [], avisos: [] };
  if (typeof ret === 'string') return { erros: [ret], avisos: [] };
  if (Array.isArray(ret)) return { erros: ret.map(String), avisos: [] };
  if (ehObjeto(ret)) return { erros: (ret.erros ?? []).map(String), avisos: (ret.avisos ?? []).map(String) };
  return { erros: [], avisos: [] };
}

/** Falta o campo de texto, ou ele está vazio. Devolve o valor aparado, ou undefined se faltou. */
export function exigirTexto(erros, onde, obj, campo) {
  const v = obj?.[campo];
  if (!ehTexto(v)) { erros.push(`${onde}: falta "${campo}" (texto)`); return undefined; }
  return v.trim();
}

/** Campo opcional: se presente, tem de ser texto não vazio. */
export function opcionalTexto(erros, onde, obj, campo, max) {
  const v = obj?.[campo];
  if (v === undefined || v === null) return undefined;
  if (!ehTexto(v)) { erros.push(`${onde}: "${campo}" deve ser texto`); return undefined; }
  if (max && v.length > max) erros.push(`${onde}: "${campo}" com mais de ${max} caracteres`);
  return v.trim();
}

/** Devolve a lista (ou [] se faltar). `obrigatoria` acusa campo ausente. */
export function listaDe(erros, onde, obj, campo, { obrigatoria = false } = {}) {
  const v = obj?.[campo];
  if (v === undefined || v === null) {
    if (obrigatoria) erros.push(`${onde}: falta "${campo}" (lista)`);
    return [];
  }
  if (!Array.isArray(v)) { erros.push(`${onde}: "${campo}" deve ser uma lista`); return []; }
  return v;
}

/** Cada item tem de ser objeto; devolve só os que são. Acusa o resto. */
export function itensObjeto(erros, onde, lista, nome) {
  return lista.filter((item, i) => {
    if (ehObjeto(item)) return true;
    erros.push(`${onde}: ${nome} ${i + 1} deve ser um objeto`);
    return false;
  });
}

/** Acusa id repetido. `rotulo` é como o item aparece na mensagem ("entrega", "risco"...). */
export function idsUnicos(erros, onde, lista, rotulo) {
  const vistos = new Set();
  for (const item of lista) {
    if (!ehTexto(item?.id)) continue;
    if (vistos.has(item.id)) erros.push(`${onde}: ${rotulo} com id repetido: ${item.id}`);
    vistos.add(item.id);
  }
  return vistos;
}

/** O valor (sem diferenciar maiúsculas e acentos) tem de ser um dos permitidos. Devolve o valor normalizado. */
export function enumeracao(erros, onde, obj, campo, permitidos, { obrigatorio = true } = {}) {
  const v = obj?.[campo];
  if (v === undefined || v === null || v === '') {
    if (obrigatorio) erros.push(`${onde}: falta "${campo}" (um de: ${permitidos.join(', ')})`);
    return undefined;
  }
  const s = slug(v);
  if (!permitidos.includes(s)) { erros.push(`${onde}: ${campo} "${v}" fora de ${permitidos.join(', ')}`); return undefined; }
  return s;
}

export function exigirData(erros, onde, obj, campo, { obrigatoria = true } = {}) {
  const v = obj?.[campo];
  if (v === undefined || v === null || v === '') {
    if (obrigatoria) erros.push(`${onde}: falta "${campo}" (AAAA-MM-DD)`);
    return undefined;
  }
  if (!diaValido(v)) { erros.push(`${onde}: ${campo} "${v}" não é uma data AAAA-MM-DD válida`); return undefined; }
  return v;
}

export function validarCor(erros, onde, valor, campo = 'cor') {
  if (valor === undefined || valor === null) return;
  if (typeof valor !== 'string' || !COR.test(valor)) erros.push(`${onde}: ${campo} "${valor}" deve ser uma cor em hexadecimal (#rgb, #rrggbb)`);
}

export function validarIdSlug(erros, onde, valor, campo = 'id') {
  if (!ehTexto(valor)) { erros.push(`${onde}: falta "${campo}"`); return; }
  if (!ID_SLUG.test(valor)) erros.push(`${onde}: ${campo} "${valor}" deve ter só minúsculas, números e hífen (ex.: meu-projeto)`);
}

/**
 * Caminho relativo à pasta do card: sem URL, sem barra invertida, sem "..".
 * Opções: pasta (para conferir existência), extensoes, max (bytes), prefixo (ex.: "media/").
 */
export function validarCaminho(erros, onde, rel, { pasta, extensoes, max, prefixo } = {}) {
  if (!ehTexto(rel)) { erros.push(`${onde}: caminho vazio`); return false; }
  if (/^[a-z][a-z0-9+.-]*:/i.test(rel) || rel.startsWith('/') || rel.startsWith('\\') || /^[a-z]:/i.test(rel)) {
    erros.push(`${onde}: o caminho "${rel}" deve ser relativo à pasta do card`); return false;
  }
  if (rel.includes('\\')) { erros.push(`${onde}: use "/" no caminho "${rel}"`); return false; }
  if (rel.split('/').includes('..')) { erros.push(`${onde}: o caminho "${rel}" não pode sair da pasta do card`); return false; }
  if (prefixo && !rel.startsWith(prefixo)) { erros.push(`${onde}: o caminho "${rel}" deve ficar em ${prefixo}`); return false; }
  if (extensoes) {
    const ext = rel.split('.').pop().toLowerCase();
    if (!extensoes.includes(ext)) { erros.push(`${onde}: "${rel}" deve ser ${extensoes.join(', ')}`); return false; }
  }
  if (pasta) {
    const arquivo = join(pasta, rel);
    if (!existsSync(arquivo) || !statSync(arquivo).isFile()) { erros.push(`${onde}: arquivo não existe: ${rel}`); return false; }
    if (max && statSync(arquivo).size > max) { erros.push(`${onde}: ${rel} acima de ${Math.round(max / 1024)} KB`); return false; }
  }
  return true;
}

/** Miniatura de entrega ou acervo: imagem em media/, até 150 KB. */
export function validarMiniatura(erros, onde, rel, pasta) {
  return validarCaminho(erros, onde, rel, { pasta, extensoes: EXTENSOES_IMAGEM, max: MINIATURA_MAX, prefixo: 'media/' });
}

/**
 * Regra do Vanderlei (2026-10-15): o card não leva links, só para PDF. O resto entra embutido.
 * Vale para todo `links[]` do motor.
 */
export function validarLinksPdf(erros, onde, links) {
  if (links === undefined || links === null) return;
  if (!Array.isArray(links)) { erros.push(`${onde}: links deve ser lista`); return; }
  for (const l of links) {
    if (!ehObjeto(l) || !ehTexto(l.rotulo) || !/^https:\/\/\S+\.pdf$/i.test(l.url ?? '')) {
      erros.push(`${onde}: link só para PDF (https://... .pdf), com rótulo`);
    }
  }
}

/** Remove mensagens repetidas mantendo a ordem. */
export function semRepetidas(lista) {
  return [...new Set(lista)];
}

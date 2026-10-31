// Escape e formatação mínima de texto para HTML.
const MAPA = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapa texto para HTML (conteúdo e atributos). Aceita qualquer valor; null e undefined viram "". */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => MAPA[c]);
}

/** Escapa e transforma `trecho` entre crases em <code>. É a única formatação aceita nos textos do JSON. */
export function texto(s) {
  return esc(s).replace(/`([^`\n]+)`/g, '<code>$1</code>');
}

/** Caminho relativo seguro para src/href e url('...') dentro de style="...". */
export function urlRelativa(caminho) {
  return encodeURI(String(caminho).replace(/\\/g, '/')).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/** Minúsculas, sem acento, espaços e sublinhados viram hífen: "Em andamento" -> "em-andamento". */
export function slug(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[\s_]+/g, '-');
}

/** Plural simples: 1 entrega, 2 entregas. */
export function plural(n, singular, pluralForma = `${singular}s`) {
  return `${n} ${n === 1 ? singular : pluralForma}`;
}

// Ícones do tema base. Cada um é um desenho de traço em 24x24, aplicado como máscara de CSS
// (<span class="mk-ico mk-i-nome">), nunca como <img>: o visualizador de imagens do report.js
// só abre <img>, então os ícones não viram "imagens" da página.
//
// A seção entre os marcadores de tema-base.css é gerada daqui:
//   node workspace/_shared/engine/nucleo/icones.mjs --escrever
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ICONES = {
  ponto: "<circle cx='12' cy='12' r='4' fill='black'/>",
  painel: "<rect x='3' y='3' width='8' height='8' rx='1'/><rect x='13' y='3' width='8' height='5' rx='1'/><rect x='13' y='10' width='8' height='11' rx='1'/><rect x='3' y='13' width='8' height='8' rx='1'/>",
  codigo: "<path d='M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16'/>",
  arte: "<rect x='3' y='4' width='18' height='16' rx='2'/><circle cx='9' cy='10' r='1.6'/><path d='M3 17l5-4 4 3 3-2 6 4'/>",
  audio: "<path d='M4 9v6h4l5 4V5L8 9H4z'/><path d='M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12'/>",
  design: "<path d='M4 20l1-4L16 5l3 3L8 19z'/><path d='M14 7l3 3'/>",
  playtest: "<rect x='2.5' y='7' width='19' height='11' rx='5'/><path d='M7 10v5M4.5 12.5h5'/><circle cx='15.5' cy='11.5' r='.9' fill='black'/><circle cx='18' cy='14' r='.9' fill='black'/>",
  ferramentas: "<circle cx='12' cy='12' r='3'/><path d='M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1'/>",
  entrega: "<path d='M3 8l9-5 9 5v8l-9 5-9-5z'/><path d='M3 8l9 5 9-5M12 13v8'/>",
  check: "<circle cx='12' cy='12' r='9'/><path d='M8 12.5l3 3 5-6'/>",
  risco: "<path d='M12 3l10 18H2z'/><path d='M12 10v5M12 18v.4'/>",
  marco: "<path d='M5 21V4M5 4h11l-2 4 2 4H5'/>",
  alvo: "<circle cx='12' cy='12' r='9'/><circle cx='12' cy='12' r='5'/><circle cx='12' cy='12' r='1' fill='black'/>",
  relogio: "<circle cx='12' cy='12' r='9'/><path d='M12 7v5l3 2'/>",
  grafico: "<path d='M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-8'/>",
  pessoa: "<circle cx='12' cy='8' r='4'/><path d='M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7'/>",
  mundo: "<circle cx='12' cy='12' r='9'/><path d='M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18'/>",
  livro: "<path d='M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z'/><path d='M4 21V5M9 8h6'/>",
  estrela: "<path d='M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z'/>",
  arquivo: "<rect x='3' y='4' width='18' height='4' rx='1'/><path d='M5 8v11h14V8M10 12h4'/>",
  pipeline: "<circle cx='5' cy='12' r='2'/><circle cx='12' cy='12' r='2'/><circle cx='19' cy='12' r='2'/><path d='M7 12h3M14 12h3'/>",
  documento: "<path d='M6 3h9l4 4v14H6z'/><path d='M14 3v5h5M9 13h7M9 17h7'/>",
  agora: "<path d='M7 4l13 8-13 8z'/>",
  imagem: "<rect x='3' y='4' width='18' height='16' rx='2'/><circle cx='9' cy='10' r='1.6'/><path d='M3 17l5-4 4 3 3-2 6 4'/>",
  caixa: "<path d='M3 8l9-5 9 5v8l-9 5-9-5z'/><path d='M3 8l9 5 9-5M12 13v8'/>",
  engrenagem: "<circle cx='12' cy='12' r='3'/><path d='M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1'/>",
  chat: "<path d='M4 5h16v11H9l-5 4z'/>",
};

const INICIO = '/* icones:inicio (gerado por nucleo/icones.mjs; não edite à mão) */';
const FIM = '/* icones:fim */';

const codificar = svg => svg.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/#/g, '%23');

/** CSS de todos os ícones: uma regra por nome, só a variável --ico muda. Nome desconhecido cai no ponto. */
export function cssIcones() {
  const regra = (seletor, corpo) => {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'>${corpo}</svg>`;
    return `${seletor}{--ico:url("data:image/svg+xml,${codificar(svg)}")}`;
  };
  const linhas = [regra('.mk-ico', ICONES.ponto), ...Object.entries(ICONES).map(([nome, corpo]) => regra(`.mk-i-${nome}`, corpo))];
  return [INICIO, ...linhas, FIM].join('\n');
}

/** Reescreve a seção de ícones dentro de tema-base.css. */
export function escreverIcones(arquivo) {
  const css = readFileSync(arquivo, 'utf8');
  const a = css.indexOf(INICIO), b = css.indexOf(FIM);
  if (a < 0 || b < 0) throw new Error(`marcadores de ícones não encontrados em ${arquivo}`);
  const novo = css.slice(0, a) + cssIcones() + css.slice(b + FIM.length);
  if (novo !== css) writeFileSync(arquivo, novo);
  return novo !== css;
}

export const SECAO_ICONES = { INICIO, FIM };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes('--escrever')) {
  const css = join(dirname(fileURLToPath(import.meta.url)), '..', 'tema-base.css');
  console.log(escreverIcones(css) ? 'tema-base.css: ícones atualizados' : 'tema-base.css: ícones já estavam em dia');
}

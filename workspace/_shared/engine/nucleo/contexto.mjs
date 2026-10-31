// Contexto entregue a cada módulo: ctx = { projeto, hoje, pasta, esc, dataLonga, pagina, ... }.
import { dirname, relative, isAbsolute, sep } from 'node:path';
import { esc, texto, urlRelativa, slug, plural } from './esc.mjs';
import { dataLonga, somarDias } from './datas.mjs';
import { lerJson } from './projeto.mjs';
import { renderizarPagina } from './pagina.mjs';
import * as ui from './componentes.mjs';

/**
 * Caminho relativo da pasta do card até _shared/. Num card dentro de workspace/ é "../_shared".
 * O motor fica em _shared/engine/, então _shared/ é a pasta acima de engineDir.
 */
export function caminhoShared(pasta, engineDir) {
  const rel = relative(pasta, dirname(engineDir)).split(sep).join('/');
  return !rel || isAbsolute(rel) ? '../_shared' : rel;
}

/**
 * Fábrica de contextos para um card. `carregar(nome)` lê <nome>.json uma vez (undefined se não existir)
 * e é compartilhado por todos os módulos, então o painel enxerga os mesmos dados que a aba de riscos.
 */
export function criarFabrica({ pasta, projeto, hoje, engineDir }) {
  const cache = new Map();
  const carregar = nome => {
    if (!cache.has(nome)) cache.set(nome, lerJson(pasta, `${nome}.json`));
    return cache.get(nome);
  };
  const shared = caminhoShared(pasta, engineDir);
  const contexto = ({ aba, modulo, fonte }) => {
    const ctx = {
      projeto, hoje, pasta, aba, modulo,
      esc, texto, dataLonga, somarDias, slug, plural, ui,
      carregar,
      shared,
      engine: `${shared}/engine`,
      janelaDias: projeto.janelaDias,
      custom: projeto.tema === 'custom',
      fonteArquivo: `${fonte}.json`,
    };
    ctx.pagina = opcoes => renderizarPagina(ctx, opcoes);
    return ctx;
  };
  return { carregar, contexto, shared };
}

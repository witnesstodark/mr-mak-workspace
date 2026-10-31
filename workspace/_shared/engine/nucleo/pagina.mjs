// pagina(): o HTML completo de uma aba, com o aviso de arquivo gerado, o CSS compartilhado e o tema.
import { esc, urlRelativa } from './esc.mjs';
import { dataLonga } from './datas.mjs';

const TEXTO_AVISO = 'Gerado — não edite à mão';

/**
 * Monta uma página. `ctx` traz projeto, hoje, shared (caminho relativo até _shared/), fonteArquivo e aba.
 * opcoes: titulo (h1), subtitulo (HTML já escapado), corpo (HTML), scripts (HTML de <script>, trecho de JS ou lista),
 *         eyebrow (linha acima do título; padrão: título do projeto), alto (capa alta), selo (chip na capa),
 *         documento (texto do <title>).
 */
export function renderizarPagina(ctx, opcoes) {
  const { projeto } = ctx;
  const { titulo, subtitulo = '', corpo = '', scripts = '', eyebrow, alto = false, selo, documento } = opcoes;
  const shared = ctx.shared;
  const custom = projeto.tema === 'custom';
  const cabecaDoc = documento ?? `${ctx.aba?.nome ?? titulo} · ${projeto.titulo}`;
  const fonte = ctx.fonteArquivo ? ` · fonte: ${ctx.fonteArquivo}` : '';
  const capa = projeto.capa ? `<div class="mk-capa-img" style="background-image:url('${esc(urlRelativa(projeto.capa))}')" aria-hidden="true"></div>` : '';
  const lista = (Array.isArray(scripts) ? scripts : [scripts]).filter(Boolean)
    .map(s => (s.trimStart().startsWith('<') ? s : `<script>\n${s}\n</script>`)).join('\n');
  return `<!-- ${TEXTO_AVISO}. Fonte: ${ctx.fonteArquivo ?? 'JSON do card'}. Para mudar, edite o JSON e rode: node workspace/_shared/engine/gerar.mjs <pasta-do-card> -->
<!doctype html>
<html lang="pt-BR" data-mak-report="document"${custom ? ' data-mak-theme="custom"' : ''} style="--mk-destaque:${esc(projeto.destaque)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(cabecaDoc)}</title>
  <link rel="stylesheet" href="${shared}/report.css">
  <link rel="stylesheet" href="${shared}/examples.css">
  <link rel="stylesheet" href="${shared}/engine/tema-base.css">${custom ? `\n  <link rel="stylesheet" href="${esc(urlRelativa(projeto.temaCss))}">` : ''}
  <script defer src="${shared}/report.js"></script>
</head>
<body><main class="container mk-pag">
<p class="mk-gerado">${TEXTO_AVISO}${esc(fonte)} · ${esc(dataLonga(ctx.hoje))}</p>
<div class="mk-capa${alto ? ' mk-alto' : ''}">${capa}
  <header class="mk-capa-texto">
    <p class="mk-eyebrow">${esc(eyebrow ?? projeto.titulo)}</p>
    <h1>${esc(titulo)}</h1>${subtitulo ? `\n    <p class="mk-sub">${subtitulo}</p>` : ''}${selo ? `\n    <span class="mk-selo">${selo}</span>` : ''}
  </header>
</div>
${corpo}
</main>
${lista}
</body>
</html>
`;
}

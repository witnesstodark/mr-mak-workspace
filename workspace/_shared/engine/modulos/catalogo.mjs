// Catálogo de conteúdo: grupos (um domínio/mod por seção), imagens e atributos
// atuais/propostos. Edições são exportadas como dados, nunca executadas como código.
// Fonte: catalogo.json { grupos: [{ id, nome, resumo, estado, imagem, itens: [{
//   id, nome, tipo, estado, imagem, imagemNota?, resumo?, origem?, campos: [{
//   id, rotulo, tipo: numero|texto|booleano, atual: value|null, unidade?, min?, max?, origem?
// }] }] }] }. O JSON original permanece a referência do estado implementado.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { esc } from '../nucleo/esc.mjs';
import { validarCatalogo } from '../catalogo-dados.mjs';

export function validar(dados, ctx) {
  const erros = validarCatalogo(dados);
  if (erros.length) return erros;
  for (const grupo of dados?.grupos ?? []) {
    for (const item of [grupo, ...(grupo.itens ?? [])]) {
      if (typeof item.imagem === 'string' && !existsSync(join(ctx.pasta, item.imagem))) erros.push(`imagem não encontrada: ${item.imagem}`);
    }
  }
  return erros;
}

export function gerar(dados, ctx) {
  const count = dados.grupos.reduce((n, g) => n + g.itens.length, 0);
  const nomesCategorias = { Criatura: 'Criaturas', Equipamento: 'Equipamentos', Item: 'Itens', Bloco: 'Blocos', 'Ovo gerador': 'Ovos geradores', Sistema: 'Sistemas' };
  const tipos = [...new Set(dados.grupos.flatMap(g => g.itens.map(i => i.tipo)))];
  const categorias = [...Object.keys(nomesCategorias).filter(t => tipos.includes(t)), ...tipos.filter(t => !nomesCategorias[t])];
  const field = (f, item) => {
    const attrs = `data-item="${esc(item.id)}" data-campo="${esc(f.id)}" aria-label="${esc(item.nome + ' — ' + f.rotulo)}"`;
    const input = f.tipo === 'booleano'
      ? `<select ${attrs}><option value="">Não definido</option><option value="true"${f.atual === true ? ' selected' : ''}>Sim</option><option value="false"${f.atual === false ? ' selected' : ''}>Não</option></select>`
      : f.tipo === 'texto'
        ? `<textarea ${attrs} rows="2" maxlength="4000" placeholder="Não definido">${esc(f.atual ?? '')}</textarea>`
        : `<input ${attrs} type="number" step="any"${f.min !== undefined ? ` min="${f.min}"` : ''}${f.max !== undefined ? ` max="${f.max}"` : ''} value="${esc(f.atual ?? '')}" placeholder="Não definido">`;
    const current = f.atual === null ? 'não definido' : typeof f.atual === 'boolean' ? f.atual ? 'sim' : 'não' : f.atual;
    return `<label class="cat-campo"><span>${esc(f.rotulo)}${f.unidade ? ` <small>${esc(f.unidade)}</small>` : ''}</span>${input}<small>Atual: ${esc(current)}</small></label>`;
  };
  const itemHTML = item => `<details class="cat-item" data-id="${esc(item.id)}" data-tipo="${esc(item.tipo)}" data-busca="${esc(`${item.nome} ${item.id} ${item.tipo} ${item.resumo ?? ''}`.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase())}">
      <summary class="cat-item-resumo"><span class="cat-item-miniatura" style="background-image:url('${esc(item.imagem)}')" aria-hidden="true"></span><span class="cat-item-titulo"><b>${esc(item.nome)}</b><small>${esc(item.estado)}</small><code>${esc(item.id)}</code></span></summary>
      <div class="cat-item-detalhes"><div class="cat-imagem"><img src="${esc(item.imagem)}" alt="${esc(item.nome)}" loading="lazy"></div>
      <div class="cat-item-corpo">${item.imagemNota ? `<p class="cat-imagem-nota">${esc(item.imagemNota)}</p>` : ''}${item.resumo ? `<p>${ctx.texto(item.resumo)}</p>` : ''}
      <details class="cat-atributos" open><summary>Atributos <span>${item.campos.length}</span></summary><div class="cat-campos">${item.campos.map(f => field(f, item)).join('')}</div></details>
      ${item.origem ? `<details class="cat-origem"><summary>Fonte e aplicação</summary><p>${esc(item.origem)}</p><p>Alterar aqui propõe valores; a aplicação no mod exige implementação, compilação e validação.</p></details>` : ''}</div></div>
    </details>`;
  const groups = dados.grupos.map(g => `<details class="cat-grupo" data-grupo="${esc(g.id)}" data-nome="${esc(g.nome.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase())}">
    <summary><span class="cat-mod-miniatura" style="background-image:url('${esc(g.imagem)}')" aria-hidden="true"></span><span><b>${esc(g.nome)}</b><small>${esc(g.estado)} · <span class="cat-grupo-contagem">${g.itens.length} registros</span></small></span></summary>
    <div class="cat-intro"><p>${ctx.texto(g.resumo)}</p></div>
    <div class="cat-categorias">${categorias.filter(t => g.itens.some(i => i.tipo === t)).map(t => {
      const itens = g.itens.filter(i => i.tipo === t);
      return `<details class="cat-categoria" data-tipo="${esc(t)}"><summary><b>${esc(nomesCategorias[t] ?? t)}</b><span class="cat-categoria-contagem">${itens.length} registros</span></summary><div class="cat-itens">${itens.map(itemHTML).join('')}</div></details>`;
    }).join('')}</div></details>`).join('');
  const data = JSON.stringify({ projeto: ctx.projeto.id, ...dados }).replace(/</g, '\\u003c');
  return ctx.pagina({ titulo: ctx.aba.nome, subtitulo: `${dados.grupos.length} categorias exclusivas · ${count} criaturas, itens e sistemas · ajuste, exporte e replique no mod.`,
    corpo: `<link rel="stylesheet" href="${ctx.engine}/catalogo.css">
      <section class="cat-toolbar" aria-label="Controles do catálogo"><label>Pesquisar<input type="search" id="cat-busca" placeholder="Nome, ID, mod ou descrição"></label><label>Mod<select id="cat-mod"><option value="">Todos os mods</option>${dados.grupos.map(g => `<option value="${esc(g.id)}">${esc(g.nome)}</option>`).join('')}</select></label><label>Categoria<select id="cat-tipo"><option value="">Todas as categorias</option>${categorias.map(t => `<option value="${esc(t)}">${esc(nomesCategorias[t] ?? t)}</option>`).join('')}</select></label><button id="cat-limpar">Limpar filtros</button><button id="cat-expandir">Abrir categorias</button></section>
      <p id="cat-resultados" role="status" aria-live="polite">${count} registros em ${dados.grupos.length} mods.</p>
      <section class="cat-edicao"><p>Edite os atributos para propor mudanças. <b>Atual</b> é o valor coletado do código; campos vazios ainda não foram definidos. O rascunho é recuperado neste navegador, mas só o arquivo exportado serve para entregar os ajustes.</p>
      <div class="cat-acoes"><button id="cat-exportar">Exportar ajustes</button><label class="cat-importar">Importar ajustes<input id="cat-importar" type="file" accept="application/json,.json"></label><button id="cat-redefinir">Descartar rascunho</button><button id="cat-recuperar" hidden>Recuperar rascunho anterior</button></div><p id="cat-status" role="status" aria-live="polite">Nenhuma alteração proposta.</p></section>
      <div id="cat-grupos">${groups}</div><script id="cat-dados" type="application/json">${data}</script>`,
    scripts: `<script type="module" src="${ctx.engine}/catalogo.js"></script>` });
}

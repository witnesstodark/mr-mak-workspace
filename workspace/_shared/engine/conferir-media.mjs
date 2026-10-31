#!/usr/bin/env node
// Confere a pasta media/ de um card: nomes fora do padrão, arquivos acima do limite, referências quebradas e órfãos.
//
// Uso: node conferir-media.mjs <pasta-do-card> [--limpar] [--confirmar] [--destino <pasta>] [--json]
//   (sem opções)        só relata; sai com código 1 se achar algum problema
//   --limpar            lista os órfãos que seriam movidos (simulação)
//   --limpar --confirmar  move os órfãos para E:\Backups\Workspace\<id do projeto>\, preservando as subpastas
//   --destino <pasta>   outra pasta de backup no lugar de E:\Backups\Workspace\<id>
//   --json              resultado em JSON
//
// Referência = caminho "media/..." escrito em algum JSON da raiz do card (acervo.json, entregas.json...), no CSS do
// tema (projeto.json › temaCss e outros .css da raiz) ou numa página escrita à mão (HTML da raiz sem o aviso de
// "Gerado — não edite à mão"). As páginas geradas não contam: elas só repetem o que os JSON dizem.
// Padrão de nome (só para o que o acervo.json usa): media/<categoria>/<familia>/<item>-vNN[-vista].<ext>.
// Limites: imagem de miniatura até 150 KB e GLB até 3 MB. Capa, ícones de tema e páginas livres ficam sem limite.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, statSync, copyFileSync, unlinkSync } from 'node:fs';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arquivosDoItem, padraoNome, descricaoPadrao, categoriasDoProjeto, LIMITE_MINIATURA, LIMITE_MODELO } from './modulos/acervo.mjs';

const MARCA_GERADA = /Gerado\s+—\s+não edite à mão/;
const IMAGENS = ['webp', 'png', 'jpg', 'jpeg', 'gif', 'avif'];
export const DESTINO_PADRAO = (id) => `E:\\Backups\\Workspace\\${id}`;

const lerJson = (arquivo) => JSON.parse(readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, ''));
const extensao = (rel) => rel.split('.').pop().toLowerCase();
const kb = (bytes) => `${Math.ceil(bytes / 1024)} KB`;
const mb = (bytes) => `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB`;

function listar(pastaMedia, base) {
  const saida = [];
  const andar = (dir) => {
    for (const nome of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, nome.name);
      if (nome.isDirectory()) andar(abs);
      else if (nome.isFile()) saida.push({ rel: posix.join(...abs.slice(base.length + 1).split(sep)), tamanho: statSync(abs).size });
    }
  };
  if (existsSync(pastaMedia)) andar(pastaMedia);
  return saida.sort((a, b) => a.rel.localeCompare(b.rel));
}

function referenciasDeJson(valor, fonte, saida, caminho = '') {
  if (typeof valor === 'string') {
    const v = valor.replace(/^\.\//, '');
    if (/^media\/[^\n]+\.[a-z0-9]+$/i.test(v) && !/\s{2,}/.test(v)) saida.push({ rel: v, fonte, onde: caminho });
  } else if (Array.isArray(valor)) valor.forEach((x, i) => referenciasDeJson(x, fonte, saida, `${caminho}[${i}]`));
  else if (valor && typeof valor === 'object') for (const [k, x] of Object.entries(valor)) referenciasDeJson(x, fonte, saida, caminho ? `${caminho}.${k}` : k);
}

function referenciasDeTexto(texto, fonte, saida, dirRel = '') {
  for (const m of texto.matchAll(/(?:\.\.?\/)*media\/[^\s"'()<>]+/g)) {
    let rel = m[0];
    try { rel = decodeURIComponent(rel); } catch { /* mantém o texto cru */ }
    rel = rel.replace(/[?#].*$/, '');
    saida.push({ rel: posix.normalize(posix.join(dirRel, rel)), fonte, onde: 'texto' });
  }
}

/**
 * Confere o card. Opções: limpar, confirmar, destino. Devolve o resultado estruturado (não imprime nem encerra).
 */
export function conferir(pastaCard, { limpar = false, confirmar = false, destino } = {}) {
  const pasta = resolve(pastaCard);
  const arquivoProjeto = join(pasta, 'projeto.json');
  if (!existsSync(arquivoProjeto)) throw new Error(`não achei projeto.json em ${pasta}`);
  const projeto = lerJson(arquivoProjeto);
  const arquivos = listar(join(pasta, 'media'), pasta);
  const existentes = new Map(arquivos.map((a) => [a.rel, a.tamanho]));

  // ---- referências ----
  const refs = [];
  const raiz = readdirSync(pasta, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
  for (const nome of raiz) {
    const ext = extensao(nome);
    if (ext === 'json') {
      try { referenciasDeJson(lerJson(join(pasta, nome)), nome, refs); } catch (e) { throw new Error(`${nome}: JSON inválido (${e.message})`); }
    } else if (ext === 'css') {
      referenciasDeTexto(readFileSync(join(pasta, nome), 'utf8'), nome, refs);
    } else if (ext === 'html') {
      const texto = readFileSync(join(pasta, nome), 'utf8');
      if (!MARCA_GERADA.test(texto)) referenciasDeTexto(texto, nome, refs);
    }
  }
  if (typeof projeto.temaCss === 'string' && projeto.temaCss.includes('/')) {
    const css = join(pasta, projeto.temaCss);
    if (existsSync(css)) referenciasDeTexto(readFileSync(css, 'utf8'), projeto.temaCss, refs, posix.dirname(projeto.temaCss.replace(/\\/g, '/')));
  }
  const porArquivo = new Map();
  for (const r of refs) {
    if (!porArquivo.has(r.rel)) porArquivo.set(r.rel, []);
    porArquivo.get(r.rel).push(r);
  }

  // ---- nomes (só o que o acervo.json usa) ----
  const foraDoPadrao = [];
  const acervo = existsSync(join(pasta, 'acervo.json')) ? lerJson(join(pasta, 'acervo.json')) : undefined;
  const idsCategoria = categoriasDoProjeto(projeto).map((c) => c.id);
  const noAcervo = new Set();
  // Item com prompt (foi gerado) que não registrou o job. Os itens antigos ficam assim; os novos não deveriam.
  const semRegistro = [];
  for (const item of Array.isArray(acervo?.itens) ? acervo.itens : []) {
    if (!item || typeof item !== 'object' || !item.id || !Number.isInteger(item.versao)) continue;
    if (item.prompt && !item.geracao && item.status !== 'descartada') semRegistro.push({ item: item.id, versao: item.versao });
    for (const f of arquivosDoItem(item)) {
      noAcervo.add(f.caminho);
      if (!padraoNome(item, f.versao, f.exts).test(f.caminho)) foraDoPadrao.push({ rel: f.caminho, item: item.id, papel: f.papel, esperado: descricaoPadrao(item, f) });
      else if (!idsCategoria.includes(item.categoria)) foraDoPadrao.push({ rel: f.caminho, item: item.id, papel: f.papel, esperado: `categoria "${item.categoria}" não existe (comuns: ${idsCategoria.join(', ')})` });
    }
  }

  // ---- limites, referências quebradas e órfãos ----
  const acimaDoLimite = [];
  const quebradas = [];
  for (const [rel, lista] of porArquivo) {
    if (!existentes.has(rel)) {
      for (const r of lista) quebradas.push({ rel, fonte: r.fonte, onde: r.onde });
      continue;
    }
    const livre = lista.every((r) => r.fonte === 'projeto.json' || /\.(css|html)$/.test(r.fonte));
    if (livre) continue;
    const tamanho = existentes.get(rel);
    const ext = extensao(rel);
    if (IMAGENS.includes(ext) && tamanho > LIMITE_MINIATURA) acimaDoLimite.push({ rel, tamanho, limite: LIMITE_MINIATURA });
    if (ext === 'glb' && tamanho > LIMITE_MODELO) acimaDoLimite.push({ rel, tamanho, limite: LIMITE_MODELO });
  }
  const orfaos = arquivos.filter((a) => !porArquivo.has(a.rel));

  // ---- limpeza ----
  const base = destino ? resolve(destino) : DESTINO_PADRAO(projeto.id);
  const limpeza = { ativa: Boolean(limpar), confirmada: Boolean(limpar && confirmar), destino: base, aMover: [], movidos: [], pulados: [] };
  if (limpar) {
    for (const o of orfaos) limpeza.aMover.push({ de: o.rel, para: join(base, ...o.rel.split('/')), tamanho: o.tamanho });
    if (confirmar) {
      for (const m of limpeza.aMover) {
        if (existsSync(m.para)) { limpeza.pulados.push({ ...m, motivo: 'já existe no destino; não sobrescrevi' }); continue; }
        mkdirSync(dirname(m.para), { recursive: true });
        const origem = join(pasta, ...m.de.split('/'));
        try { renameSync(origem, m.para); } catch (e) {
          if (!['EXDEV', 'EPERM', 'EACCES'].includes(e.code)) throw e;
          copyFileSync(origem, m.para);
          unlinkSync(origem);
        }
        limpeza.movidos.push(m);
      }
      podarVazias(join(pasta, 'media'));
    }
  }
  return {
    pasta, projeto: projeto.id, totalArquivos: arquivos.length, totalBytes: arquivos.reduce((a, f) => a + f.tamanho, 0),
    foraDoPadrao, acimaDoLimite, quebradas, orfaos, limpeza, semRegistro,
    problemas: foraDoPadrao.length + acimaDoLimite.length + quebradas.length + (limpeza.confirmada ? limpeza.pulados.length : orfaos.length),
  };
}

function podarVazias(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) podarVazias(join(dir, e.name));
  if (dir.endsWith(`${sep}media`)) return;
  if (!readdirSync(dir).length) rmdirSync(dir);
}

/** Texto do relatório, em português. */
export function relatorio(r) {
  const L = [];
  const secao = (titulo, linhas) => { if (linhas.length) { L.push('', titulo, ...linhas.map((l) => `  ${l}`)); } };
  L.push(`Mídia de ${r.pasta}`);
  L.push(`${r.totalArquivos} arquivos em media/, ${mb(r.totalBytes)}.`);
  secao(`Nome fora do padrão (${r.foraDoPadrao.length}):`, r.foraDoPadrao.map((x) => `${x.rel}  [${x.item}, ${x.papel}]  esperado: ${x.esperado}`));
  secao(`Acima do limite (${r.acimaDoLimite.length}):`, r.acimaDoLimite.map((x) => `${x.rel}  ${kb(x.tamanho)} (limite ${kb(x.limite)})`));
  secao(`Referência quebrada (${r.quebradas.length}):`, r.quebradas.map((x) => `${x.rel}  citado em ${x.fonte}${x.onde && x.onde !== 'texto' ? ' › ' + x.onde : ''}`));
  secao(`Gerado sem registro de geração (${r.semRegistro.length}): tem prompt mas não tem "geracao" (provedor e job)`, r.semRegistro.map((x) => `${x.item} v${String(x.versao).padStart(2, '0')}`));
  const total = r.orfaos.reduce((a, o) => a + o.tamanho, 0);
  const porPasta = new Map();
  for (const o of r.orfaos) {
    const chave = o.rel.split('/').slice(0, o.rel.split('/').length > 2 ? 2 : 1).join('/');
    const g = porPasta.get(chave) ?? { n: 0, bytes: 0 };
    g.n++; g.bytes += o.tamanho; porPasta.set(chave, g);
  }
  secao(`Órfãos (${r.orfaos.length}, ${mb(total)}): nenhum JSON, CSS ou página do card os usa`, [...porPasta].map(([k, g]) => `${k}/  ${g.n} arquivo${g.n === 1 ? '' : 's'}, ${mb(g.bytes)}`));
  const l = r.limpeza;
  if (l.ativa && !l.confirmada) {
    L.push('', `Simulação: ${l.aMover.length} arquivo${l.aMover.length === 1 ? '' : 's'} iria${l.aMover.length === 1 ? '' : 'm'} para ${l.destino} (subpastas preservadas).`, '  Nada foi movido. Para mover de verdade: --limpar --confirmar');
  } else if (l.confirmada) {
    L.push('', `Movidos ${l.movidos.length} arquivo${l.movidos.length === 1 ? '' : 's'} para ${l.destino}.`);
    for (const p of l.pulados) L.push(`  PULADO ${p.de}: ${p.motivo}`);
  } else if (r.orfaos.length) {
    L.push('', `Para ver o que iria para o backup: --limpar (simulação) e depois --limpar --confirmar. Destino padrão: ${l.destino}`);
  }
  L.push('', r.problemas ? `Resultado: ${r.problemas} problema${r.problemas === 1 ? '' : 's'}.` : 'Resultado: tudo em ordem.');
  return L.join('\n');
}

export function lerArgumentos(argv) {
  const op = { pasta: undefined, limpar: false, confirmar: false, json: false, destino: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limpar') op.limpar = true;
    else if (a === '--confirmar') op.confirmar = true;
    else if (a === '--json') op.json = true;
    else if (a === '--destino') op.destino = argv[++i];
    else if (a === '--ajuda' || a === '-h') op.ajuda = true;
    else if (a.startsWith('--')) throw new Error(`opção desconhecida: ${a}`);
    else if (!op.pasta) op.pasta = a;
    else throw new Error(`argumento a mais: ${a}`);
  }
  if (op.destino === undefined && argv.includes('--destino')) throw new Error('--destino pede uma pasta');
  if (op.confirmar && !op.limpar) throw new Error('--confirmar só vale junto com --limpar');
  return op;
}

const AJUDA = 'Uso: node conferir-media.mjs <pasta-do-card> [--limpar] [--confirmar] [--destino <pasta>] [--json]';

export function main(argv, { saida = (t) => console.log(t) } = {}) {
  let op;
  try { op = lerArgumentos(argv); } catch (e) { saida(`${e.message}\n${AJUDA}`); return 2; }
  if (op.ajuda || !op.pasta) { saida(AJUDA); return op.ajuda ? 0 : 2; }
  let r;
  try { r = conferir(op.pasta, op); } catch (e) { saida(`Erro: ${e.message}`); return 2; }
  saida(op.json ? JSON.stringify(r, null, 2) : relatorio(r));
  return r.problemas ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));

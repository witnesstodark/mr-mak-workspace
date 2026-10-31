// Peças comuns dos coletores de projetos de fora (Lightkeeper, Ritualistic): git, miniaturas e mescla com o JSON anterior.
//
// Regra da mescla: o coletor só semeia o texto de um item novo. Quando o id já existe no JSON anterior,
// os campos de texto (`titulo`, `resumo`, `olhar`, `nota`...) ficam como estão, porque o agente os reescreve
// à mão (em português, mais curtos). O resto (estado, datas, refs, mídia) é sempre recalculado.
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const SEP_COMMIT = '\u001e';
const SEP_CAMPO = '\u001f';

/** Commits do mais novo para o mais antigo: { hash, curto, data (AAAA-MM-DD, autor), assunto, corpo, pais[] }. */
export function lerCommits(repo, rev = 'HEAD') {
  const saida = execFileSync('git', ['-C', repo, 'log', rev, '--date=short', `--format=${SEP_COMMIT}%H${SEP_CAMPO}%h${SEP_CAMPO}%ad${SEP_CAMPO}%P${SEP_CAMPO}%s${SEP_CAMPO}%b`],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return saida.split(SEP_COMMIT).filter(s => s.trim()).map(bloco => {
    const [hash, curto, data, pais, assunto, corpo] = bloco.split(SEP_CAMPO);
    return { hash, curto, data, pais: pais.trim().split(' ').filter(Boolean), assunto: assunto.trim(), corpo: (corpo ?? '').trim() };
  });
}

/** Assuntos dos commits que um merge trouxe (pai 1..pai 2), do mais antigo para o mais novo. */
export function commitsDoMerge(repo, merge) {
  if (merge.pais.length < 2) return [];
  return lerCommits(repo, `${merge.pais[0]}..${merge.pais[1]}`).filter(c => c.pais.length < 2).reverse();
}

/**
 * PRs que chegaram na branch: merge commit ("Merge pull request #N from ...", título do PR na 1ª linha do corpo)
 * ou squash ("título (#N)"). Devolve [{ pr, data, titulo, curto, commits[] }] do mais antigo para o mais novo.
 */
export function prsMesclados(repo, commits = lerCommits(repo)) {
  const prs = [];
  for (const c of commits) {
    const merge = /^Merge pull request #(\d+) from /.exec(c.assunto);
    const squash = /\(#(\d+)\)$/.exec(c.assunto);
    if (merge) {
      const doMerge = commitsDoMerge(repo, c);
      const titulo = c.corpo.split('\n')[0].trim() || doMerge.at(-1)?.assunto || `PR #${merge[1]}`;
      prs.push({ pr: Number(merge[1]), data: c.data, titulo, curto: c.curto, commits: doMerge.map(x => x.assunto) });
    } else if (squash && c.pais.length < 2) {
      prs.push({ pr: Number(squash[1]), data: c.data, titulo: c.assunto.replace(/\s*\(#\d+\)$/, ''), curto: c.curto, commits: [] });
    }
  }
  return prs.sort((a, b) => a.pr - b.pr);
}

/** Corta um texto no limite, terminando em palavra inteira com reticências. */
export function cortar(texto, max) {
  const t = String(texto).replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).replace(/\s+\S*$/, '').replace(/[,;:.\s]+$/, '') + '…';
}

export function lerJsonSeExiste(arquivo) {
  return existsSync(arquivo) ? JSON.parse(readFileSync(arquivo, 'utf8').replace(/^﻿/, '')) : null;
}

export function salvarJson(arquivo, dados) {
  mkdirSync(dirname(arquivo), { recursive: true });
  writeFileSync(arquivo, JSON.stringify(dados, null, 2) + '\n');
}

/** Copia para cada item novo os campos de texto do item de mesmo id no JSON anterior (ver a regra no topo). */
export function preservarTextos(novos, anteriores, campos) {
  const porId = new Map((anteriores ?? []).map(a => [a.id, a]));
  return novos.map(n => {
    const a = porId.get(n.id);
    if (!a) return n;
    const r = { ...n };
    for (const c of campos) if (a[c] !== undefined) r[c] = a[c];
    return r;
  });
}

/**
 * Gera miniaturas WebP com Pillow (`py`), só das que faltam ou estão mais velhas que a origem.
 * pedidos: [{ de: caminho absoluto, para: caminho absoluto, largura }]. Devolve quantas gerou.
 */
export function gerarMiniaturas(pedidos, { qualidade = 78 } = {}) {
  const faltam = pedidos.filter(p => !existsSync(p.para) || statSync(p.para).mtimeMs < statSync(p.de).mtimeMs);
  if (!faltam.length) return 0;
  for (const p of faltam) mkdirSync(dirname(p.para), { recursive: true });
  const py = [
    'import sys, json',
    'from PIL import Image',
    'for p in json.load(sys.stdin):',
    '    im = Image.open(p["de"]).convert("RGB")',
    '    if im.width > p["largura"]: im = im.resize((p["largura"], round(im.height * p["largura"] / im.width)), Image.LANCZOS)',
    `    im.save(p["para"], "WEBP", quality=${qualidade}, method=6)`,
  ].join('\n');
  execFileSync('py', ['-I', '-c', py], { input: JSON.stringify(faltam), stdio: ['pipe', 'inherit', 'inherit'] });
  return faltam.length;
}

/** "AAAA-MM-DD" de hoje, no fuso local. */
export function hojeLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

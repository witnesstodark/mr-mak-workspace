#!/usr/bin/env node
// Coletor do card Ritualistic: lê o repositório do jogo e escreve roteiro, entregas, playtest, decisões e pipeline.
//
// Uso: node workspace/_shared/engine/coletores/ritualistic.mjs <repositório> <pasta-do-card>
//
// Fontes no repositório:
//   Docs/Plan.md               "### Fase N — título" (+ bullets) e a tabela "Decisões técnicas" (| Tema | Decisão |)
//   tags slice-f*              fase feita quando a mensagem da tag diz "Phase N" ou "Phases N and M"
//   git log                    entregas: uma por fase com tag e, depois da última tag, uma por dia;
//                              achados PT-nnn (um achado por commit que os cita; citado = corrigido);
//                              decisões DD-nnn ("DD-011: texto" ou "PT-059 (DD-007): texto")
//   Docs/Progress/F<N>/*.png   miniaturas da entrega da fase N
//   Art/, Unreal/.../Content   pipeline por asset (conceito → Meshy → Blender → Unreal), conferida pela existência de arquivos
// Painel e projeto.json são escritos à mão. Textos já presentes no card são preservados (coletores/comum.mjs):
// os commits são em inglês, e o agente reescreve títulos e resumos em português uma vez.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { lerCommits, cortar, lerJsonSeExiste, salvarJson, preservarTextos, gerarMiniaturas } from './comum.mjs';
import { comprimirCodigos } from '../modulos/decisoes.mjs';

const CONTENT = 'Unreal/Ritualistic/Content/Ritualistic';
// Nomes em português dos assets do pipeline (as pastas do repositório são em inglês ou sem acento).
const NOMES = {
  Aco: 'Aço', Bear: 'Urso', Boar: 'Javali', Deer: 'Cervo', Fox: 'Raposa', Nokken: 'Nøkken', Ram: 'Carneiro',
  SluaghCrow: 'Corvo do Sluagh', Wolf: 'Lobo',
};
const dataBr = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const temArquivos = (dir, re = /./) => existsSync(dir) && statSync(dir).isDirectory() && readdirSync(dir, { recursive: true }).map(String).some(f => re.test(f));

// ---------- Plano e tags ----------
function lerPlano(repo) {
  const md = readFileSync(join(repo, 'Docs', 'Plan.md'), 'utf8');
  const fases = [];
  for (const m of md.matchAll(/^### Fase (\d+) — (.+)\n([\s\S]*?)(?=^#{2,3} |^---)/gm)) {
    fases.push({ n: Number(m[1]), titulo: m[2].trim(), bullets: m[3].split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim()) });
  }
  if (!fases.length) throw new Error('Docs/Plan.md: nenhuma "### Fase N — título"');
  const decisoes = [];
  const sec = md.split(/^## Decisões técnicas/m)[1]?.split(/^## /m)[0] ?? '';
  for (const l of sec.split('\n')) {
    const c = l.trim().replace(/^\||\|$/g, '').split('|').map(x => x.trim());
    if (l.trim().startsWith('|') && c.length >= 2 && !/^-+$/.test(c[0]) && c[0] !== 'Tema') decisoes.push({ tema: c[0], decisao: c[1] });
  }
  return { fases, decisoes };
}

function lerTags(repo) {
  const saida = execFileSync('git', ['-C', repo, 'for-each-ref', 'refs/tags/slice-*', '--format=%(refname:short)\u001f%(contents:subject)\u001f%(*objectname)\u001f%(objectname)'], { encoding: 'utf8' });
  return saida.split('\n').filter(Boolean).map(l => {
    const [tag, msg, alvoAnotada, objeto] = l.split('\u001f');
    const alvo = alvoAnotada || objeto; // tag anotada aponta para o objeto da tag; o commit vem de *objectname
    const m = /Phases? (\d+)(?: and (\d+))?/.exec(msg);
    return { tag, msg, alvo, fases: m ? [Number(m[1]), ...(m[2] ? [Number(m[2])] : [])] : [] };
  });
}

// ---------- Roteiro ----------
function roteiro(plano, tags) {
  const feitas = new Set(tags.flatMap(t => t.fases));
  const atual = plano.fases.find(f => !feitas.has(f.n));
  return {
    sobre: 'Gerado por coletores/ritualistic.mjs. Fases de Docs/Plan.md; uma fase está feita quando uma tag slice-f* a cita. A fase 12 (assets, áudio e atmosfera) corre em paralelo e fica como atual enquanto não tiver tag; o detalhe dela está na aba Pipeline.',
    unidade: 'fases',
    fases: plano.fases.map(f => ({
      id: `F${f.n}`, nome: `Fase ${f.n} · ${f.titulo.replace(/\s*\(.*\)$/, '')}`,
      estado: feitas.has(f.n) ? 'feita' : f === atual ? 'atual' : 'futura',
      descricao: cortar(f.bullets.join('; '), 400),
    })),
  };
}

// ---------- Entregas ----------
function entregas(repo, card, plano, tags, commits, anteriores) {
  const pedidos = [];
  const porHash = new Map(commits.map(c => [c.hash, c]));
  const lista = [];
  for (const f of plano.fases) {
    const tag = tags.find(t => t.fases.includes(f.n) && t.fases[0] === f.n) ?? tags.find(t => t.fases.includes(f.n));
    if (!tag) continue;
    const c = porHash.get(tag.alvo);
    const e = {
      id: `fase-${f.n}`, data: c?.data ?? '2026-10-03', area: 'fatia', titulo: `Fase ${f.n} · ${f.titulo.replace(/\s*\(.*\)$/, '')}`,
      resumo: cortar(f.bullets.join('; '), 280), estado: 'main', refs: [tag.tag, ...(c ? [c.curto] : [])],
    };
    const prog = join(repo, 'Docs', 'Progress', `F${f.n}`);
    if (existsSync(prog)) {
      const pngs = readdirSync(prog).filter(x => /\.png$/i.test(x)).sort().slice(0, 3);
      e.miniaturas = pngs.map(p => {
        const rel = `media/progresso/f${f.n}/${p.replace(/\.png$/i, '').replace(/^RitSmoke_/, '').toLowerCase().replace(/_/g, '-')}.webp`;
        pedidos.push({ de: join(prog, p), para: join(card, rel), largura: 480 });
        return { arquivo: rel, legenda: p.replace(/\.png$/i, '').replace(/^RitSmoke_/, '').replace(/_/g, ' ') };
      });
    }
    if (!lista.some(x => x.id === e.id)) lista.push(e);
  }
  // Commits que nenhuma tag slice-* alcança: uma entrega por dia.
  const depois = execFileSync('git', ['-C', repo, 'rev-list', 'HEAD', '--not', ...tags.map(t => t.alvo)], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const novos = new Set(depois);
  const porDia = new Map();
  for (const c of commits) if (novos.has(c.hash)) { if (!porDia.has(c.data)) porDia.set(c.data, []); porDia.get(c.data).push(c); }
  for (const [dia, cs] of [...porDia].sort()) {
    const pts = codigos(cs.map(c => `${c.assunto}\n${c.corpo}`).join('\n'), 'PT');
    lista.push({
      id: `dia-${dia}`, data: dia, area: 'polimento', titulo: `Trabalho de ${dataBr(dia)}: ${cs.length} commits`,
      resumo: cortar(cs.slice().reverse().map(c => c.assunto).join('; '), 280), estado: 'main',
      refs: [`${cs.at(-1).curto}..${cs[0].curto}`, ...(pts.length ? [comprimirCodigos(pts)] : [])],
    });
  }
  return {
    pedidos,
    dados: { sobre: 'Gerado por coletores/ritualistic.mjs: uma entrega por fase com tag e, depois da última tag, uma por dia de commits. Títulos, resumos e "olhar" escritos à mão (em português) ficam preservados.', entregas: preservarTextos(lista, anteriores?.entregas, ['titulo', 'resumo', 'olhar']) },
  };
}

/** Todos os códigos PREFIXO-nnn de um texto, com os intervalos expandidos ("PT-110 to PT-120", "PT-096..098", "PT-054/055"). */
export function codigos(texto, prefixo) {
  const achados = new Set();
  const largura = 3;
  const cod = n => `${prefixo}-${String(n).padStart(largura, '0')}`;
  const re = new RegExp(`${prefixo}-(\\d+)(?:\\s*(?:to|\\.\\.|–|-|\\/)\\s*(?:${prefixo}-)?(\\d+))?`, 'g');
  for (const m of texto.matchAll(re)) {
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (b >= a && b - a < 60) for (let n = a; n <= b; n++) achados.add(cod(n));
    else achados.add(cod(a));
  }
  return [...achados].sort();
}

// ---------- Playtest ----------
function playtest(commits, anteriores) {
  const porDia = new Map();
  for (const c of commits.slice().reverse()) {
    const texto = `${c.assunto}\n${c.corpo}`;
    const pts = codigos(texto, 'PT');
    if (!pts.length) continue;
    if (!porDia.has(c.data)) porDia.set(c.data, []);
    const lista = porDia.get(c.data);
    let id = comprimirCodigos(pts);
    for (let k = 2; lista.some(a => a.id === id); k++) id = `${comprimirCodigos(pts)} (${k})`;
    lista.push({
      id, tipo: /checklist/i.test(c.assunto) ? 'checklist' : 'correção', titulo: cortar(c.assunto, 200), estado: 'corrigido',
      nota: `Commit ${c.curto}; ${pts.length === 1 ? '1 achado' : `${pts.length} achados`}.`,
    });
  }
  const dias = [...porDia.keys()].sort();
  const total = new Set(commits.flatMap(c => codigos(`${c.assunto}\n${c.corpo}`, 'PT'))).size;
  return {
    sobre: `Gerado por coletores/ritualistic.mjs a partir dos commits: ${total} códigos PT distintos (intervalos expandidos), um achado por commit que os cita; citado num commit = corrigido. Achados novos vão para docs/playtests/ no repositório. A iteração mais recente fica aberta.`,
    iteracoes: dias.map(d => {
      const ant = anteriores?.iteracoes?.find(i => i.id === `pt-${d}`);
      return {
        id: `pt-${d}`, nome: `Playtest de ${dataBr(d)}`, aberta: ant?.aberta ?? d === dias.at(-1),
        achados: preservarTextos(porDia.get(d), ant?.achados, ['titulo', 'tipo']),
      };
    }),
  };
}

// ---------- Decisões ----------
/** Junta as linhas quebradas da mensagem: um bloco começa numa linha em branco, num "- " ou num código PT-/DD-. */
function blocos(texto) {
  const saida = [];
  for (const linha of texto.split('\n')) {
    const t = linha.trim();
    if (!t) { saida.push(''); continue; }
    if (!saida.length || saida.at(-1) === '' || /^(- |(PT|DD)-\d)/.test(t)) saida.push(t.replace(/^- /, ''));
    else saida[saida.length - 1] += ` ${t}`;
  }
  return saida.filter(Boolean);
}

function decisoes(plano, commits, anteriores) {
  const dd = new Map();
  for (const c of commits.slice().reverse()) {
    for (const linha of blocos(`${c.assunto}\n\n${c.corpo}`)) {
      for (const m of linha.matchAll(/DD-(\d+)\)?:\s*(.+)$/g)) {
        const id = `DD-${m[1].padStart(3, '0')}`;
        if (!dd.has(id)) dd.set(id, { id, titulo: cortar(m[2], 240), estado: 'Confirmada', data: c.data, nota: `Commit ${c.curto}.` });
      }
    }
  }
  for (const c of commits.slice().reverse()) {
    for (const id of codigos(c.assunto, 'DD')) {
      if (!dd.has(id)) dd.set(id, { id, titulo: cortar(c.assunto, 240), estado: 'Confirmada', data: c.data, nota: `Commit ${c.curto} (o texto é o do commit).` });
    }
  }
  const temas = [
    { nome: 'Técnicas (Docs/Plan.md)', decisoes: plano.decisoes.map((d, i) => ({ id: `TC${i + 1}`, titulo: `${d.tema}: ${d.decisao}`, estado: 'Confirmada', data: '2026-10-03' })) },
    { nome: 'Design (DD nos commits)', decisoes: [...dd.values()].sort((a, b) => a.id.localeCompare(b.id)) },
  ].filter(t => t.decisoes.length);
  for (const t of temas) t.decisoes = preservarTextos(t.decisoes, anteriores?.temas?.find(x => x.nome === t.nome)?.decisoes, ['titulo', 'nota']);
  return {
    sobre: 'Gerado por coletores/ritualistic.mjs. O repositório não tem registro de decisões: entram a tabela "Decisões técnicas" do Plan.md e os códigos DD-nnn citados nos commits (a linha do tempo completa fica na galeria externa citada no README).',
    fonte: 'Docs/Plan.md e git log do repositório Ritualistic.',
    ...(anteriores?.espera ? { espera: anteriores.espera } : {}),
    ...(anteriores?.notas ? { notas: anteriores.notas } : {}),
    temas,
  };
}

// ---------- Pipeline ----------
function pipeline(repo) {
  const art = (...p) => join(repo, 'Art', ...p);
  const ue = (...p) => join(repo, CONTENT, ...p);
  const est = ok => (ok ? 'feito' : 'pendente');
  const assets = [];
  const armaduras = art('Models', 'Armor');
  const pastas = existsSync(armaduras) ? readdirSync(armaduras).filter(d => /^Pilot_T\d/.test(d)).sort() : [];
  // Uma versão substituída (Pilot_T5_Aco quando existe Pilot_T5_Aco_v2) sai da tabela.
  for (const dir of pastas.filter(d => !pastas.includes(`${d}_v2`))) {
    const base = join(armaduras, dir);
    const [, tier, material, v2] = /^Pilot_(T\d)_([A-Za-z]+)(_v2)?$/.exec(dir) ?? [];
    const noUe = [`${tier}_${material}${v2 ?? ''}`, dir].some(n => temArquivos(ue('Characters', 'Armor', n), /\.uasset$/));
    assets.push({
      id: dir.toLowerCase().replace(/_/g, '-'), nome: `${tier} ${NOMES[material] ?? material}${v2 ? ' v2' : ''}`, grupo: 'Armaduras',
      etapas: {
        conceito: est(temArquivos(join(base, 'views')) || existsSync(join(base, 'front.png'))),
        meshy: est(['wait.json', 'task.json'].some(f => existsSync(join(base, f))) || temArquivos(base, /\.glb$/)),
        blender: est(temArquivos(join(base, 'Fit'), /\.blend$/)),
        unreal: est(noUe),
      },
    });
  }
  const referencias = art('Meshy', 'Reference');
  const refs = existsSync(referencias) ? readdirSync(referencias, { recursive: true }).map(String) : [];
  const rigs = art('Rigs');
  const criaturas = existsSync(rigs) ? readdirSync(rigs).filter(f => f.endsWith('.blend')).map(f => f.replace(/\.blend$/, '')).sort() : [];
  const sobrenaturais = new Set(['Draugr', 'Nokken', 'SluaghCrow']);
  for (const nome of criaturas) {
    assets.push({
      id: `rig-${nome.toLowerCase()}`, nome: NOMES[nome] ?? nome, grupo: sobrenaturais.has(nome) ? 'Criaturas sobrenaturais' : 'Animais',
      etapas: {
        conceito: est(refs.some(f => new RegExp(`(^|[\\\\/_])${nome}`, 'i').test(f))),
        meshy: est(existsSync(art('Meshy', 'Normalized', `${nome}.glb`))),
        blender: est(existsSync(join(rigs, `${nome}.blend`))),
        unreal: est(temArquivos(ue('Rigs', nome), /\.uasset$/)),
      },
    });
  }
  if (existsSync(join(rigs, 'Player'))) {
    assets.push({
      id: 'jogador', nome: 'Jogador (exilado)', grupo: 'Jogador',
      etapas: {
        conceito: est(temArquivos(art('Models', 'Character'))), meshy: 'na',
        blender: est(temArquivos(join(rigs, 'Player'), /\.blend$/)), unreal: est(temArquivos(ue('Characters', 'Player'), /\.uasset$/)),
      },
    });
  }
  return {
    sobre: 'Gerado por coletores/ritualistic.mjs pela existência de arquivos: conceito (vistas ou referências), Meshy (job ou GLB), Blender (.blend de ajuste ou rig) e Unreal (.uasset no Content). Feito aqui quer dizer "o arquivo existe", não "aprovado".',
    etapas: [
      { id: 'conceito', nome: 'Conceito' }, { id: 'meshy', nome: 'Meshy' }, { id: 'blender', nome: 'Blender' }, { id: 'unreal', nome: 'Unreal' },
    ],
    assets,
  };
}

export function coletar(repo, card) {
  const commits = lerCommits(repo);
  const plano = lerPlano(repo);
  const tags = lerTags(repo);
  const ler = n => lerJsonSeExiste(join(card, n));
  salvarJson(join(card, 'roteiro.json'), roteiro(plano, tags));
  const en = entregas(repo, card, plano, tags, commits, ler('entregas.json'));
  const geradas = gerarMiniaturas(en.pedidos);
  salvarJson(join(card, 'entregas.json'), en.dados);
  const pt = playtest(commits, ler('playtest.json'));
  salvarJson(join(card, 'playtest.json'), pt);
  salvarJson(join(card, 'decisoes.json'), decisoes(plano, commits, ler('decisoes.json')));
  const pl = pipeline(repo);
  salvarJson(join(card, 'pipeline.json'), pl);
  return {
    main: commits[0]?.curto, entregas: en.dados.entregas.length, geradas,
    achados: pt.iteracoes.reduce((s, i) => s + i.achados.length, 0), assets: pl.assets.length,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [repo, card] = process.argv.slice(2);
  if (!repo || !card) {
    console.error('Uso: node workspace/_shared/engine/coletores/ritualistic.mjs <repositório> <pasta-do-card>');
    process.exitCode = 1;
  } else {
    try {
      const r = coletar(resolve(repo), resolve(card));
      console.log(`Ritualistic (main ${r.main}): ${r.entregas} entregas (${r.geradas} miniaturas geradas agora), ${r.achados} achados de playtest, ${r.assets} assets no pipeline.`);
    } catch (e) {
      console.error(`erro: ${e.message}`);
      process.exitCode = 1;
    }
  }
}

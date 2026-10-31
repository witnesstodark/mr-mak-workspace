#!/usr/bin/env node
// Coletor do card Lightkeeper: lê o repositório do jogo e escreve roteiro, entregas, acervo e decisões do card.
//
// Uso: node workspace/_shared/engine/coletores/lightkeeper.mjs <repositório> <pasta-do-card>
//
// Fontes no repositório:
//   README.md                         tabela "| Nível | Região |" (as fases) e "Estado da fatia jogável" (itens do nível 0)
//   git log                           PRs mesclados (merge ou squash "(#N)"): entregas e as trilhas dos editores no roteiro
//   Concepts/<Pasta>/*.png            conceitos aprovados: categoria_nome_vista.png; o item junta as vistas
//   Docs/Marco1/capturas/*.png        capturas do marco 1
//   Audio/Musica/musica_*_vN.mp3      só a versão mais nova entra no card (as outras ficam no repositório)
//   Docs/EditorModelos_Especificacao.md  "Decisões fechadas na entrevista" (| # | Decisão |)
// Painel e projeto.json são escritos à mão. Textos já presentes no card são preservados (coletores/comum.mjs).
import { readFileSync, readdirSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerCommits, prsMesclados, cortar, lerJsonSeExiste, salvarJson, preservarTextos, gerarMiniaturas } from './comum.mjs';

const CATEGORIA_DA_PASTA = {
  Characters: 'personagens', Environment: 'cenario', KeyArt: 'arte-chave', UI: 'interface',
  Equipment: 'construcoes-objetos', Lighting: 'construcoes-objetos', Items: 'construcoes-objetos',
  Workstations: 'construcoes-objetos', Construction: 'construcoes-objetos', Lanterns: 'construcoes-objetos',
};
const NOME_FAMILIA = {
  personagem: 'Personagens', inimigo: 'Inimigos', chefe: 'Chefes', nivel: 'Níveis', ambiente: 'Ambientes', keyart: 'Arte-chave',
  ui: 'Telas', luz: 'Luz', item: 'Itens', bancada: 'Bancadas', construcao: 'Construção', lanterna: 'Lanternas',
  equipamento: 'Equipamentos', ferramenta: 'Ferramentas', musica: 'Música', 'marco-1': 'Marco 1',
};
const LARGURA = 480;

const slugar = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Linhas de uma tabela Markdown logo abaixo do título `cabecalho` (regex), como listas de células. */
function tabelaApos(md, cabecalho) {
  const linhas = md.split(/\r?\n/);
  const i = linhas.findIndex(l => cabecalho.test(l));
  if (i < 0) return [];
  const saida = [];
  for (const l of linhas.slice(i + 1)) {
    if (/^#{1,6} /.test(l)) break;
    if (!l.trim().startsWith('|') || /^\|\s*-/.test(l.trim())) continue;
    saida.push(l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
  }
  return saida; // inclui o cabeçalho quando o título é uma seção; quem chama filtra as linhas de dados
}

// ---------- Roteiro ----------
function roteiro(repo, prs) {
  const readme = readFileSync(join(repo, 'README.md'), 'utf8');
  const niveis = tabelaApos(readme, /^\|\s*Nível\s*\|\s*Região/).filter(r => /^\d+$/.test(r[0]));
  if (!niveis.length) throw new Error('README.md: tabela "| Nível | Região |" não encontrada');
  // Etapas da fatia: "Já implementado (marco 1):" e "Etapa N (nome):", cada um seguido de bullets.
  const secao = readme.split(/^## Estado da fatia jogável/m)[1]?.split(/^## |^### /m)[0] ?? '';
  const etapas = [];
  for (const bloco of secao.split(/\n(?=[^\n-][^\n]*:\s*\n)/)) {
    const m = /^(?:Já implementado \((marco \d+)\)|Etapa (\d+) \(([^)]+)\)):\s*\n([\s\S]*)/m.exec(bloco.trim());
    if (!m) continue;
    const bullets = m[4].split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim());
    const n = m[1] ? 1 : Number(m[2]);
    etapas.push({ n, nome: m[1] ? 'base (marco 1)' : m[3], bullets });
  }
  const prDe = re => prs.filter(p => re.test(p.titulo));
  const itens = etapas.map(e => {
    const pr = prDe(new RegExp(`^Etapa ${e.n}:`))[0] ?? (e.n === 3 ? prDe(/^Abrigo funcional/)[0] : null);
    return {
      id: `S${e.n}`, titulo: `Etapa ${e.n} · ${e.nome}`, estado: 'feito',
      resumo: cortar(`${pr ? `PR #${pr.pr}. ` : ''}${e.bullets.slice(0, 3).join(' ')}`, 400),
      ...(e.n > 1 ? { depende: [`S${e.n - 1}`] } : {}),
    };
  });
  // Trilhas dos editores, uma tarefa por PR: "Editor de mapas, etapa N", "Editor de modelos, etapa N", "modo fácil (item N...)".
  const trilha = (prefixo, re, nome) => prDe(re).map((p, k, lista) => ({
    id: `${prefixo}${k + 1}`, titulo: `${nome} · ${p.titulo.replace(re, '').replace(/^[:\s]+/, '')}`, estado: 'feito',
    resumo: `PR #${p.pr}.`, ...(k ? { depende: [`${prefixo}${k}`] } : {}),
  }));
  itens.push(
    ...trilha('MP', /^Editor de mapas, etapas? [\d e]+/, 'Editor de mapas'),
    ...trilha('EM', /^Editor de modelos, etapa \d+/, 'Editor de modelos'),
    ...trilha('MF', /^Editor de modelos, modo fácil \([^)]*\)/, 'Modo fácil'),
  );
  return {
    sobre: 'Gerado por coletores/lightkeeper.mjs. Fases = os 11 níveis da tabela do README; o nível 0 é a fatia jogável, com as etapas do README e as trilhas dos editores (uma tarefa por PR). O que falta na fatia não está escrito no repositório.',
    unidade: 'tarefas',
    fases: niveis.map(([n, regiao]) => ({
      id: `N${n}`, nome: `Nível ${n} · ${regiao}`, estado: n === '0' ? 'atual' : 'futura',
      ...(n === '0' ? { descricao: 'Fatia jogável: o ciclo completo no Pátio (explorar, coletar, administrar luz, fabricar, montar abrigo, descansar e voltar a explorar), com ratos e zumbis comuns, pira, save, morte e renascimento.', itens } : {}),
    })),
  };
}

// ---------- Entregas ----------
const AREAS = [
  [/^Editor de modelos/, 'editor de modelos'],
  [/editor de mapas|^Mapa base/i, 'editor de mapas'],
  [/^(Sons|Música|Controle de volume|Empacotamento inclui a pasta dos sons)/, 'áudio'],
  [/^(Kit|Modelos|Mochila|Armadura|Tochas|Ambientação|Itens do jogo|Módulos|Pisos)/, 'arte'],
  [/^(Build|Importa|Adiciona README|Revisão de código)/, 'ferramentas'],
];
function entregas(repo, prs, anteriores) {
  const capturas = join(repo, 'Docs', 'Marco1', 'capturas');
  const lista = prs.map(p => {
    const area = AREAS.find(([re]) => re.test(p.titulo))?.[1] ?? 'jogo';
    const resumo = p.commits.length > 1 ? p.commits.join('; ') : (p.commits[0] ?? p.titulo);
    const e = {
      id: `pr-${p.pr}`, data: p.data, area, titulo: `PR #${p.pr} · ${p.titulo}`, resumo: cortar(resumo, 280),
      estado: 'main', refs: [`PR #${p.pr}`, p.curto],
    };
    if (/^Etapa 1:/.test(p.titulo) && existsSync(capturas)) {
      e.miniaturas = [['01_inicio', 'Início no pátio'], ['06_parede_translucida', 'Parede translúcida entre a câmera e o personagem']]
        .filter(([n]) => existsSync(join(capturas, `${n}.png`)))
        .map(([n, legenda]) => ({ arquivo: `media/capturas/marco-1/marco-1-capturas-v01${n === '01_inicio' ? '' : `-${slugar(n.replace(/^\d+_/, ''))}`}.webp`, legenda }));
    }
    return e;
  });
  return { sobre: 'Gerado por coletores/lightkeeper.mjs: um PR mesclado na main por entrega. Títulos, resumos e "olhar" escritos à mão ficam preservados.', entregas: preservarTextos(lista, anteriores?.entregas, ['titulo', 'resumo', 'olhar']) };
}

// ---------- Acervo ----------
function acervo(repo, card) {
  const itens = new Map(); // id -> { id, categoria, familia, vistas: Map(vista -> origem) }
  const pedidos = [];
  const adicionar = (categoria, familia, id, vista, origem) => {
    if (!itens.has(id)) itens.set(id, { id, categoria, familia, vistas: new Map() });
    const it = itens.get(id);
    if (!it.vistas.has(vista)) it.vistas.set(vista, origem);
  };
  const conceitos = join(repo, 'Concepts');
  for (const pasta of Object.keys(CATEGORIA_DA_PASTA)) {
    const dir = join(conceitos, pasta);
    if (!existsSync(dir)) continue;
    const arquivos = readdirSync(dir, { recursive: true }).map(String).filter(f => /\.png$/i.test(f)).sort();
    for (const rel of arquivos) {
      const partes = rel.split(/[\\/]/).pop().replace(/\.png$/i, '').split('_');
      const familia = slugar(partes[0]);
      const tamNome = familia === 'nivel' ? 2 : 1;
      const id = slugar([partes[0], ...partes.slice(1, 1 + tamNome)].join('-'));
      const vista = slugar(partes.slice(1 + tamNome).join('-')) || 'principal';
      adicionar(CATEGORIA_DA_PASTA[pasta], familia, id, vista, join(dir, rel));
    }
  }
  const capturas = join(repo, 'Docs', 'Marco1', 'capturas');
  if (existsSync(capturas)) {
    for (const f of readdirSync(capturas).filter(f => /\.png$/i.test(f)).sort()) {
      const vista = f === '01_inicio.png' ? 'principal' : slugar(f.replace(/^\d+_/, '').replace(/\.png$/i, ''));
      adicionar('capturas', 'marco-1', 'marco-1-capturas', vista, join(capturas, f));
    }
  }
  const humano = s => { const t = s.replace(/-/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };
  const saida = [...itens.values()].map(it => {
    const vistas = [...it.vistas.entries()].sort(([a], [b]) => (a === 'principal' ? -1 : b === 'principal' ? 1 : a.localeCompare(b)));
    const base = `media/${it.categoria}/${it.familia}/${it.id}-v01`;
    const arquivos = vistas.map(([v, origem], k) => {
      const rel = k === 0 ? `${base}.webp` : `${base}-${v}.webp`;
      pedidos.push({ de: origem, para: join(card, rel), largura: LARGURA });
      return { v, rel, origem };
    });
    const nomeSemFamilia = it.id === 'marco-1-capturas' ? 'Capturas do marco 1' : humano(it.id.replace(new RegExp(`^${it.familia}-`), ''));
    const item = {
      id: it.id, nome: nomeSemFamilia, categoria: it.categoria, familia: it.familia, status: 'vigente', versao: 1,
      miniatura: arquivos[0].rel, original: arquivos.map(a => a.origem.slice(repo.length + 1).replace(/\\/g, '/')).join(', '),
    };
    if (arquivos[0].v !== 'principal') item.miniaturaRotulo = humano(arquivos[0].v);
    if (arquivos.length > 1) item.vistas = arquivos.slice(1).map(a => ({ rotulo: humano(a.v), arquivo: a.rel }));
    return item;
  });
  // Música: só a versão mais nova de cada faixa entra no card.
  const musica = join(repo, 'Audio', 'Musica');
  if (existsSync(musica)) {
    const faixas = new Map();
    for (const f of readdirSync(musica)) {
      const m = /^musica_(.+)_v(\d+)\.mp3$/.exec(f);
      if (m && (!faixas.has(m[1]) || faixas.get(m[1]).v < Number(m[2]))) faixas.set(m[1], { v: Number(m[2]), f });
    }
    for (const [nome, { v, f }] of faixas) {
      const id = `musica-${slugar(nome)}`;
      const rel = `media/audio/musica/${id}-v${String(v).padStart(2, '0')}.mp3`;
      mkdirSync(dirname(join(card, rel)), { recursive: true });
      if (!existsSync(join(card, rel))) copyFileSync(join(musica, f), join(card, rel));
      saida.push({
        id, nome: humano(slugar(nome)), categoria: 'audio', familia: 'musica', status: 'vigente', versao: v, audio: rel,
        original: `Audio/Musica/${f}`, nota: `As versões 1 a ${v - 1} e os loops em WAV ficam em \`Audio/Musica/\` no repositório.`,
      });
    }
  }
  const familias = {};
  for (const it of saida) familias[`${it.categoria}/${it.familia}`] = NOME_FAMILIA[it.familia] ?? humano(it.familia);
  return { dados: { sobre: 'Gerado por coletores/lightkeeper.mjs a partir de Concepts/, Docs/Marco1/capturas e Audio/Musica. Cada item junta as vistas do mesmo nome (categoria_nome_vista.png); só prévias WebP de 480 px.', familias, itens: saida }, pedidos };
}

// ---------- Decisões ----------
function decisoes(repo, anteriores) {
  const spec = join(repo, 'Docs', 'EditorModelos_Especificacao.md');
  const linhas = existsSync(spec) ? tabelaApos(readFileSync(spec, 'utf8'), /^## Decisões fechadas na entrevista/) : [];
  const temas = [];
  if (linhas.length) {
    temas.push({ nome: 'Editor de modelos', decisoes: linhas.filter(r => /^\d+$/.test(r[0])).map(([n, d]) => ({ id: `EM${n}`, titulo: d.replace(/\*\*/g, ''), estado: 'Confirmada', data: '2026-10-12' })) });
  }
  const agents = join(repo, 'AGENTS.md');
  if (existsSync(agents) && /skills internas/.test(readFileSync(agents, 'utf8'))) {
    temas.push({ nome: 'Fluxo de trabalho', decisoes: [{ id: 'FL1', titulo: 'Revisão de PR obrigatória pelas skills internas (`/code-review`, `/simplify` quando muda código, `/security-review` em CI, scripts e entrada de arquivos), sem o Codex; merge só sem achado bloqueante, com CI verde e sem conflito', estado: 'Confirmada', data: '2026-10-12' }] });
  }
  for (const t of temas) {
    const ant = anteriores?.temas?.find(x => x.nome === t.nome);
    t.decisoes = preservarTextos(t.decisoes, ant?.decisoes, ['titulo', 'nota']);
  }
  return {
    sobre: 'Gerado por coletores/lightkeeper.mjs. O repositório não tem registro geral de decisões: entram a tabela de Docs/EditorModelos_Especificacao.md (aprovada em 12/10/2026) e a regra de revisão do AGENTS.md.',
    fonte: 'Docs/EditorModelos_Especificacao.md e AGENTS.md do repositório Lightkeeper.',
    ...(anteriores?.espera ? { espera: anteriores.espera } : {}),
    ...(anteriores?.notas ? { notas: anteriores.notas } : {}),
    temas,
  };
}

export function coletar(repo, card) {
  const commits = lerCommits(repo);
  const prs = prsMesclados(repo, commits);
  const ler = n => lerJsonSeExiste(join(card, n));
  salvarJson(join(card, 'roteiro.json'), roteiro(repo, prs));
  salvarJson(join(card, 'entregas.json'), entregas(repo, prs, ler('entregas.json')));
  const ac = acervo(repo, card);
  const geradas = gerarMiniaturas(ac.pedidos);
  salvarJson(join(card, 'acervo.json'), ac.dados);
  salvarJson(join(card, 'decisoes.json'), decisoes(repo, ler('decisoes.json')));
  return { prs: prs.length, itens: ac.dados.itens.length, imagens: ac.pedidos.length, geradas, main: commits[0]?.curto };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [repo, card] = process.argv.slice(2);
  if (!repo || !card) {
    console.error('Uso: node workspace/_shared/engine/coletores/lightkeeper.mjs <repositório> <pasta-do-card>');
    process.exitCode = 1;
  } else {
    try {
      const r = coletar(resolve(repo), resolve(card));
      console.log(`Lightkeeper (main ${r.main}): ${r.prs} PRs, ${r.itens} itens no acervo, ${r.imagens} imagens (${r.geradas} geradas agora).`);
    } catch (e) {
      console.error(`erro: ${e.message}`);
      process.exitCode = 1;
    }
  }
}

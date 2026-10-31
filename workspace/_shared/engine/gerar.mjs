#!/usr/bin/env node
// Motor dos cards do Workspace. Lê <card>/projeto.json, valida os dados de cada aba ligada,
// gera <card>/<aba>.html e atualiza o registro do card em workspace/workspace.json.
//
// Uso: node workspace/_shared/engine/gerar.mjs <pasta-do-card> [--hoje AAAA-MM-DD] [--verificar] [--sem-registro] [--registro <arquivo>]
//   --hoje          data usada nas páginas e na janela de entregas (padrão: hoje, no fuso da máquina)
//   --verificar     só valida os dados; não grava nada
//   --sem-registro  não mexe em workspace.json (use nos testes)
//   --registro      outro arquivo no lugar de workspace/workspace.json (cópia de teste)
//
// Convenção: o módulo "x" lê <card>/x.json e escreve <card>/x.html. Cada módulo vive em modulos/<x>.mjs e exporta
//   validar(dados, ctx)   -> lista de erros em texto (vazia = ok); também aceita { erros, avisos }
//   gerar(dados, ctx)     -> HTML completo (use ctx.pagina({ titulo, subtitulo, corpo, scripts })); null = nada a gravar
//   fonte?  (texto)       -> nome do JSON lido, se diferente do nome do módulo (ex.: arquivo lê entregas.json)
//   caminho?(dados, ctx)  -> arquivo de saída, se diferente de <x>.html
// O módulo é carregado na hora (import dinâmico): basta o arquivo existir em modulos/ para a aba funcionar.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { diaLocal, diaValido } from './nucleo/datas.mjs';
import { lerJson, validarProjeto, comPadroes } from './nucleo/projeto.mjs';
import { criarFabrica } from './nucleo/contexto.mjs';
import { atualizarRegistro } from './nucleo/registro.mjs';
import { normalizarResultado, semRepetidas } from './nucleo/validacao.mjs';
import { calcularProgresso } from './nucleo/calculos.mjs';

export const ENGINE_DIR = dirname(fileURLToPath(import.meta.url));

/** Lista os módulos disponíveis (arquivos de modulos/). */
export function modulosDisponiveis(engineDir = ENGINE_DIR) {
  return readdirSync(join(engineDir, 'modulos')).filter(f => f.endsWith('.mjs')).map(f => f.slice(0, -4)).sort();
}

/**
 * Valida e gera um card. Devolve { erros, avisos, paginas: [{ caminho, aba, escrito }], registro }.
 * Não encerra o processo: quem chama decide (o CLI sai com código 1 se houver erros).
 */
export async function construirCard({
  pasta, hoje = diaLocal(), engineDir = ENGINE_DIR, verificar = false, semRegistro = false, registro: arquivoRegistro,
}) {
  const resultado = { erros: [], avisos: [], paginas: [], registro: 'ignorado', projeto: null, hoje };
  const falhar = (...msgs) => { resultado.erros.push(...msgs); return resultado; };
  pasta = resolve(pasta);
  if (!diaValido(hoje)) return falhar(`--hoje inválido: ${hoje} (use AAAA-MM-DD, uma data real)`);
  if (!existsSync(pasta)) return falhar(`pasta do card não existe: ${pasta}`);

  let bruto;
  try { bruto = lerJson(pasta, 'projeto.json'); } catch (e) { return falhar(e.message); }
  if (bruto === undefined) return falhar(`projeto.json não existe em ${pasta}`);
  const vp = validarProjeto(bruto, pasta);
  resultado.avisos.push(...vp.avisos);
  if (vp.erros.length) return falhar(...vp.erros);
  const projeto = comPadroes(bruto);
  resultado.projeto = projeto;

  const fabrica = criarFabrica({ pasta, projeto, hoje, engineDir });
  const alvos = [];
  const saidas = new Map();
  const erros = [];
  for (const aba of projeto.abas) {
    const arquivoModulo = join(engineDir, 'modulos', `${aba.modulo}.mjs`);
    if (!existsSync(arquivoModulo)) {
      erros.push(`aba "${aba.nome}": o módulo "${aba.modulo}" não existe em modulos/ (disponíveis: ${modulosDisponiveis(engineDir).join(', ')})`);
      continue;
    }
    let mod;
    try { mod = await import(pathToFileURL(arquivoModulo).href); } catch (e) { erros.push(`módulo "${aba.modulo}": não carregou (${e.message})`); continue; }
    if (typeof mod.gerar !== 'function' || typeof mod.validar !== 'function') {
      erros.push(`módulo "${aba.modulo}": precisa exportar validar(dados, ctx) e gerar(dados, ctx)`);
      continue;
    }
    const fonte = aba.base !== aba.modulo ? aba.base : (mod.fonte ?? aba.modulo);
    const ctx = fabrica.contexto({ aba, modulo: aba.modulo, fonte });
    let dados;
    try { dados = fabrica.carregar(fonte); } catch (e) { erros.push(e.message); continue; }
    if (dados === undefined) { erros.push(`${fonte}.json não existe (a aba "${aba.nome}" precisa dele)`); continue; }
    let r;
    try { r = normalizarResultado(mod.validar(dados, ctx)); } catch (e) { r = { erros: [`erro ao validar: ${e.message}`], avisos: [] }; }
    const marca = m => `${fonte}.json: ${m.startsWith(`${fonte}: `) ? m.slice(fonte.length + 2) : m}`; // "roteiro.json: roteiro: ..." vira "roteiro.json: ..."
    erros.push(...r.erros.map(marca));
    resultado.avisos.push(...r.avisos.map(marca));
    alvos.push({ aba, mod, ctx, dados, fonte });
  }
  resultado.erros.push(...semRepetidas(erros));
  resultado.avisos = semRepetidas(resultado.avisos);
  if (resultado.erros.length || verificar) { resultado.paginas = alvos.map(a => ({ aba: a.aba.nome, caminho: null })); return resultado; }

  // Gera tudo na memória antes de gravar qualquer coisa: um erro de geração não deixa o card pela metade.
  const gerados = [];
  for (const a of alvos) {
    try {
      const html = a.mod.gerar(a.dados, a.ctx);
      const caminho = a.mod.caminho?.(a.dados, a.ctx) ?? `${a.aba.base}.html`;
      if (saidas.has(caminho)) { resultado.erros.push(`as abas "${saidas.get(caminho)}" e "${a.aba.nome}" gerariam o mesmo arquivo (${caminho})`); continue; }
      saidas.set(caminho, a.aba.nome);
      if (html !== null && typeof html !== 'string') throw new Error('gerar() deve devolver o HTML (texto) ou null');
      gerados.push({ aba: a.aba, caminho, html });
    } catch (e) {
      resultado.erros.push(`aba "${a.aba.nome}": erro ao gerar: ${e.message}`);
    }
  }
  if (resultado.erros.length) return resultado;
  for (const g of gerados) {
    let escrito = false;
    if (g.html !== null) {
      const destino = join(pasta, g.caminho);
      if (!existsSync(destino) || readFileSync(destino, 'utf8') !== g.html) { writeFileSync(destino, g.html); escrito = true; }
    } else if (!existsSync(join(pasta, g.caminho))) {
      resultado.erros.push(`aba "${g.aba.nome}": a página ${g.caminho} não existe`);
    }
    resultado.paginas.push({ aba: g.aba.nome, caminho: g.caminho, escrito, escritaPeloMotor: g.html !== null });
  }

  // Registro: progresso e fase vêm do roteiro (quando o card tem roteiro ou painel, o arquivo já foi validado).
  const temRoteiro = projeto.abas.some(a => a.modulo === 'roteiro' || a.modulo === 'painel');
  const roteiro = temRoteiro ? fabrica.carregar('roteiro') : undefined;
  const calc = roteiro ? calcularProgresso(roteiro) : null;
  const campos = {
    updated: hoje,
    steps: gerados.map(g => ({ name: g.aba.nome, path: g.caminho })),
    cover: projeto.capa,
    progress: calc && calc.marco.total > 0 ? { done: calc.marco.done, total: calc.marco.total, label: calc.marco.label.slice(0, 60) } : undefined,
    phase: calc?.fase ? calc.fase.slice(0, 80) : undefined,
  };
  resultado.campos = campos;
  if (semRegistro) { resultado.registro = 'desligado (--sem-registro)'; return resultado; }
  const arquivo = arquivoRegistro ? resolve(arquivoRegistro) : join(engineDir, '..', '..', 'workspace.json');
  try {
    const estado = atualizarRegistro(arquivo, projeto.id, campos);
    resultado.registro = { gravado: 'gravado', 'sem-mudanca': 'sem mudança', 'sem-card': 'card não encontrado' }[estado];
    if (estado === 'sem-card') resultado.avisos.push(`o card "${projeto.id}" não está em ${arquivo}; as páginas foram geradas, mas o registro não foi atualizado`);
    else {
      const card = JSON.parse(readFileSync(arquivo, 'utf8').replace(/^﻿/, '')).entities.find(c => c.id === projeto.id);
      if (card?.folder && card.folder !== basename(pasta)) resultado.avisos.push(`o card "${projeto.id}" aponta para a pasta "${card.folder}", mas você gerou "${basename(pasta)}"`);
    }
  } catch (e) {
    resultado.registro = 'falhou';
    resultado.avisos.push(`registro: ${e.message}`);
  }
  return resultado;
}

const AJUDA = `Uso: node workspace/_shared/engine/gerar.mjs <pasta-do-card> [--hoje AAAA-MM-DD] [--verificar] [--sem-registro] [--registro <arquivo>]`;

export function lerArgumentos(argv) {
  const o = { pasta: null, hoje: undefined, verificar: false, semRegistro: false, registro: undefined, ajuda: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const valor = () => { if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`${a} pede um valor`); return argv[++i]; };
    if (a === '--hoje') o.hoje = valor();
    else if (a === '--registro') o.registro = valor();
    else if (a === '--verificar') o.verificar = true;
    else if (a === '--sem-registro') o.semRegistro = true;
    else if (a === '--ajuda' || a === '-h') o.ajuda = true;
    else if (a.startsWith('--')) throw new Error(`opção desconhecida: ${a}`);
    else if (!o.pasta) o.pasta = a;
    else throw new Error(`só uma pasta de card por vez (recebi também: ${a})`);
  }
  return o;
}

export async function main(argv) {
  let o;
  try { o = lerArgumentos(argv); } catch (e) { console.error(`erro: ${e.message}\n${AJUDA}`); return 1; }
  if (o.ajuda || !o.pasta) { console.log(AJUDA); return o.ajuda ? 0 : 1; }
  const r = await construirCard({ pasta: o.pasta, hoje: o.hoje, verificar: o.verificar, semRegistro: o.semRegistro, registro: o.registro });
  for (const a of r.avisos) console.warn(`aviso: ${a}`);
  if (r.erros.length) {
    console.error(r.erros.map(e => `erro: ${e}`).join('\n'));
    console.error(`${r.erros.length} erro${r.erros.length === 1 ? '' : 's'}; nada foi gravado.`);
    return 1;
  }
  if (o.verificar) { console.log(`ok: ${r.projeto.titulo}: ${r.paginas.length} abas válidas (${r.paginas.map(p => p.aba).join(', ')})`); return 0; }
  const novas = r.paginas.filter(p => p.escrito).length;
  console.log(`${r.projeto.titulo} · ${r.hoje}: ${r.paginas.length} abas (${novas} gravadas, ${r.paginas.length - novas} sem mudança)`);
  for (const p of r.paginas) console.log(`  ${p.caminho}${p.escritaPeloMotor ? '' : ' (escrita à mão)'}${p.escrito ? '' : ' · igual'}`);
  const c = r.campos;
  console.log(`registro: ${r.registro}${c.progress ? ` · progresso ${c.progress.done}/${c.progress.total} ${c.progress.label}` : ''}${c.phase ? ` · fase ${c.phase}` : ''}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(codigo => { process.exitCode = codigo; }, e => { console.error(`erro inesperado: ${e.stack ?? e.message}`); process.exitCode = 1; });
}

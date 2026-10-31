// Migração para o padrão de card de jogo (2026-10-29): todo card de jogo tem
// "tipo": "jogo", aba Acervo e acervo.json. Sem --gravar só mostra o que mudaria.
//
//   node workspace/_shared/engine/migrar-acervo.mjs [--jogos id,id,...] [--gravar]
//
// --jogos troca a lista padrão de cards de jogo. Itens antigos sem "geracao"
// continuam válidos e aparecem como "Sem registro de geração".
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const JOGOS_PADRAO = ['global-empires', 'lightkeeper', 'mashup', 'ritualistic', 'bleeding-stars', 'wild-horizons'];

const ler = (arquivo) => JSON.parse(readFileSync(arquivo, 'utf8').replace(/^﻿/, ''));

/** O que muda em cada card. `jogos` são ids de projeto.json. */
export function planejar(workspace = WORKSPACE, jogos = JOGOS_PADRAO) {
  const cards = [];
  for (const nome of readdirSync(workspace).sort()) {
    const arquivo = join(workspace, nome, 'projeto.json');
    if (!existsSync(arquivo)) continue;
    const projeto = ler(arquivo), pasta = join(workspace, nome);
    const jogo = jogos.includes(projeto.id);
    const mudancas = [];
    const novo = { ...projeto };
    if (jogo && projeto.tipo !== 'jogo') { novo.tipo = 'jogo'; mudancas.push('"tipo": "jogo"'); }
    if (jogo && !projeto.abas.some((a) => a.modulo === 'acervo')) {
      const abas = [...projeto.abas], antes = abas.findIndex((a) => a.modulo === 'arquivo');
      abas.splice(antes < 0 ? abas.length : antes, 0, { modulo: 'acervo', nome: 'Acervo' });
      novo.abas = abas; mudancas.push('aba Acervo');
    }
    const acervo = join(pasta, 'acervo.json');
    const criarAcervo = jogo && !existsSync(acervo);
    if (criarAcervo) mudancas.push('acervo.json vazio');
    const itens = existsSync(acervo) ? (ler(acervo).itens ?? []) : [];
    const semRegistro = itens.filter((i) => !i.geracao).length;
    const avisos = jogo && !projeto.repositorio ? ['sem "repositorio": o "Enviar ao agente" não acha o chat; preencha à mão'] : [];
    cards.push({ pasta, nome, id: projeto.id, titulo: projeto.titulo, jogo, mudancas, avisos, itens: itens.length, semRegistro, novo, criarAcervo });
  }
  return cards;
}

export function gravar(cards) {
  for (const c of cards) {
    if (!c.mudancas.length) continue;
    writeFileSync(join(c.pasta, 'projeto.json'), JSON.stringify(c.novo, null, 2) + '\n');
    if (c.criarAcervo) writeFileSync(join(c.pasta, 'acervo.json'), JSON.stringify({ itens: [] }, null, 2) + '\n');
  }
}

export function relatorio(cards, gravado) {
  const L = [gravado ? 'Migração gravada:' : 'Migração (simulação; nada foi gravado):'];
  for (const c of cards) {
    const tipo = c.jogo ? 'jogo' : 'fica como está';
    const muda = c.mudancas.length ? `muda: ${c.mudancas.join(', ')}` : 'sem mudança';
    const acervo = c.itens ? `; Acervo com ${c.itens} itens, ${c.semRegistro} sem registro de geração` : '';
    L.push(`  ${c.titulo} (${c.id}) — ${tipo}; ${muda}${acervo}`);
    for (const a of c.avisos) L.push(`    aviso: ${a}`);
  }
  if (!gravado) L.push('', 'Para gravar: --gravar. Para mudar quais cards são de jogo: --jogos id,id,...');
  return L.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2), i = args.indexOf('--jogos');
  const jogos = i >= 0 ? String(args[i + 1] || '').split(',').filter(Boolean) : JOGOS_PADRAO;
  const cards = planejar(WORKSPACE, jogos), confirmar = args.includes('--gravar');
  if (confirmar) gravar(cards);
  console.log(relatorio(cards, confirmar));
}

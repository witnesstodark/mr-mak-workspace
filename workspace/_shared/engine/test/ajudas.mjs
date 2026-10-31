// Ajudas dos testes: cards temporários em pastas do sistema, nunca em workspace/ nem em workspace.json.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { comPadroes } from '../nucleo/projeto.mjs';

const criadas = [];

export function pastaTemporaria(prefixo = 'mak-motor-') {
  const p = mkdtempSync(join(tmpdir(), prefixo));
  criadas.push(p);
  return p;
}

export function limparTemporarias() {
  for (const p of criadas.splice(0)) rmSync(p, { recursive: true, force: true });
}

/** Escreve { 'arquivo.json': objeto | texto | Buffer } dentro da pasta, criando subpastas. */
export function escrever(pasta, arquivos) {
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    const destino = join(pasta, nome);
    mkdirSync(dirname(destino), { recursive: true });
    const bruto = Buffer.isBuffer(conteudo) || typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo, null, 2);
    writeFileSync(destino, bruto);
  }
  return pasta;
}

export const imagemPequena = () => Buffer.alloc(2048, 7);
export const imagemGrande = () => Buffer.alloc(151 * 1024, 7);

export const PROJETO_BASE = {
  id: 'teste', titulo: 'Teste', destaque: '#3f8f7a', janelaDias: 30,
  areas: [{ id: 'código', cor: '#7fb3e6', icone: 'codigo' }, { id: 'arte', cor: '#e39ac8', icone: 'arte' }],
  abas: [{ modulo: 'painel', nome: 'Painel' }, { modulo: 'entregas', nome: 'Entregas' }, { modulo: 'arquivo', nome: 'Arquivo' }],
};

export const entrega = (extra = {}) => ({
  id: 'e1', data: '2026-10-17', area: 'código', titulo: 'Título', resumo: 'Resumo curto.', estado: 'main', ...extra,
});

/** Contexto mínimo para chamar validar() de um módulo sem rodar o motor inteiro. */
export function contexto(pasta, projeto = {}, hoje = '2026-10-17') {
  const p = comPadroes({ ...PROJETO_BASE, ...projeto });
  return { projeto: p, pasta, hoje, janelaDias: p.janelaDias, carregar: () => undefined };
}

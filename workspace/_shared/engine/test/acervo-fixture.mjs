// Apoio dos testes do Acervo: monta um card de mentira numa pasta temporária. Não é um teste.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** WebP de 1 × 1 px (válido). */
export const WEBP_1PX = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');

/** Escreve um arquivo de mídia de mentira com o tamanho pedido (padrão: o WebP mínimo). */
export function escreverMidia(pasta, rel, bytes = WEBP_1PX.length) {
  const destino = join(pasta, ...rel.split('/'));
  mkdirSync(dirname(destino), { recursive: true });
  const corpo = Buffer.alloc(bytes);
  WEBP_1PX.copy(corpo, 0, 0, Math.min(bytes, WEBP_1PX.length));
  writeFileSync(destino, corpo);
  return destino;
}

export function escreverJson(pasta, nome, dados) {
  writeFileSync(join(pasta, nome), `${JSON.stringify(dados, null, 2)}\n`);
}

export const PROJETO_BASE = {
  id: 'jogo-teste',
  titulo: 'Jogo de Teste',
  destaque: '#4a8f6a',
  categoriasExtras: ['Civilizações'],
  abas: [{ modulo: 'painel', nome: 'Painel' }, { modulo: 'acervo', nome: 'Acervo' }],
};

/** Itens que cobrem os recursos do módulo e passam na validação com os arquivos de `arquivosDoAcervo`. */
export function itensBase() {
  return [
    {
      id: 'fuzileiro', nome: 'Fuzileiro', categoria: 'personagens', familia: 'unidades', status: 'vigente', versao: 2,
      miniatura: 'media/personagens/unidades/fuzileiro-v02.webp', miniaturaRotulo: 'Conceito',
      vistas: [
        { rotulo: 'Leitura na câmera', arquivo: 'media/personagens/unidades/fuzileiro-v02-leitura.webp' },
        { rotulo: 'Modelo 3D', arquivo: 'media/personagens/unidades/fuzileiro-v02-modelo-3d.webp' },
      ],
      modelo3d: 'media/personagens/unidades/fuzileiro-v02.glb',
      original: 'GE-game/Unity_Import/Assets/_Project/Art/Concepts/Units/U04.png',
      prompt: 'media/personagens/unidades/fuzileiro-v02.prompt.md',
      nota: 'Aprovado em `U04`; 3D com 5 animações.',
      historico: [{ versao: 1, miniatura: 'media/personagens/unidades/fuzileiro-v01.webp', status: 'descartada', nota: 'Primeira versão, com carabina' }],
    },
    { id: 'sapador', nome: 'Sapador', categoria: 'personagens', familia: 'unidades', status: 'em-avaliacao', versao: 1, miniatura: 'media/personagens/unidades/sapador-v01.webp', nota: 'Em revisão.' },
    { id: 'centro-urbano', nome: 'Centro urbano', categoria: 'construcoes-objetos', familia: 'construcoes', status: 'vigente', versao: 1, miniatura: 'media/construcoes-objetos/construcoes/centro-urbano-v01.webp' },
    { id: 'tela-principal', nome: 'Tela principal', categoria: 'interface', familia: 'telas', status: 'em-avaliacao', versao: 1, miniatura: 'media/interface/telas/tela-principal-v01.webp', original: 'Entregas/Telas/Principal.png' },
    {
      id: 'terra-de-ninguem', nome: 'Terra de Ninguém', categoria: 'audio', familia: 'musica', status: 'vigente', versao: 1,
      audio: [{ rotulo: 'Latim 1', arquivo: 'media/audio/musica/terra-de-ninguem-v01-latim-1.ogg' }, { rotulo: 'Português 1', arquivo: 'media/audio/musica/terra-de-ninguem-v01-portugues-1.ogg' }],
    },
    { id: 'tiro-de-fuzil', nome: 'Tiro de fuzil', categoria: 'audio', familia: 'efeitos', status: 'vigente', versao: 1, audio: 'media/audio/efeitos/tiro-de-fuzil-v01.wav', nota: 'Fuzileiro atirando.' },
    { id: 'brasil', nome: 'Brasil', categoria: 'civilizacoes', familia: 'civilizacoes', status: 'vigente', versao: 3, miniatura: 'media/civilizacoes/civilizacoes/brasil-v03.webp', historico: [{ versao: 1, miniatura: 'media/civilizacoes/civilizacoes/brasil-v01.webp' }, { versao: 2, miniatura: 'media/civilizacoes/civilizacoes/brasil-v02.webp', status: 'descartada' }] },
    { id: 'japao', nome: 'Japão', categoria: 'civilizacoes', familia: 'civilizacoes', status: 'descartada', versao: 1, miniatura: 'media/civilizacoes/civilizacoes/japao-v01.webp' },
    { id: 'campo-aberto', nome: 'Fundo do menu — Campo Aberto', categoria: 'arte-chave', familia: 'menu-primeira-guerra', status: 'em-avaliacao', versao: 1, miniatura: 'media/arte-chave/menu-primeira-guerra/campo-aberto-v01.webp' },
  ];
}

/** Todos os arquivos que `itensBase` usa. */
export function arquivosDoAcervo(itens = itensBase()) {
  const lista = [];
  for (const i of itens) {
    if (i.miniatura) lista.push(i.miniatura);
    (i.vistas ?? []).forEach((v) => lista.push(v.arquivo));
    if (i.modelo3d) lista.push(i.modelo3d);
    const a = i.audio;
    if (typeof a === 'string') lista.push(a);
    else (a ?? []).forEach((x) => lista.push(x.arquivo));
    if (typeof i.prompt === 'string' && i.prompt.startsWith('media/')) lista.push(i.prompt);
    (i.historico ?? []).forEach((h) => h.miniatura && lista.push(h.miniatura));
  }
  return lista;
}

/** Cria o card (projeto.json, acervo.json e a mídia) e devolve { pasta, limpar() }. */
export function criarCard({ projeto = PROJETO_BASE, itens = itensBase(), familias, midia = true } = {}) {
  const pasta = mkdtempSync(join(tmpdir(), 'acervo-teste-'));
  escreverJson(pasta, 'projeto.json', projeto);
  escreverJson(pasta, 'acervo.json', familias ? { itens, familias } : { itens });
  if (midia) for (const rel of arquivosDoAcervo(itens)) escreverMidia(pasta, rel);
  return { pasta, limpar: () => rmSync(pasta, { recursive: true, force: true }) };
}

/** ctx mínimo, no formato do motor, só para as funções que não dependem do núcleo. */
export function ctxDeMentira(extra = {}) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return {
    projeto: { ...PROJETO_BASE },
    hoje: '2026-10-17',
    esc,
    pagina: ({ titulo, subtitulo = '', corpo = '', scripts = '' }) => `<!doctype html><html><body><h1>${esc(titulo)}</h1><p>${subtitulo}</p>${corpo}${scripts}</body></html>`,
    ...extra,
  };
}

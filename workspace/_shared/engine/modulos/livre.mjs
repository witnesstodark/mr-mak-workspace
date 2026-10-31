// Aba livre: para o conteúdo que nenhum módulo cobre. Dois jeitos, ambos escritos à mão:
//   { "titulo": "...", "subtitulo": "...", "corpo": "livre-corpo.html" }
//       -> o motor embrulha o trecho de HTML (só o miolo, sem <html>) na página padrão, com capa e tema.
//   { "arquivo": "minha-pagina.html" }
//       -> uma página HTML completa, escrita à mão; o motor só a registra como aba e não a reescreve.
// Para ter mais de uma aba livre, dê a cada uma um "base" diferente em projeto.json (abas[].base).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ehObjeto, opcionalTexto, validarCaminho } from '../nucleo/validacao.mjs';
import { esc } from '../nucleo/esc.mjs';

export function validar(dados, ctx) {
  const erros = [];
  if (!ehObjeto(dados)) return ['o arquivo deve ser um objeto com "corpo" ou "arquivo"'];
  const tem = ['corpo', 'arquivo'].filter(c => dados[c] !== undefined);
  if (tem.length !== 1) { erros.push('livre: informe exatamente um de "corpo" (trecho de HTML) ou "arquivo" (página completa)'); return erros; }
  opcionalTexto(erros, 'livre', dados, 'titulo');
  opcionalTexto(erros, 'livre', dados, 'subtitulo');
  const campo = tem[0];
  if (validarCaminho(erros, `livre › ${campo}`, dados[campo], { pasta: ctx.pasta, extensoes: ['html'] }) && campo === 'corpo') {
    const html = readFileSync(join(ctx.pasta, dados.corpo), 'utf8');
    if (/<!doctype|<html[\s>]/i.test(html)) erros.push('livre › corpo: o arquivo é uma página completa; use "arquivo" em vez de "corpo"');
  }
  if (campo === 'arquivo') {
    const html = readFileSync(join(ctx.pasta, dados.arquivo), 'utf8');
    if (!/data-mak-report=["']document["']/.test(html)) erros.push(`livre › arquivo: ${dados.arquivo} precisa de data-mak-report="document" na tag <html> e dos estilos de _shared/`);
    if (!/_shared\/report\.js/.test(html)) erros.push(`livre › arquivo: ${dados.arquivo} precisa carregar _shared/report.js (prévia e download das imagens)`);
  }
  return erros;
}

/** Aba "arquivo": o caminho registrado é o da página escrita à mão, não livre.html. */
export function caminho(dados, ctx) {
  return dados.arquivo ?? `${ctx.aba.base ?? ctx.aba.modulo}.html`;
}

export function gerar(dados, ctx) {
  if (dados.arquivo) return null; // página escrita à mão: nada a gravar
  const corpo = readFileSync(join(ctx.pasta, dados.corpo), 'utf8');
  return ctx.pagina({
    titulo: dados.titulo ?? ctx.aba.nome,
    subtitulo: dados.subtitulo ? esc(dados.subtitulo) : '',
    corpo,
  });
}

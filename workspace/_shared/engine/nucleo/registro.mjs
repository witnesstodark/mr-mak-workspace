// Registro do card em workspace/workspace.json.
// Outros agentes e o app editam esse arquivo ao mesmo tempo, então o motor:
//  1. lê o arquivo logo antes de gravar e confere que ele não mudou desde a leitura;
//  2. se mudou, lê de novo e refaz a alteração (até 6 tentativas);
//  3. só toca nos campos do próprio card (updated, steps, cover, progress, phase) e não grava se nada mudou.
import { readFileSync, writeFileSync } from 'node:fs';

const CAMPOS_OPCIONAIS = ['cover', 'progress', 'phase'];

/** Aplica os campos do motor a uma entidade; devolve true se algo mudou. */
export function aplicarCampos(card, campos) {
  let mudou = false;
  const definir = (nome, valor) => {
    if (JSON.stringify(card[nome]) === JSON.stringify(valor)) return;
    card[nome] = valor;
    mudou = true;
  };
  definir('updated', campos.updated);
  definir('steps', campos.steps);
  for (const nome of CAMPOS_OPCIONAIS) {
    if (campos[nome] === undefined || campos[nome] === null) {
      if (nome in card) { delete card[nome]; mudou = true; }
    } else {
      definir(nome, campos[nome]);
    }
  }
  return mudou;
}

/**
 * Atualiza o card `id` em `arquivo`. campos = { updated, steps: [{name, path}], cover?, progress?, phase? }.
 * Devolve 'gravado', 'sem-mudanca' ou 'sem-card'. `aoLer(n)` é um gancho de teste, chamado depois de cada leitura.
 */
export function atualizarRegistro(arquivo, id, campos, { aoLer, tentativas = 6 } = {}) {
  for (let tentativa = 0; tentativa < tentativas; tentativa++) {
    const texto = readFileSync(arquivo, 'utf8');
    aoLer?.(tentativa);
    const dados = JSON.parse(texto.replace(/^﻿/, ''));
    const card = (dados.entities ?? []).find(c => c.id === id);
    if (!card) return 'sem-card';
    if (!aplicarCampos(card, campos)) return 'sem-mudanca';
    const eol = texto.includes('\r\n') ? '\r\n' : '\n';
    let saida = JSON.stringify(dados, null, 2) + '\n';
    if (eol === '\r\n') saida = saida.replace(/\n/g, '\r\n');
    if (readFileSync(arquivo, 'utf8') !== texto) continue; // alguém gravou no meio: relê e refaz
    writeFileSync(arquivo, saida);
    return 'gravado';
  }
  throw new Error('workspace.json mudou durante a gravação; o registro do card não foi atualizado (rode de novo)');
}

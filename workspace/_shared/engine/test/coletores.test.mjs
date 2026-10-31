// Coletores dos projetos de fora: códigos de commit com intervalos, mescla com o texto escrito à mão e PRs do git.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { codigos } from '../coletores/ritualistic.mjs';
import { preservarTextos, prsMesclados, cortar } from '../coletores/comum.mjs';
import { pastaTemporaria, limparTemporarias } from './ajudas.mjs';

after(limparTemporarias);

test('códigos PT: soltos, "to", "..", barra e intervalo sem repetir o prefixo', () => {
  assert.deepEqual(codigos('fixes (PT-106), PT-110 to PT-112 and PT-096..098', 'PT'), ['PT-096', 'PT-097', 'PT-098', 'PT-106', 'PT-110', 'PT-111', 'PT-112']);
  assert.deepEqual(codigos('PT-054/055; DD-005', 'PT'), ['PT-054', 'PT-055']);
  assert.deepEqual(codigos('PT-068 batches 1-2', 'PT'), ['PT-068']);
});

test('mescla: o texto do item que já existe fica; o resto é recalculado; item novo entra como veio', () => {
  const novos = [{ id: 'a', titulo: 'from git', estado: 'main' }, { id: 'b', titulo: 'new one' }];
  const anteriores = [{ id: 'a', titulo: 'escrito à mão', estado: 'branch' }];
  assert.deepEqual(preservarTextos(novos, anteriores, ['titulo']), [{ id: 'a', titulo: 'escrito à mão', estado: 'main' }, { id: 'b', titulo: 'new one' }]);
});

test('cortar termina em palavra inteira com reticências', () => {
  assert.equal(cortar('um dois três quatro', 12), 'um dois…');
  assert.equal(cortar('curto', 12), 'curto');
});

test('PRs do git: merge commit (título no corpo, commits do branch) e squash "(#N)"', () => {
  const repo = pastaTemporaria();
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'a.txt'), '1');
  git('add', '.'); git('commit', '-q', '-m', 'início');
  git('checkout', '-q', '-b', 'tarefa');
  writeFileSync(join(repo, 'a.txt'), '2');
  git('commit', '-q', '-am', 'primeiro passo');
  writeFileSync(join(repo, 'a.txt'), '3');
  git('commit', '-q', '-am', 'segundo passo');
  git('checkout', '-q', 'main');
  git('merge', '-q', '--no-ff', 'tarefa', '-m', 'Merge pull request #7 from dono/tarefa', '-m', 'Título do PR');
  writeFileSync(join(repo, 'a.txt'), '4');
  git('commit', '-q', '-am', 'Ajuste rápido (#8)');
  const prs = prsMesclados(repo);
  assert.deepEqual(prs.map(p => [p.pr, p.titulo, p.commits]), [[7, 'Título do PR', ['primeiro passo', 'segundo passo']], [8, 'Ajuste rápido', []]]);
});

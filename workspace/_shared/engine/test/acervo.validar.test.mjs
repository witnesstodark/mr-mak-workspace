import test from 'node:test';
import assert from 'node:assert/strict';
import { validar, categoriasDoProjeto, nomeEsperado, arquivosDoItem } from '../modulos/acervo.mjs';
import { criarCard, escreverMidia, itensBase, ctxDeMentira, PROJETO_BASE } from './acervo-fixture.mjs';

const comCard = (fn, opcoes) => {
  const card = criarCard(opcoes);
  try { return fn(card); } finally { card.limpar(); }
};
const ctxDe = (card, extra = {}) => ctxDeMentira({ pasta: card.pasta, ...extra });
const clonar = (itens) => JSON.parse(JSON.stringify(itens));
const mensagens = (r) => r.erros.join('\n');

test('card correto: sem erros; só avisa que falta a biblioteca 3D', () => comCard((card) => {
  const r = validar({ itens: itensBase() }, ctxDe(card));
  assert.deepEqual(r.erros, []);
  assert.equal(r.avisos.length, 1);
  assert.match(r.avisos[0], /lib\/model-viewer-umd\.min\.js/);
}));

test('sem pasta o validar confere campos e nomes, mas não os arquivos', () => {
  const r = validar({ itens: itensBase() }, ctxDeMentira());
  assert.deepEqual(r.erros, []);
});

test('dados que não são um objeto com "itens" são recusados com mensagem clara', () => {
  assert.match(validar(null, {}).erros[0], /deve ser um objeto/);
  assert.match(validar({}, {}).erros[0], /falta "itens"/);
  assert.equal(validar({ itens: [] }, {}).avisos.length, 1);
  assert.match(mensagens(validar({ itens: [7] }, {})), /item 1 deve ser um objeto/);
});

test('campos obrigatórios ausentes aparecem todos de uma vez', () => {
  const r = validar({ itens: [{}] }, ctxDeMentira());
  for (const campo of ['id', 'nome', 'categoria', 'familia', 'status', 'versao', 'miniatura']) assert.match(mensagens(r), new RegExp(`"${campo}"`), campo);
});

test('status: só vigente, em-avaliacao e descartada; "main local" é lugar, não status', () => {
  const itens = clonar(itensBase());
  itens[0].status = 'main local';
  itens[1].status = 'Em avaliação';
  const r = validar({ itens }, ctxDeMentira());
  assert.match(mensagens(r), /status "main local" fora de vigente, em-avaliacao, descartada/);
  assert.match(mensagens(r), /não são status: ponha em "original" ou "nota"/);
  assert.match(mensagens(r), /escreva exatamente "em-avaliacao"/);
});

test('categoria: comuns mais as de categoriasExtras do projeto', () => {
  assert.deepEqual(categoriasDoProjeto(PROJETO_BASE).map((c) => c.id), ['personagens', 'cenario', 'construcoes-objetos', 'interface', 'audio', 'arte-chave', 'civilizacoes']);
  assert.equal(categoriasDoProjeto(PROJETO_BASE).at(-1).nome, 'Civilizações');
  const itens = clonar(itensBase());
  itens[0].categoria = 'armas';
  const r = validar({ itens }, ctxDeMentira());
  assert.match(mensagens(r), /categoria "armas" fora de personagens, cenario/);
  assert.match(mensagens(r), /categoriasExtras/);
  // sem a extra no projeto, "civilizacoes" também é recusada
  const semExtra = validar({ itens: itensBase() }, ctxDeMentira({ projeto: { ...PROJETO_BASE, categoriasExtras: [] } }));
  assert.match(mensagens(semExtra), /categoria "civilizacoes" fora de/);
  // extra escrita como id
  assert.equal(categoriasDoProjeto({ categoriasExtras: ['bestiario'] }).at(-1).nome, 'Bestiario');
});

test('id: formato e repetição', () => {
  const itens = clonar(itensBase());
  itens[1].id = 'Sapador Novo';
  itens[2].id = 'fuzileiro';
  const r = validar({ itens }, ctxDeMentira());
  assert.match(mensagens(r), /id "Sapador Novo" deve ter só minúsculas/);
  assert.match(mensagens(r), /id repetido \(já usado no item 1\)/);
});

test('versao tem de ser inteiro de 1 a 999', () => {
  for (const ruim of [0, 1.5, '2', -1, 1000]) {
    const itens = clonar(itensBase());
    itens[1].versao = ruim;
    assert.match(mensagens(validar({ itens }, ctxDeMentira())), /"versao" deve ser um número inteiro/, String(ruim));
  }
});

test('nome de arquivo fora do padrão media/<categoria>/<familia>/<item>-vNN[-vista].webp', () => comCard((card) => {
  const itens = clonar(itensBase());
  itens[1].miniatura = 'media/personagens/unidades/sapador.webp';
  itens[2].miniatura = 'media/personagens/unidades/centro-urbano-v01.webp';
  itens[3].miniatura = 'media/interface/telas/tela-principal-v02.webp';
  itens[0].vistas[0].arquivo = 'media/personagens/unidades/fuzileiro-v02-Leitura.webp';
  const r = validar({ itens }, ctxDe(card));
  const m = mensagens(r);
  assert.match(m, /miniatura "media\/personagens\/unidades\/sapador\.webp" fora do padrão; para este item use media\/personagens\/unidades\/sapador-v01\[-vista\]\.webp/);
  assert.match(m, /centro-urbano-v01\.webp" fora do padrão/);
  assert.match(m, /tela-principal-v02\.webp" fora do padrão; para este item use media\/interface\/telas\/tela-principal-v01/);
  assert.match(m, /vista 1 "media\/personagens\/unidades\/fuzileiro-v02-Leitura\.webp" fora do padrão/);
}));

test('o padrão aceita vista com hífens e rejeita extensão errada', () => {
  const item = itensBase()[0];
  assert.equal(nomeEsperado(item), 'media/personagens/unidades/fuzileiro-v02.webp');
  assert.equal(nomeEsperado(item, 1, { vista: 'frente' }), 'media/personagens/unidades/fuzileiro-v01-frente.webp');
  const itens = clonar(itensBase());
  itens[0].vistas.push({ rotulo: 'Costas e perfil', arquivo: 'media/personagens/unidades/fuzileiro-v02-costas-perfil.webp' });
  itens[1].miniatura = 'media/personagens/unidades/sapador-v01.png';
  const m = mensagens(validar({ itens }, ctxDeMentira()));
  assert.doesNotMatch(m, /costas-perfil/);
  assert.match(m, /sapador-v01\.png" fora do padrão/);
});

test('arquivo acima do limite (150 KB de imagem, 3 MB de GLB); exatamente no limite passa', () => comCard((card) => {
  escreverMidia(card.pasta, 'media/personagens/unidades/sapador-v01.webp', 150 * 1024 + 1);
  escreverMidia(card.pasta, 'media/personagens/unidades/fuzileiro-v02.glb', 3 * 1024 * 1024 + 1);
  escreverMidia(card.pasta, 'media/personagens/unidades/fuzileiro-v02-leitura.webp', 150 * 1024);
  const m = mensagens(validar({ itens: itensBase() }, ctxDe(card)));
  assert.match(m, /miniatura "media\/personagens\/unidades\/sapador-v01\.webp" tem 151 KB, acima do limite de 150 KB/);
  assert.match(m, /modelo 3D "media\/personagens\/unidades\/fuzileiro-v02\.glb" tem 3073 KB, acima do limite de 3072 KB/);
  assert.doesNotMatch(m, /fuzileiro-v02-leitura\.webp" tem/);
}));

test('arquivo que não existe no disco é acusado', () => comCard((card) => {
  const itens = clonar(itensBase());
  itens[1].miniatura = 'media/personagens/unidades/sapador-v01.webp';
  itens[1].vistas = [{ rotulo: 'Costas', arquivo: 'media/personagens/unidades/sapador-v01-costas.webp' }];
  const m = mensagens(validar({ itens }, ctxDe(card)));
  assert.match(m, /vista 1 "media\/personagens\/unidades\/sapador-v01-costas\.webp": arquivo não existe/);
  // com verificarArquivos:false a mesma lista passa
  assert.deepEqual(validar({ itens }, ctxDe(card, { verificarArquivos: false })).erros, []);
}));

test('item sem miniatura só é aceito se for de áudio; 3D pede miniatura', () => {
  const itens = clonar(itensBase());
  delete itens[1].miniatura;
  delete itens[0].miniatura;
  const m = mensagens(validar({ itens }, ctxDeMentira()));
  assert.match(m, /item "sapador" \(Sapador\): falta "miniatura"/);
  assert.match(m, /item "fuzileiro" \(Fuzileiro\): "modelo3d" pede "miniatura"/);
  assert.doesNotMatch(m, /terra-de-ninguem/);
});

test('histórico: versão anterior, sem repetir e com miniatura', () => {
  const itens = clonar(itensBase());
  itens[0].historico = [
    { versao: 2, miniatura: 'media/personagens/unidades/fuzileiro-v02.webp' },
    { versao: 1, miniatura: 'media/personagens/unidades/fuzileiro-v01.webp', status: 'arquivada' },
    { versao: 1, miniatura: 'media/personagens/unidades/fuzileiro-v01.webp' },
    { versao: 0 },
  ];
  const m = mensagens(validar({ itens }, ctxDeMentira()));
  assert.match(m, /histórico 1: a v02 é a versão vigente/);
  assert.match(m, /histórico 2: status "arquivada" fora de/);
  assert.match(m, /histórico 3: versão v01 repetida/);
  assert.match(m, /histórico 4: "versao" deve ser um número inteiro/);
  assert.match(m, /histórico 4: falta "miniatura"/);
});

test('nome do arquivo do histórico segue a versão dele', () => {
  const itens = clonar(itensBase());
  itens[0].historico[0].miniatura = 'media/personagens/unidades/fuzileiro-v02-antigo.webp';
  const m = mensagens(validar({ itens }, ctxDeMentira()));
  assert.match(m, /histórico 1 \(v01\) miniatura "media\/personagens\/unidades\/fuzileiro-v02-antigo\.webp" fora do padrão; para este item use .*fuzileiro-v01\[-vista\]/);
});

test('áudio: caminho único, lista com rótulos e extensões aceitas', () => {
  const itens = clonar(itensBase());
  itens[4].audio = [{ rotulo: 'A', arquivo: 'media/audio/musica/terra-de-ninguem-v01-a.ogg' }, { arquivo: 'media/audio/musica/terra-de-ninguem-v01-b.ogg' }];
  itens[5].audio = 'media/audio/efeitos/tiro-de-fuzil-v01.flac';
  const m = mensagens(validar({ itens }, ctxDeMentira()));
  assert.match(m, /"audio" com várias faixas pede "rotulo" em cada uma/);
  assert.match(m, /áudio 1 "media\/audio\/efeitos\/tiro-de-fuzil-v01\.flac" fora do padrão; para este item use .*\{ogg\|mp3\|wav\|m4a\}/);
  const bom = clonar(itensBase());
  bom[5].audio = 'media/audio/efeitos/tiro-de-fuzil-v01.mp3';
  assert.deepEqual(validar({ itens: bom }, ctxDeMentira()).erros, []);
});

test('prompt: arquivo em media/ segue o padrão .prompt.md; texto livre é aceito', () => {
  const itens = clonar(itensBase());
  itens[0].prompt = 'media/personagens/unidades/fuzileiro-v02.md';
  itens[1].prompt = 'GE-game/Art/Concepts/U07.prompt.md';
  itens[2].prompt = [{ rotulo: 'Montagem', arquivo: 'media/construcoes-objetos/construcoes/centro-urbano-v01-montagem.prompt.md' }, { arquivo: 'x' }];
  const m = mensagens(validar({ itens }, ctxDeMentira()));
  assert.match(m, /prompt "media\/personagens\/unidades\/fuzileiro-v02\.md" fora do padrão/);
  assert.doesNotMatch(m, /item "sapador"/);
  assert.match(m, /item "centro-urbano" \(Centro urbano\): "prompt" deve ser texto ou uma lista/);
});

test('o mesmo arquivo em dois itens, ou duas vezes no mesmo item, é erro', () => {
  const itens = clonar(itensBase());
  itens[1].miniatura = itens[0].miniatura;
  itens[0].vistas[1].arquivo = itens[0].vistas[0].arquivo;
  const m = mensagens(validar({ itens }, ctxDeMentira()));
  assert.match(m, /já é usado pelo item "fuzileiro"/);
  assert.match(m, /vista 2 .* aparece duas vezes no mesmo item/);
});

test('caminhos absolutos, com barra invertida ou com ".." são recusados', () => {
  const itens = clonar(itensBase());
  itens[1].miniatura = 'E:/MrMak/media/sapador-v01.webp';
  itens[2].miniatura = 'media\\construcoes-objetos\\construcoes\\centro-urbano-v01.webp';
  itens[3].miniatura = 'media/../fora/tela-principal-v01.webp';
  const m = mensagens(validar({ itens }, ctxDeMentira()));
  assert.equal((m.match(/use um caminho relativo à pasta do card/g) ?? []).length, 3);
});

test('"familias" opcional: nome em texto e aviso se nenhum item usa', () => {
  const r = validar({ itens: itensBase(), familias: { 'personagens/unidades': 'Unidades', 'cenario/mapas': 'Mapas', 'interface/telas': 7 } }, ctxDeMentira());
  assert.match(mensagens(r), /familias "interface\/telas": o nome deve ser texto/);
  assert.match(r.avisos.join('\n'), /familias "cenario\/mapas": nenhum item usa essa família/);
});

test('arquivosDoItem lista tudo o que o item usa, com a versão de cada arquivo', () => {
  const lista = arquivosDoItem(itensBase()[0]);
  assert.deepEqual(lista.map((f) => f.papel), ['miniatura', 'vista 1', 'vista 2', 'modelo 3D', 'prompt', 'histórico 1 (v01) miniatura']);
  assert.equal(lista.at(-1).versao, 1);
  assert.equal(lista[0].max, 150 * 1024);
});

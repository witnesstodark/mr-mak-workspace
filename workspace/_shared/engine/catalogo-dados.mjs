// Shared data validation for generation, browser drafts and exported adjustments.
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const id = x => typeof x === 'string' && /^[a-z0-9][a-z0-9:_-]{0,119}$/.test(x);
const text = (x, max = 4000) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;
const image = x => typeof x === 'string' && /^media\/[a-zA-Z0-9_/-]+\.(webp|png|jpg|svg)$/.test(x) && !x.includes('..');

export function valorValido(campo, valor) {
  if (valor === null) return true;
  if (campo.tipo === 'texto') return typeof valor === 'string' && valor.length <= 4000;
  if (campo.tipo === 'booleano') return typeof valor === 'boolean';
  return typeof valor === 'number' && Number.isFinite(valor)
    && (campo.min === undefined || valor >= campo.min) && (campo.max === undefined || valor <= campo.max);
}

export function validarCatalogo(dados) {
  const erros = [];
  if (!object(dados) || !Array.isArray(dados.grupos) || dados.grupos.length > 50) return ['catálogo precisa de grupos[] (até 50)'];
  const grupos = new Set(), itens = new Set();
  for (const g of dados.grupos) {
    if (!object(g) || !id(g.id) || grupos.has(g.id)) { erros.push('categoria inválida ou repetida'); continue; }
    grupos.add(g.id);
    if (![g.nome, g.resumo, g.estado].every(x => text(x, 12000)) || !image(g.imagem)) erros.push(`${g.id}: nome, resumo, estado e imagem são obrigatórios`);
    if (!Array.isArray(g.itens) || g.itens.length > 500) { erros.push(`${g.id}: itens inválidos`); continue; }
    for (const i of g.itens) {
      if (!object(i) || !id(i.id) || itens.has(i.id)) { erros.push(`${g.id}: registro inválido ou repetido`); continue; }
      itens.add(i.id);
      if (![i.nome, i.tipo, i.estado].every(x => text(x, 200)) || !image(i.imagem)) erros.push(`${i.id}: nome, tipo, estado e imagem são obrigatórios`);
      if (!Array.isArray(i.campos) || i.campos.length > 60) { erros.push(`${i.id}: campos inválidos`); continue; }
      const campos = new Set();
      for (const c of i.campos) {
        if (!object(c) || !id(c.id) || campos.has(c.id) || !text(c.rotulo, 200) || !['numero', 'texto', 'booleano'].includes(c.tipo)) { erros.push(`${i.id}: campo inválido ou repetido`); continue; }
        campos.add(c.id);
        if (!Object.hasOwn(c, 'atual') || !valorValido(c, c.atual)) erros.push(`${i.id}/${c.id}: valor atual inválido`);
      }
    }
  }
  return erros;
}

export function indiceCampos(dados) {
  return new Map(dados.grupos.flatMap(g => g.itens.flatMap(i => i.campos.map(c => [`${i.id}/${c.id}`, { grupo: g, item: i, campo: c }]))));
}

export function validarAjustes(ajustes, dados) {
  if (!object(ajustes) || ajustes.formato !== 'mak-catalogo-ajustes' || ajustes.versao !== 1 || ajustes.projeto !== dados.projeto || !Array.isArray(ajustes.alteracoes) || ajustes.alteracoes.length > 10000) throw new Error('Arquivo de ajustes inválido ou de outro projeto.');
  const index = indiceCampos(dados), seen = new Set();
  for (const a of ajustes.alteracoes) {
    const key = `${a?.item}/${a?.campo}`, entry = index.get(key);
    if (!object(a) || !entry || seen.has(key) || a.grupo !== entry.grupo.id || !valorValido(entry.campo, a.proposto)) throw new Error(`Campo ou valor inválido: ${key}`);
    if (a.atual !== entry.campo.atual) throw new Error(`A referência mudou para ${key}. Compare os valores antes de importar.`);
    seen.add(key);
  }
  return ajustes;
}

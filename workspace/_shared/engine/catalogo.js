import { indiceCampos, validarAjustes, valorValido } from './catalogo-dados.mjs';

const dados = JSON.parse(document.getElementById('cat-dados').textContent);
const index = indiceCampos(dados), edits = new Map();
const status = document.getElementById('cat-status');
const fields = [...document.querySelectorAll('[data-item][data-campo]')];
const keyOf = node => `${node.dataset.item}/${node.dataset.campo}`;
const key = `mak.catalogo.${dados.projeto}`;
let handle = null;
let lastStored = null, previousDraft = null;
const signature = () => JSON.stringify([...edits]);
let exported = signature();
function message(text, error = false) { status.textContent = text; status.toggleAttribute('data-erro', error); }
function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportData() {
  return { formato: 'mak-catalogo-ajustes', versao: 1, projeto: dados.projeto, exportadoEm: new Date().toISOString(),
    alteracoes: [...edits].map(([key, value]) => { const { grupo, item, campo } = index.get(key); return {
      grupo: grupo.id, item: item.id, nome: item.nome, campo: campo.id, rotulo: campo.rotulo, tipo: campo.tipo,
      atual: campo.atual, proposto: value, unidade: campo.unidade ?? '', origem: campo.origem ?? item.origem ?? '',
    }; }) };
}
function store() {
  try {
    if (localStorage.getItem(key) !== lastStored) { message('Outro catálogo alterou o rascunho. Seus campos foram mantidos nesta página; exporte-os para evitar sobrescrever outra edição.', true); return false; }
    lastStored = JSON.stringify(exportData()); localStorage.setItem(key, lastStored); return true;
  } catch { message('Não foi possível guardar o rascunho neste navegador. Exporte os ajustes antes de sair.', true); return false; }
}
function refresh() {
  for (const node of fields) {
    const k = keyOf(node), value = edits.has(k) ? edits.get(k) : index.get(k).campo.atual;
    node.value = value === null ? '' : String(value);
    node.closest('.cat-campo').dataset.alterado = String(edits.has(k));
  }
  message(edits.size ? `${edits.size} atributo(s) proposto(s). Rascunho local; exporte para entregar os ajustes.` : 'Nenhuma alteração proposta.');
}
function load(value) {
  validarAjustes(value, dados);
  const next = new Map(value.alteracoes.map(a => [`${a.item}/${a.campo}`, a.proposto]));
  edits.clear(); for (const [k, v] of next) if (v !== index.get(k).campo.atual) edits.set(k, v);
  refresh(); store();
}
try {
  lastStored = localStorage.getItem(key); previousDraft = localStorage.getItem(key + '.anterior');
  if (lastStored) load(JSON.parse(lastStored));
} catch {
  previousDraft = lastStored;
  try { if (previousDraft) localStorage.setItem(key + '.anterior', previousDraft); } catch { /* Keep the live recovery copy. */ }
  message('Há um rascunho antigo incompatível. Use Recuperar rascunho anterior para guardar uma cópia antes de comparar.', true);
}
document.getElementById('cat-recuperar').hidden = !previousDraft;
document.getElementById('cat-recuperar').addEventListener('click', () => download(previousDraft, 'rascunho-anterior.json'));
for (const node of fields) node.addEventListener('input', () => {
  const k = keyOf(node), c = index.get(k).campo;
  const value = node.value === '' ? null : c.tipo === 'numero' ? Number(node.value) : c.tipo === 'booleano' ? node.value === 'true' : node.value;
  if (node.validity.badInput || !valorValido(c, value)) { node.setCustomValidity('Informe um valor válido dentro do intervalo.'); message('Corrija o campo inválido antes de exportar.', true); return; }
  node.setCustomValidity('');
  if (value === c.atual) edits.delete(k); else edits.set(k, value);
  node.closest('.cat-campo').dataset.alterado = String(edits.has(k));
  if (store()) message(`${edits.size} atributo(s) proposto(s). Rascunho local; exporte para entregar os ajustes.`);
});
document.getElementById('cat-exportar').addEventListener('click', async () => {
  const invalid = fields.find(n => !n.checkValidity());
  if (invalid) { for (let p = invalid.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true; invalid.reportValidity(); return; }
  const value = exportData(); validarAjustes(value, dados);
  const text = JSON.stringify(value, null, 2) + '\n';
  try {
    if (typeof window.showSaveFilePicker === 'function' && window.top === window) {
      handle ??= await window.showSaveFilePicker({ suggestedName: 'ajustes-mods.json', types: [{ description: 'Ajustes do catálogo', accept: { 'application/json': ['.json'] } }] });
      const writer = await handle.createWritable(); await writer.write(text); await writer.close();
    } else {
      download(text, 'ajustes-mods.json');
    }
    exported = signature();
    message('Arquivo de ajustes exportado. Entregue-o para replicar as mudanças no mod; o código permanece como estava.');
  } catch (e) { if (e.name !== 'AbortError') message('Não foi possível exportar: ' + e.message, true); }
});
document.getElementById('cat-importar').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try { if (file.size > 2 * 1024 * 1024) throw new Error('O arquivo deve ter até 2 MB.'); load(JSON.parse(await file.text())); message('Ajustes importados e validados. Revise os campos destacados antes de exportar.'); }
  catch (error) { message(error.message, true); }
  e.target.value = '';
});
document.getElementById('cat-redefinir').addEventListener('click', () => {
  if (edits.size && !window.confirm('Descartar os ajustes deste navegador? Os arquivos exportados serão preservados.')) return;
  edits.clear(); refresh(); store();
  exported = signature();
});
const groups = [...document.querySelectorAll('.cat-grupo')];
const sections = [...document.querySelectorAll('.cat-grupo,.cat-categoria')];
let beforeFilter = null;
function expansionLabel() {
  document.getElementById('cat-expandir').textContent = sections.some(s => !s.hidden && !s.open) ? 'Abrir categorias' : 'Recolher categorias';
}
function filter() {
  const query = document.getElementById('cat-busca').value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
  const type = document.getElementById('cat-tipo').value;
  const mod = document.getElementById('cat-mod').value;
  const active = !!(query || type || mod);
  if (active && !beforeFilter) beforeFilter = new Map(sections.map(s => [s, s.open]));
  let total = 0, mods = 0;
  for (const group of groups) {
    let found = 0;
    for (const category of group.querySelectorAll('.cat-categoria')) {
      let count = 0;
      for (const item of category.querySelectorAll('.cat-item')) {
        item.hidden = !!((mod && group.dataset.grupo !== mod) || (type && item.dataset.tipo !== type) || (query && !`${group.dataset.nome} ${item.dataset.busca}`.includes(query)));
        if (!item.hidden) count++;
      }
      const size = category.querySelectorAll('.cat-item').length;
      category.hidden = count === 0;
      category.querySelector('.cat-categoria-contagem').textContent = count === size ? `${size} registros` : `${count} de ${size} registros`;
      if (active && count) category.open = true;
      found += count;
    }
    group.hidden = found === 0;
    const size = group.querySelectorAll('.cat-item').length;
    group.querySelector('.cat-grupo-contagem').textContent = found === size ? `${size} registros` : `${found} de ${size} registros`;
    if (active && found) group.open = true;
    if (found) mods++;
    total += found;
  }
  if (!active && beforeFilter) { for (const [section, open] of beforeFilter) section.open = open; beforeFilter = null; }
  document.getElementById('cat-resultados').textContent = total ? `${total} registros em ${mods} mod(s).` : 'Nenhum registro corresponde aos filtros e à pesquisa.';
  expansionLabel();
}
document.getElementById('cat-busca').addEventListener('input', filter);
document.getElementById('cat-tipo').addEventListener('change', filter);
document.getElementById('cat-mod').addEventListener('change', filter);
document.getElementById('cat-limpar').addEventListener('click', () => {
  document.getElementById('cat-busca').value = ''; document.getElementById('cat-tipo').value = ''; document.getElementById('cat-mod').value = ''; filter();
});
document.getElementById('cat-expandir').addEventListener('click', () => {
  const visible = sections.filter(s => !s.hidden), open = visible.some(s => !s.open);
  visible.forEach(s => s.open = open); expansionLabel();
});
for (const section of sections) section.addEventListener('toggle', expansionLabel);
window.addEventListener('beforeunload', e => { if (edits.size && signature() !== exported) { e.preventDefault(); e.returnValue = ''; } });

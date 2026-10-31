/* Acervo: comportamento do navegador (filtros, seções recolhíveis, comparar, visualizador 3D sob demanda).
   Só toca no DOM da própria página: sem API do app e sem armazenamento do navegador; da janela-pai só troca a mensagem do "Enviar ao agente",
   para funcionar também na prévia somente leitura do celular. O visualizador de imagens é o report.js compartilhado. */
(() => {
  'use strict';
  const raiz = document.querySelector('[data-ac]');
  if (!raiz) return;

  const $ = (seletor, base = raiz) => base.querySelector(seletor);
  const $$ = (seletor, base = raiz) => [...base.querySelectorAll(seletor)];
  const semAcento = texto => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

  // ---------- filtros ----------
  const itens = $$('.ac-item');
  const familias = $$('.ac-fam');
  const categorias = $$('.ac-cat');
  const botoes = $$('[data-ac-filtro]');
  const campoBusca = $('[data-ac-busca]');
  const total = $('[data-ac-total]');
  const vazio = $('[data-ac-vazio]');
  const expandir = $('[data-ac-expandir]');
  const recolher = $('[data-ac-recolher]');
  const estado = { categoria: '', status: '', busca: '' };

  const casa = (item, { categoria, status, busca }) => (
    (!categoria || item.dataset.categoria === categoria)
    && (!status || item.dataset.status === status)
    && (!busca || busca.split(/\s+/).every(parte => item.dataset.busca.includes(parte)))
  );

  // Famílias abertas só por causa da busca voltam a fechar quando a busca termina.
  const abertasPelaBusca = new Set();
  const abrirAutomatico = (detalhes, abrir) => {
    if (abrir && !detalhes.open) { detalhes.open = true; abertasPelaBusca.add(detalhes); }
    if (!abrir && abertasPelaBusca.has(detalhes)) { detalhes.open = false; abertasPelaBusca.delete(detalhes); }
  };
  for (const detalhes of familias) {
    detalhes.addEventListener('toggle', () => { if (abertasPelaBusca.has(detalhes) && !detalhes.open) abertasPelaBusca.delete(detalhes); });
  }

  const contagem = detalhes => $('[data-ac-cont]', detalhes);

  function aplicar() {
    estado.busca = semAcento(campoBusca ? campoBusca.value : '');
    let visiveis = 0;
    for (const item of itens) {
      const mostra = casa(item, estado);
      item.hidden = !mostra;
      if (mostra) visiveis++;
    }
    const filtrado = Boolean(estado.categoria || estado.status || estado.busca);
    for (const detalhes of familias) {
      const dentro = $$('.ac-item', detalhes);
      const n = dentro.filter(item => !item.hidden).length;
      detalhes.hidden = n === 0;
      const alvo = contagem(detalhes);
      if (alvo) alvo.textContent = filtrado && n !== dentro.length ? `${n} de ${plural(dentro.length, 'item', 'itens')}` : plural(n, 'item', 'itens');
      abrirAutomatico(detalhes, Boolean(estado.busca) && n > 0);
    }
    for (const detalhes of categorias) {
      const dentro = $$('.ac-item', detalhes);
      const n = dentro.filter(item => !item.hidden).length;
      detalhes.hidden = n === 0;
      const alvo = $(':scope > summary [data-ac-cont]', detalhes);
      if (alvo) alvo.textContent = filtrado && n !== dentro.length ? `${n} de ${plural(dentro.length, 'item', 'itens')}` : plural(n, 'item', 'itens');
    }
    // Cada botão mostra quantos itens sobrariam se ele fosse o escolhido, mantendo os outros filtros.
    for (const botao of botoes) {
      const tipo = botao.dataset.acFiltro;
      const valor = botao.dataset.valor;
      botao.setAttribute('aria-pressed', String(estado[tipo] === valor));
      const hipotese = { ...estado, [tipo]: valor };
      const marca = $('[data-ac-n]', botao);
      if (marca) marca.textContent = String(itens.filter(item => casa(item, hipotese)).length);
    }
    if (total) total.textContent = filtrado ? `${visiveis} de ${plural(itens.length, 'item', 'itens')}` : plural(itens.length, 'item', 'itens');
    if (vazio) vazio.hidden = visiveis !== 0;
    atualizarAcoes();
  }

  function atualizarAcoes() {
    const abertas = familias.filter(d => !d.hidden);
    const quantasAbertas = abertas.filter(d => d.open).length;
    if (expandir) expandir.disabled = !abertas.length || quantasAbertas === abertas.length;
    if (recolher) recolher.disabled = quantasAbertas === 0;
  }

  raiz.addEventListener('click', evento => {
    const botao = evento.target.closest('[data-ac-filtro]');
    if (botao && raiz.contains(botao)) {
      estado[botao.dataset.acFiltro] = botao.dataset.valor;
      aplicar();
    }
  });
  if (campoBusca) campoBusca.addEventListener('input', aplicar);
  if (expandir) expandir.addEventListener('click', () => { for (const d of familias) if (!d.hidden) { abertasPelaBusca.delete(d); d.open = true; } atualizarAcoes(); });
  if (recolher) recolher.addEventListener('click', () => { for (const d of familias) if (!d.hidden) { abertasPelaBusca.delete(d); d.open = false; } atualizarAcoes(); });
  for (const d of familias) d.addEventListener('toggle', atualizarAcoes);

  // Link direto para um item (#item-fuzileiro): abre as seções que o contêm.
  function irParaItem() {
    const alvo = location.hash.length > 1 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    if (!alvo || !raiz.contains(alvo)) return;
    for (let no = alvo.parentElement; no && no !== raiz; no = no.parentElement) if (no.tagName === 'DETAILS') no.open = true;
    alvo.scrollIntoView({ block: 'center' });
  }
  window.addEventListener('hashchange', irParaItem);

  // ---------- painéis dentro do cartão (comparar e 3D) ----------
  const fechadores = new Map(); // cartão -> função que fecha o painel aberto
  function fecharPainel(cartao) {
    const fechar = fechadores.get(cartao);
    if (fechar) fechar();
  }
  function fecharOutros(cartaoAtual) {
    for (const cartao of [...fechadores.keys()]) if (cartao !== cartaoAtual) fecharPainel(cartao);
  }
  function criar(tag, atributos = {}, filhos = []) {
    const no = document.createElement(tag);
    for (const [chave, valor] of Object.entries(atributos)) {
      if (chave === 'texto') no.textContent = valor;
      else if (chave === 'classe') no.className = valor;
      else no.setAttribute(chave, valor);
    }
    no.append(...filhos);
    return no;
  }
  const botaoPainel = (texto, acao, extra = {}) => {
    const b = criar('button', { type: 'button', classe: 'mk-filtro', texto, ...extra });
    b.addEventListener('click', acao);
    return b;
  };

  // ----- comparar -----
  function abrirComparar(cartao, gatilho) {
    fecharPainel(cartao);
    fecharOutros(cartao);
    const vistas = $$('img[data-ac-img]', cartao).filter(img => !img.closest('.ac-hist'));
    if (vistas.length < 2) return;
    const nome = $('h3', cartao).textContent;
    const rotuloDe = img => img.dataset.rotulo || img.alt;
    const opcoes = () => vistas.map((img, i) => new Option(rotuloDe(img), String(i)));
    const esquerda = criar('select', { 'aria-label': 'Imagem da esquerda' });
    const direita = criar('select', { 'aria-label': 'Imagem da direita' });
    esquerda.append(...opcoes());
    direita.append(...opcoes());
    esquerda.value = '0';
    direita.value = '1';

    const imgEsq = criar('img', { alt: '', decoding: 'async' });
    const imgDir = criar('img', { alt: '', decoding: 'async' });
    const topo = criar('div', { classe: 'ac-comp-topo' }, [imgEsq]);
    const linha = criar('span', { classe: 'ac-comp-linha', 'aria-hidden': 'true' });
    const palco = criar('div', { classe: 'ac-comp-palco' }, [imgDir, topo, linha]);
    const figEsq = criar('figure');
    const figDir = criar('figure');
    const faixa = criar('input', { type: 'range', min: '0', max: '100', value: '50', 'aria-label': 'Posição da divisão entre as duas imagens' });
    const rotEsq = criar('span');
    const rotDir = criar('span');
    const rotulos = criar('div', { classe: 'ac-comp-rot' }, [rotEsq, rotDir]);
    const modoSlider = botaoPainel('Deslizar', () => definirModo('deslizar'), { 'aria-pressed': 'true' });
    const modoLado = botaoPainel('Lado a lado', () => definirModo('lado'), { 'aria-pressed': 'false' });
    const modos = criar('div', { classe: 'ac-modos', role: 'group', 'aria-label': 'Modo de comparação' }, [modoSlider, modoLado]);
    const fechar = botaoPainel('Fechar', () => encerrar());
    const barra = criar('div', { classe: 'ac-painel-barra' }, [
      criar('strong', { texto: `Comparar: ${nome}` }),
      criar('label', {}, ['Esquerda ', esquerda]),
      criar('label', {}, ['Direita ', direita]),
      modos,
      fechar,
    ]);
    const painel = criar('div', { classe: 'ac-painel ac-comp', role: 'group', 'aria-label': `Comparar vistas de ${nome}` }, [
      barra, palco, criar('div', { classe: 'ac-comp-ctrl' }, [faixa, rotulos]),
    ]);
    let modo = 'deslizar';

    const definirPosicao = valor => {
      const p = Math.max(0, Math.min(100, Number(valor)));
      topo.style.clipPath = `inset(0 ${100 - p}% 0 0)`;
      linha.style.left = `${p}%`;
      faixa.value = String(p);
    };
    const razao = () => {
      const base = imgEsq.naturalWidth ? imgEsq : imgDir;
      if (base.naturalWidth && base.naturalHeight) {
        const r = base.naturalWidth / base.naturalHeight;
        palco.style.aspectRatio = `${base.naturalWidth} / ${base.naturalHeight}`;
        palco.style.setProperty('--ac-razao', `${base.naturalWidth} / ${base.naturalHeight}`);
        palco.style.maxWidth = `min(100%, calc(70vh * ${r}))`;
      } else {
        palco.style.aspectRatio = '4 / 3';
      }
    };
    const preencher = () => {
      const a = vistas[Number(esquerda.value)];
      const b = vistas[Number(direita.value)];
      for (const [no, origem] of [[imgEsq, a], [imgDir, b]]) {
        no.src = origem.currentSrc || origem.src;
        no.alt = `${nome}, ${rotuloDe(origem)}`;
      }
      rotEsq.textContent = `Esquerda: ${rotuloDe(a)}`;
      rotDir.textContent = `Direita: ${rotuloDe(b)}`;
      razao();
    };
    const definirModo = novo => {
      modo = novo;
      palco.classList.toggle('ac-lado', modo === 'lado');
      modoSlider.setAttribute('aria-pressed', String(modo === 'deslizar'));
      modoLado.setAttribute('aria-pressed', String(modo === 'lado'));
      faixa.hidden = modo === 'lado';
      if (modo === 'lado') {
        figEsq.replaceChildren(imgEsq);
        figDir.replaceChildren(imgDir);
        palco.replaceChildren(figEsq, figDir);
        palco.style.aspectRatio = '';
        palco.style.maxWidth = '';
      } else {
        topo.replaceChildren(imgEsq);
        palco.replaceChildren(imgDir, topo, linha);
        razao();
        definirPosicao(faixa.value);
      }
    };
    // Arrastar no palco também move a divisão (toque e mouse); a faixa continua valendo para o teclado.
    let arrastando = false;
    const mover = evento => {
      if (modo !== 'deslizar') return;
      const caixa = palco.getBoundingClientRect();
      definirPosicao(((evento.clientX - caixa.left) / caixa.width) * 100);
    };
    palco.addEventListener('pointerdown', evento => { if (modo !== 'deslizar') return; arrastando = true; palco.setPointerCapture?.(evento.pointerId); mover(evento); });
    palco.addEventListener('pointermove', evento => { if (arrastando) mover(evento); });
    const soltar = () => { arrastando = false; };
    palco.addEventListener('pointerup', soltar);
    palco.addEventListener('pointercancel', soltar);
    faixa.addEventListener('input', () => definirPosicao(faixa.value));
    for (const [seletor, outro] of [[esquerda, direita], [direita, esquerda]]) {
      seletor.addEventListener('change', () => {
        if (seletor.value === outro.value) outro.value = String((Number(seletor.value) + 1) % vistas.length);
        preencher();
      });
    }
    imgEsq.addEventListener('load', razao);
    imgDir.addEventListener('load', razao);

    const encerrar = () => {
      painel.remove();
      cartao.classList.remove('ac-ampliado');
      gatilho.setAttribute('aria-expanded', 'false');
      fechadores.delete(cartao);
      gatilho.focus({ preventScroll: true });
    };
    fechadores.set(cartao, () => { painel.remove(); cartao.classList.remove('ac-ampliado'); gatilho.setAttribute('aria-expanded', 'false'); fechadores.delete(cartao); });
    cartao.classList.add('ac-ampliado');
    gatilho.setAttribute('aria-expanded', 'true');
    ($('.ac-botoes', cartao) || $('.ac-corpo', cartao)).after(painel);
    preencher();
    definirPosicao(50);
    painel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ----- visualizador 3D (carrega a biblioteca só no primeiro clique) -----
  let bibliotecaPronta;
  function carregarBiblioteca() {
    if (window.customElements && customElements.get('model-viewer')) return Promise.resolve();
    bibliotecaPronta ??= new Promise((ok, falha) => {
      const script = document.createElement('script');
      script.src = raiz.dataset.acLib || 'lib/model-viewer-umd.min.js';
      script.onload = () => {
        const limite = setTimeout(() => falha(new Error('tempo esgotado')), 15000);
        customElements.whenDefined('model-viewer').then(() => { clearTimeout(limite); ok(); }, falha);
      };
      script.onerror = () => falha(new Error('biblioteca ausente'));
      document.head.append(script);
    }).catch(erro => { bibliotecaPronta = undefined; throw erro; });
    return bibliotecaPronta;
  }

  function abrir3D(cartao, gatilho) {
    fecharPainel(cartao);
    fecharOutros(cartao);
    const arquivo = gatilho.dataset.glb;
    const titulo = gatilho.dataset.titulo || $('h3', cartao).textContent;
    const aviso = criar('p', { classe: 'ac-painel-aviso', role: 'status', texto: 'Carregando o visualizador 3D…' });
    const animacoes = criar('select', { 'aria-label': 'Animação' });
    const rotuloAnimacao = criar('label', { hidden: '' }, ['Animação ', animacoes]);
    const baixar = criar('a', { href: arquivo, download: '', texto: 'Baixar GLB' });
    const fechar = botaoPainel('Fechar', () => encerrar());
    const barra = criar('div', { classe: 'ac-painel-barra' }, [criar('strong', { texto: `Modelo 3D: ${titulo}` }), rotuloAnimacao, baixar, fechar]);
    const painel = criar('div', { classe: 'ac-painel ac-3d', role: 'group', 'aria-label': `Modelo 3D de ${titulo}` }, [barra, aviso]);
    let visor;

    const encerrar = () => {
      if (visor) { visor.pause?.(); visor.removeAttribute('src'); }
      painel.remove();
      cartao.classList.remove('ac-ampliado');
      gatilho.setAttribute('aria-expanded', 'false');
      fechadores.delete(cartao);
      gatilho.focus({ preventScroll: true });
    };
    fechadores.set(cartao, () => { if (visor) { visor.pause?.(); visor.removeAttribute('src'); } painel.remove(); cartao.classList.remove('ac-ampliado'); gatilho.setAttribute('aria-expanded', 'false'); fechadores.delete(cartao); });
    cartao.classList.add('ac-ampliado');
    gatilho.setAttribute('aria-expanded', 'true');
    ($('.ac-botoes', cartao) || $('.ac-corpo', cartao)).after(painel);
    painel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    carregarBiblioteca().then(() => {
      if (!painel.isConnected) return;
      visor = document.createElement('model-viewer');
      for (const [chave, valor] of Object.entries({
        'camera-controls': '', 'touch-action': 'pan-y', 'shadow-intensity': '1', exposure: '1.1',
        'camera-orbit': '-35deg 60deg auto', 'interaction-prompt': 'none', 'aria-label': `Modelo 3D de ${titulo}`,
      })) visor.setAttribute(chave, valor);
      const poster = $('img[data-ac-img]', cartao);
      if (poster) visor.setAttribute('poster', poster.currentSrc || poster.src);
      visor.alt = `Modelo 3D: ${titulo}`;
      visor.addEventListener('load', () => {
        aviso.hidden = true;
        const lista = visor.availableAnimations || [];
        animacoes.replaceChildren(...lista.map(nome => new Option(nome.split('|').pop(), nome)));
        rotuloAnimacao.hidden = lista.length === 0;
        if (lista.length) { visor.animationName = lista[0]; animacoes.value = lista[0]; visor.play(); }
      });
      visor.addEventListener('error', () => { aviso.hidden = false; aviso.textContent = 'Não foi possível abrir este modelo aqui. Use "Baixar GLB".'; });
      animacoes.addEventListener('change', () => { visor.animationName = animacoes.value; visor.play(); });
      visor.src = arquivo;
      painel.append(visor);
    }).catch(() => {
      if (!painel.isConnected) return;
      aviso.hidden = false;
      aviso.textContent = `Visualizador 3D indisponível: não encontrei ${raiz.dataset.acLib || 'lib/model-viewer-umd.min.js'} no card. Use "Baixar GLB".`;
    });
  }

  raiz.addEventListener('click', evento => {
    const comparar = evento.target.closest('[data-ac-comparar]');
    if (comparar && raiz.contains(comparar)) {
      const cartao = comparar.closest('.ac-item');
      if (fechadores.has(cartao) && comparar.getAttribute('aria-expanded') === 'true') fecharPainel(cartao);
      else abrirComparar(cartao, comparar);
      return;
    }
    const agente = evento.target.closest('[data-ac-agente]');
    if (agente && raiz.contains(agente)) { pedirAoAgente(agente); return; }
    const tres = evento.target.closest('[data-ac-3d]');
    if (tres && raiz.contains(tres)) {
      const cartao = tres.closest('.ac-item');
      if (fechadores.has(cartao) && tres.getAttribute('aria-expanded') === 'true') fecharPainel(cartao);
      else abrir3D(cartao, tres);
    }
  });

  // "Enviar ao agente" e "Gerar variação": o app do Mr. Mak recebe o item e o
  // manda para o chat selecionado do projeto. Fora do app não há para onde mandar.
  const pedidos = new Map();
  function pedirAoAgente(botao) {
    const aviso = botao.closest('.ac-item').querySelector('[data-ac-aviso]');
    const mostrar = texto => { if (aviso) { aviso.hidden = false; aviso.textContent = texto; } };
    if (window.parent === window) { mostrar('Abra este card no Mr. Mak para mandar o item a um agente.'); return; }
    const id = `ac-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pedidos.set(id, { botao, mostrar });
    botao.disabled = true;
    mostrar(botao.dataset.acAgente === 'variacao' ? 'Pedindo a variação ao agente…' : 'Enviando ao agente…');
    window.parent.postMessage({ type: 'mrmak:asset-request', id, action: botao.dataset.acAgente === 'variacao' ? 'variation' : 'send', asset: JSON.parse(botao.dataset.ativo) }, '*');
  }
  window.addEventListener('message', evento => {
    const dados = evento.data;
    if (evento.source !== window.parent || !dados || dados.type !== 'mrmak:asset-response' || !pedidos.has(dados.id)) return;
    const { botao, mostrar } = pedidos.get(dados.id);
    pedidos.delete(dados.id); botao.disabled = false;
    mostrar(dados.ok ? dados.text : `Não foi possível enviar: ${dados.error}`);
  });

  aplicar();
  irParaItem();
})();

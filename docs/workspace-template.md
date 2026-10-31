# Template modular dos cards do Workspace

Decisões da entrevista de 2026-10-17. Fases 1 a 4 (motor e app; Global Empires, Blended, Mashup, Lightkeeper e Ritualistic) implementadas em 2026-10-17 e a fase 5 (skill `atualizar-workspace`) em 2026-10-21. O template está completo.
Projetos cobertos: Global Empires, Blended, Mashup, Lightkeeper, Ritualistic.

## Estrutura

- **Confirmada:** um motor compartilhado em `workspace/_shared/`. Cada card vira só um `projeto.json` e uma pasta `media/`.
- **Confirmada:** núcleo fixo de abas (Painel, Entregas, Decisões, Arquivo) mais módulos ligados por projeto: Acervo, Playtest, Riscos, Roteiro, Pipeline, Métricas e uma página livre para o que nenhum módulo cobre.
- **Confirmada:** o mesmo conteúdo usa o mesmo módulo e o mesmo nome de aba em todos os projetos.
- **Confirmada:** os cards ficam em português. É uma exceção registrada à regra "Workspace em inglês" do `AGENTS.md`.
- **Confirmada:** a aba Decisões é gerada a partir do registro de decisões do repositório do projeto, com resumo por tema e o que espera aprovação.
- **Confirmada:** uma skill genérica `atualizar-workspace` no repositório, mais uma ficha curta por projeto. Ela substitui `atualizar-workspace-ge` e `atualizar-workspace-blended`.
  - Implantado: a skill está em `.agents/skills/atualizar-workspace/`, com as fichas em `references/`. Uma entrada global de mesmo nome (`~/.claude/skills` e `~/.agents/skills`) só aponta para ela, para os bots que trabalham nos repositórios dos jogos.
  - As duas skills antigas foram para `E:\Backups\Skills\aposentadas-2026-10-21\`.
  - O `LEIA-ME.md` de cada card aponta para a ficha.
- **Confirmada:** projetos de fora (Lightkeeper, Ritualistic) têm um script coletor que lê git, tags, changelog e capturas e preenche o JSON do card.

## Visual

- **Confirmada:** tema base neutro, que segue o claro e escuro do app, com faixa de capa com imagem, molduras finas e ícones. Cada projeto troca a cor de destaque e a capa.
- **Confirmada:** o Global Empires mantém o tema próprio escuro como exceção (`data-mak-theme="custom"`).
- **Confirmada:** o Painel tem esqueleto fixo: capa, barra de números, progresso do marco, "Agora / Com você" e uma tira das últimas imagens.
- **Confirmada:** o card da tela inicial ganha capa, mini barra de progresso e fase atual. Isso exige mudar o app (`WorkspaceEntity` em `src/types.ts` e `MakCard.tsx`).

## Acervo

- **Confirmada:** o Acervo é gerado de um `acervo.json` (item, categoria, família, versão, status, miniatura, original, prompt).
- **Confirmada:** categorias de topo comuns (Personagens, Cenário, Construções/Objetos, Interface, Áudio, Arte-chave). Famílias são livres por projeto, e o projeto pode registrar uma categoria extra na ficha dele.
- **Confirmada:** o item é um asset completo: vistas, 3D, prompt e versões anteriores juntos. Aparece só a versão vigente, e as anteriores ficam num histórico recolhido dentro do item.
- **Confirmada:** status num eixo só: Vigente, Em avaliação, Descartada.
- **Confirmada:** o card guarda só prévias (WebP até 150 KB, GLB até 3 MB) e registra o caminho do original no repositório do jogo.
- **Confirmada:** nomes `media/<categoria>/<família>/<item>-vNN[-vista].webp`, conferidos por script.
- **Confirmada:** mídia órfã ou substituída vai para `E:\Backups\Workspace\<projeto>\`, e um script de checagem acusa órfãos.
- **Confirmada:** o Acervo ganha uma vista "comparar" lado a lado, para todos os projetos.

## Estúdio de assets (2026-10-29)

- **Confirmada:** todo card de jogo tem `"tipo": "jogo"`, `repositorio` e a aba Acervo; o motor recusa um card de jogo sem eles. Cards de pesquisa, de tarefa e de ferramenta ficam como estão.
- **Confirmada:** o item guarda o job da versão vigente em `geracao` (`provedor`, `job`, `modelo`, `data`, `custo`). Sem ele, o item mostra "Sem registro de geração".
- **Confirmada:** cada item tem "Enviar ao agente", que manda caminho do original, prompt e job direto para o chat selecionado do projeto (ou o último usado nele), e "Gerar variação", que pede a nova versão ao agente pela skill de orçamento de créditos.
- **Confirmada:** as skills de geração registram o item no `acervo.json` quando o job termina; `conferir-media.mjs` lista os itens com prompt e sem `geracao`.
- **Confirmada:** `migrar-acervo.mjs` mostra a migração dos cards existentes e só grava com `--gravar`.

## Ordem de implantação

Global Empires primeiro (Acervo e migração), depois Blended, Mashup, Lightkeeper e Ritualistic.

## Por projeto

**Global Empires**
- Abas: Painel, Entregas, Playtest, Decisões, Acervo, Arquivo, mais **Roteiro** (5 eras e iterações, com barra de progresso e a atual destacada; bloco `roteiro` no JSON).
- Playtest mostra só a iteração aberta; as fechadas vão para o Arquivo.
- "Alta fidelidade" e "Modelos 3D" deixam de ser seções e viram vistas dentro do item.
- A migração dos 309 itens do Acervo é feita por um agente, que mostra a tabela antes de trocar a página.
- Capa: uma cena de menu da Primeira Guerra que já existe no Acervo.

**Blended**
- Capturas vira o módulo Acervo, agrupado por tela.
- Nova aba Roteiro com as 16 tarefas do M1, as dependências e as pendências dentro de cada tarefa. Decisões fica só com decisões.
- Playtest some e reaparece no primeiro teste.
- Capa: tela completa no modo escuro (`tela-completo-escuro`).
- Implantado: Acervo com 34 itens na categoria Interface, famílias por tela do editor e Simples/Completo, temas e ângulos como vistas; entraram as 9 capturas do Descrever (PR #13) que faltavam. As 141 pendências abertas ficam dentro da tarefa de origem (as de CI na T1; a ideia do Kimodo na descrição do M3). Roteiro com M1 atual e M2 a M4 futuros. Decisões montadas à mão, com códigos do card por tema, porque `DECISOES.md` é um log. O motor passou a recolher as pendências de uma tarefa quando passam de 3.

**Mashup**
- Abas: Painel, Roteiro (fases 0 a 12 do `PLANO.md`, com a fase 1 detalhada), Entregas, Decisões, Riscos, Métricas.
- Riscos usa o módulo comum com contador calculado (corrige "9 contra 11").
- Toda entrega com resultado visível leva captura, sem o limite de 2 por entrega.
- Capa: `f1-4-mundo-seed1`.
- Implantado: Roteiro com as fases 0 a 13 do `PLANO.md` (o plano tem 14). O Playtest entrou porque a demonstração da fase 1 abriu a primeira iteração, pela mesma regra do Blended. Decisões montadas à mão, com códigos do card por tema, porque `DECISOES.md` é um log sem códigos. A severidade dos riscos foi atribuída no card, porque `PENDENCIAS.md` não a tem.

**Lightkeeper**
- Título "Lightkeeper", sem V3: não há V3 no repositório.
- Abas: Painel, Roteiro (11 níveis e etapas do slice), Entregas (CHANGELOG e PRs) e Acervo. Decisões, Playtest e Riscos aparecem quando houver dado.
- Editores de modelo e mapa e as versões de música cabem no Acervo e no Roteiro, sem abas próprias.
- Implantado com `coletores/lightkeeper.mjs`. O Roteiro tem os 11 níveis; o nível 0 traz as 5 etapas do README e as trilhas dos editores, uma tarefa por PR (20 de 20 feitas: o repositório não diz o que falta). As entregas são os 49 PRs mesclados. O Acervo tem 105 itens de `Concepts/`, das capturas do marco 1 e da música (só a v5). Decisões: as 12 da especificação do editor de modelos e a regra de revisão do `AGENTS.md`. Riscos e Playtest ficam de fora (não há registro).

**Ritualistic**
- Playtest: o coletor extrai os 45 achados `PT-nnn` dos commits, e daqui para frente eles vão para `docs/playtests/`.
- Módulo Pipeline: tabela de etapas por asset (Meshy → Blender → Unreal; armaduras T1 a T5, rigs, criaturas).
- Implantado com `coletores/ritualistic.mjs`. Os commits citam 110 códigos PT distintos com os intervalos expandidos, não 45. Entram como um achado por commit (27), todos corrigidos, agrupados por dia; só a iteração de 11/10 fica aberta. O Roteiro tem as fases 0 a 13 do `Plan.md`, feitas pelas tags `slice-f*`; a fase 12 é a atual. As entregas são uma por fase e uma por dia depois das tags. As decisões são a tabela técnica do `Plan.md` e os códigos DD dos commits. O Pipeline confere arquivos no disco para 5 armaduras (o T5 v1, substituído, sai), 9 criaturas e o jogador. Os textos vindos dos commits em inglês foram reescritos em português e ficam preservados nas próximas coletas.

## Pendente

Nada. A exceção do tema do GE (tema próprio, `data-mak-theme="custom"`) foi confirmada em 2026-10-17.

## Arquitetura do motor (fase 1)

Convenção única: o módulo `x` lê `<card>/x.json` e escreve `<card>/x.html`. O CLI é `node workspace/_shared/engine/gerar.mjs <pasta-do-card> [--hoje AAAA-MM-DD] [--verificar] [--sem-registro]`.

```
workspace/_shared/engine/
  gerar.mjs              CLI: lê projeto.json, roda cada módulo ligado, atualiza o registro
  nucleo/                esc, datas, validação comum, pagina(), registro (relê antes de gravar)
  modulos/               painel, entregas, arquivo, decisoes, roteiro, playtest, riscos,
                         metricas, pipeline, livre, acervo
  tema-base.css          tema neutro (claro/escuro do app), capa, molduras finas, ícones
  acervo.js              filtro, recolher, vista "comparar", visualizador 3D
  coletores/             decisoes-md (registro em Markdown), lightkeeper, ritualistic; comum.mjs (git, miniaturas, mescla)
  conferir-media.mjs     nomes, tamanhos, órfãos; --limpar move órfãos para E:\Backups\Workspace\<id>\
```

Contrato de módulo: `modulos/<nome>.mjs` exporta `validar(dados, ctx)` e `gerar(dados, ctx)`. `ctx` traz `projeto`, `hoje`, `pasta`, `esc(s)`, `dataLonga(d)` e `pagina({ titulo, subtitulo, corpo, scripts })`, que devolve o HTML completo com o cabeçalho "Gerado — não edite à mão", o CSS compartilhado e o tema. `gerar` devolve a string do HTML.

`projeto.json`: `id`, `titulo`, `sobre`, `destaque` (cor), `tema` (`base` ou `custom` + `temaCss`), `capa` (relativo ao card), `janelaDias`, `areas` (`id`, `cor`, `icone`), `categoriasExtras`, `repositorio` (caminho do jogo), `abas` (lista ordenada de `{ modulo, nome }`; módulo ausente = aba omitida). O núcleo fixo é painel, entregas, decisoes e arquivo; as demais abas são opcionais. O módulo `livre` aponta para um HTML escrito à mão.

Dados por módulo:
- `painel.json`: `estado` (texto curto), `numeros` (`rotulo`, `valor`, `icone`), `agora[]`, `comVoce[]`, `links[]`. A faixa de capa vem de `projeto.json`; a tira de imagens recentes e o progresso saem de `entregas.json` e `roteiro.json`.
- `entregas.json`: `entregas[]` com `id`, `data`, `area`, `titulo`, `resumo` (até 280 caracteres), `olhar`, `estado`, `refs[]`, `miniaturas[]` (sem limite de 2), `links[]`. As recentes vão para Entregas, e as com mais de `janelaDias` dias, para Arquivo.
- `roteiro.json`: `fases[]` com `id`, `nome`, `estado` (`feita`, `atual`, `futura`), `itens[]` (`id`, `titulo`, `estado`, `depende[]`, `pendencias[]`). O módulo calcula o progresso (`feito/total`, fase atual).
- `playtest.json`: `iteracoes[]` com `id`, `nome`, `aberta`, `achados[]` (`id`, `tipo`, `titulo`, `estado`). Só a aberta aparece; as fechadas vão para o Arquivo.
- `riscos.json`: `riscos[]` com `id`, `titulo`, `severidade`, `fase`, `dono`, `fechaCom`, `estado`. O contador é calculado.
- `metricas.json`: `marcos[]` com `id`, `nome`, `valores[]` (`rotulo`, `valor`, `unidade`, `meta`).
- `pipeline.json`: `etapas[]` (`id`, `nome`) e `assets[]` (`id`, `nome`, `grupo`, `etapas` por id com `estado`).
- `decisoes.json`: `temas[]` com `nome` e `decisoes[]` (`id`, `titulo`, `estado` `Confirmada` ou `Pendente`, `data`), mais `espera[]` (o que espera aprovação). Preenchido pelo coletor ou pelo agente a partir do registro do repositório do projeto.
- `acervo.json`: `itens[]` com `id`, `nome`, `categoria`, `familia`, `status` (`vigente`, `em-avaliacao`, `descartada`), `versao`, `miniatura`, `vistas[]` (`rotulo`, `arquivo`), `modelo3d`, `original` (caminho no repositório do jogo), `prompt`, `nota`, `historico[]` (`versao`, `miniatura`, `status`, `nota`). Itens com 2 ou mais vistas ganham o botão "comparar".
- `catalogo.json` (opcional): grupos de conteúdo por domínio/mod, cada um com resumo e registros ilustrados. Cada registro contém atributos tipados com valor `atual` (ou `null` quando indefinido), unidade e origem. O formulário cria propostas separadas; **Exportar ajustes** entrega JSON versionado para replicação no projeto. Importação valida IDs, tipos e a referência atual; não aplica código. Contrato completo em `workspace/_shared/engine/modulos/catalogo.mjs`. O rascunho do navegador não substitui o arquivo exportado.

Categorias comuns: `personagens`, `cenario`, `construcoes-objetos`, `interface`, `audio`, `arte-chave`; mais as de `categoriasExtras`. Nome de mídia: `media/<categoria>/<familia>/<item>-vNN[-vista].webp`.

Registro: o motor grava em `workspace/workspace.json`, para o card, `updated`, `steps` (na ordem de `abas`), `cover`, `progress` (`done`, `total`, `label`) e `phase`. O app mostra esses campos no card da tela inicial.

Fases seguintes: (1) motor + app + Global Empires; (2) Blended; (3) Mashup; (4) Lightkeeper e Ritualistic com coletores; (5) skill genérica `atualizar-workspace`, que substitui as duas skills atuais.

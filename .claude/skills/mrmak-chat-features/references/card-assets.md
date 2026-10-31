# Workspace card assets

Each game project's Workspace card has an Acervo tab listing its assets. Two
buttons on an item send it to the selected chat of that project:

- **Enviar ao agente** (Send to agent) points you to the asset and ends with
  "Wait for my instructions about it." Read the asset's original file when the
  next instruction needs it, and do nothing else until that instruction comes.
- **Gerar variação** (Generate variation) asks for a new generation.

The message lists the asset's name, ID, version, category, status, original
file, prompt and generation record (`provider job <id>, model <id>, date, cost`).
`Card: workspace/<card>` is relative to the Mr. Mak repository, not to this
project: the asset list is `<mrmak>/workspace/<card>/acervo.json`.

## Generating a variation

1. Read the item in `acervo.json`, its original file and prompt.
2. Use the same provider and model when the generation record names them, with
   the provider's skill: `fal-ai-generation`, `higgsfield-workflow`,
   `game-audio-workflow` or `image-reference-workflow`. When there is no record,
   propose a provider and model.
3. Follow the credit-budget skill (`orcamento-creditos`): give the estimated
   cost and the balance, and ask the owner before any paid job.
4. Keep the job ID as soon as the provider returns it. After a timeout, resume
   that job instead of submitting a new one.
5. When the job finishes, add the result as the item's next version through
   the `atualizar-workspace` skill: raise `versao`, move the previous version to
   `historico`, name the file `media/<categoria>/<familia>/<item>-vNN[-vista].webp`
   and record `geracao: { provedor, job, modelo, data, custo }` (`data` as
   `AAAA-MM-DD`, `custo` in credits when known). Card text stays in Brazilian
   Portuguese.
6. From `<mrmak>`, run `node workspace/_shared/engine/gerar.mjs workspace/<card> --verificar`,
   then without `--verificar`, then
   `node workspace/_shared/engine/conferir-media.mjs workspace/<card>`, which
   must end with "tudo em ordem" and lists generated files with no record.
7. Show the owner the new version beside the previous one and link the card.

A new version is `em-avaliacao` until the owner approves it; only then does it
become `vigente`. Keep the original output at the path the item records, outside
the card's `media/` previews.

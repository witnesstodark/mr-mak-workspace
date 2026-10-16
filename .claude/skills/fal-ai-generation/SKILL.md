---
name: fal-ai-generation
description: Generate and edit images, create video, audio, 3D assets or material maps through fal.ai MCP or the Python queue client. Use for fal model discovery, reference uploads, generation, recovery and local delivery.
---

# fal.ai generation

Turn the user's brief and supplied references into downloaded, reviewed assets.
Use the connected fal.ai MCP when available. The included Python helper handles
local uploads and queue recovery when MCP cannot access the local filesystem.
This skill and its relative resources can be copied into another project.

## Choose the operation

Distinguish concept exploration, faithful editing, reference-sheet preparation,
motion generation, mesh generation and material creation. Preserve a selected
provider, model, accepted image, pose, camera and requested output count.
An edit changes the requested feature; it does not redesign the whole asset.

When no model is selected, call `recommend_model` with the actual task. Then read
`get_model_schema` for the exact endpoint. Similar display names on different
providers are not interchangeable endpoint IDs. Inspect pricing for the planned
batch, especially video or 3D; use existing task authorization without asking
again for already-approved work. Defaults in an old script are not a model choice.

Read [MCP calls](references/mcp-workflow.md) for parameter examples and recovery.
Read [prompting and review](references/prompting-and-review.md) for concept,
reference-edit and material decisions. Read [setup](references/setup.md) when
connecting another machine. Each recipient uses their own account and credentials.

## Run and retain the job

1. Inspect the selected input files. Upload only the references needed for the
   requested task. A hosted MCP cannot read a local file path: use the upload
   helper or a client-side upload tool, then pass the resulting URL.
2. Prepare inputs from the live schema. Fields such as `image_urls`, `image_url`,
   `aspect_ratio`, `image_size`, `resolution` and duration differ by endpoint.
   Do not pass every model the same argument object. Do not add web search,
   background removal, extra views or video unless they serve this task.
3. Prefer `submit_job` for long operations; `run_model` is convenient for images.
   Immediately save endpoint, request ID, returned status/result URLs and the
   input parameters in the task directory. `processing` is normal, not failure.
4. Continue with `check_job`, then `get_job_result` when complete. Prefer the
   canonical URLs returned by the service. A wait timeout does not authorize a
   duplicate submission. A terminal result can still contain a provider error.
   If submission returned no ID, inspect request history before trying again.
5. Download the outputs before relying on a CDN link. Inspect each requested
   asset, preserve rejected takes with their reasons, and make the chosen result
   easy to open and download. Record technical completion separately from visual
   acceptance. A generated mesh still needs its own rig/topology/export checks.

Keep the prompt, source filenames or hashes, model ID, request ID, local outputs
and review verdict together. Credentials and raw signed links do not belong in a
shareable report. In Mr. Mak, use the current Workspace card and its shared image
viewer; elsewhere use the recipient's requested output directory.

## Included tools and examples

- [Queue helper](scripts/fal_job.py): `--help`, upload, submit, status and result
  download. One receipt per job; an existing receipt blocks another submission.
- [Python dependencies](scripts/requirements.txt).
- [Concept input](examples/concept.json) and [edit input](examples/edit.json):
  neutral requests, with no private artwork or working account URLs.
- [Example task](examples/WALKTHROUGH.md): a non-spending rehearsal followed by
  the commands for an explicitly requested generation.

Resolve these paths against this skill directory. Run `--help` or `submit
--dry-run` to check installation without a generation. Runtime keys come from
the environment or an explicitly selected `.env`; never print their values.

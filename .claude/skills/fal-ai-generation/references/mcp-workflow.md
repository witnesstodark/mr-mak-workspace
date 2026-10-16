# MCP workflow

These are tool names exposed by the connected fal.ai server on September 15,
2026. A host can prefix them with its connector name. Discover the available
tools instead of depending on a particular host prefix.

| Stage | Tool | Essential inputs |
| --- | --- | --- |
| Choose a model when none was selected | `recommend_model` | `task` |
| Find a named model or operation | `search_models` | Query/category supported by that connection |
| Inspect inputs and outputs | `get_model_schema` | `endpoint_id` |
| Estimate a batch | `get_pricing` | Endpoint and parameters accepted by its current schema |
| Prepare a public reference | `upload_file` | `url`, or supported small inline upload |
| Submit and briefly wait | `run_model` | `endpoint_id`, `input` |
| Submit without waiting | `submit_job` | `endpoint_id`, `input` |
| Inspect the same request | `check_job` | `endpoint_id`, `request_id`, returned `status_url` when available |
| Retrieve the completed result | `get_job_result` | `endpoint_id`, `request_id`, returned `response_url` when available |

## Other verified routes

Read-only schema checks on September 15, 2026 also confirmed:

- `fal-ai/patina/material`: text-driven material generation. The required field
  is `prompt`; the schema includes `maps`, `image_size`, `tiling_mode` and
  `output_format`. This differs from `fal-ai/patina`, which processes an image.
- `tripo3d/h3.1/image-to-3d`: `image_url` is required. Geometry/texture quality,
  PBR, orientation and face limit are separate controls. Its result can contain
  a model mesh, alternative model URLs and a rendered image.

These routes illustrate why inputs must follow the actual operation. Model
availability, price and parameter limits should be checked when the task runs.

## Example: one faithful image edit

The user has explicitly chosen Nano Banana Pro and supplied an image. Inspect
`fal-ai/nano-banana-pro/edit` with `get_model_schema`, upload that image, then use
an input such as the following. Replace the example URL with your actual upload.

```json
{
  "endpoint_id": "fal-ai/nano-banana-pro/edit",
  "input": {
    "prompt": "Keep the same object, proportions, camera, background and lighting. Change only the blue painted panels to muted green. Preserve unpainted metal and all small details.",
    "image_urls": ["https://example.invalid/replace-with-your-upload.png"],
    "aspect_ratio": "auto",
    "resolution": "2K",
    "num_images": 1,
    "output_format": "png"
  }
}
```

The input fields above were checked against the live schema. Recheck at the next
use. They are an example for this endpoint, not a universal image API contract.
Do not submit the placeholder URL. For a new concept, choose the corresponding
text-to-image endpoint; do not accidentally omit references from an edit.

## Local reference upload

For the hosted server, `file_path` is not the agent's local filesystem. Use
(on macOS or Linux, run it with `.venv/bin/python` from [setup](setup.md)):

```text
python scripts/fal_job.py --env /path/to/project/.env upload --file /path/to/reference.png --out /path/to/output/reference-upload.json
```

This calls the official SDK's local-file uploader. Read the returned `url` from
the saved JSON. Large base64 blobs waste conversation space; keep file bytes out
of the chat. An existing public reference URL may be usable directly if the
model accepts it and the host can fetch it. Localhost URLs are not public URLs.

## Recovery

Save `request_id`, endpoint and canonical queue URLs immediately. Poll at a
reasonable interval while keeping the user updated. `IN_QUEUE`, `IN_PROGRESS`
and a tool's `processing` response all mean continue the existing request.
When status is `COMPLETED`, inspect the result for errors before declaring
success. Check all expected outputs; a URL or a completed flag is not visual QA.

A failed download can be retried using the same result. Do not regenerate the
asset to repair a local download. If the original submission outcome is unknown,
inspect the account history before starting another billable request. Cancellation
is a separate user action; do not cancel a slow request without being asked.

## Account and output boundaries

fal's hosted MCP uses a Bearer authorization header. The REST model API uses
`Authorization: Key ...`; the Python SDK reads `FAL_KEY`. Do not swap these
header formats. MCP access does not share the chat application's subscription:
generations use the recipient's fal account.

Sources: [official MCP setup](https://fal.ai/docs/documentation/setting-up/mcp),
[queue API](https://fal.ai/docs/documentation/model-apis/inference/queue),
[Python SDK](https://github.com/fal-ai/fal/tree/main/projects/fal_client).

# Asset delivery evidence

This optional, offline tool records the local input and output files for a Workspace card. Existing cards work without a manifest. The manifest proves only that the selected files still have the recorded size and SHA-256 hash. Visual approval and engine readiness require their own review.

## Build and verify

Use Node.js 22 or newer from the repository root. Edit [examples/plan.json](examples/plan.json) to list files under the root you select. Each file has a relative forward-slash `path`, a short `role`, and `kind` (`input` or `output`). At least one output is required. `card_id` identifies the Workspace card, while `step` is a short milestone name chosen for this delivery.

```sh
node scripts/asset-delivery/manifest.mjs build --plan scripts/asset-delivery/examples/plan.json --root . --out delivery.json
node scripts/asset-delivery/manifest.mjs verify --manifest delivery.json --root .
```

The first command creates `delivery.json`; it refuses to overwrite an existing file. Omit `--out` to print the manifest to stdout. Verification only reads the manifest and selected files, reports any missing or changed file, and exits with a nonzero status on failure. The checked-in [example manifest](examples/manifest.json) can be verified with the second command after replacing `delivery.json` with its path. Run `npm run test:assets` for the CLI tests.

The [JSON Schema](schema-v1.json) describes the manifest format. The CLI also checks relative paths, duplicates, regular files, and whether symlinks or Windows junctions resolve outside the selected root. Keep files stable while building or verifying a manifest; the CLI does not lock the filesystem against concurrent changes.

Compare against a manifest you trust: this format has no signature and does not authenticate the file author or provider. The text fixtures use LF endings through `.gitattributes` so Git checkout on Windows and Linux preserves the bytes recorded in the example manifest.

`provider`, `model`, and `receipt_id` are optional. Use only a non-secret receipt ID. Do not include credentials, signed URLs, raw provider responses, or private content in these fields. The CLI rejects unknown fields, URLs in these metadata fields, and several common token prefixes, but you must review a manifest before sharing it. Paths and hashes can disclose information about your project even when the files themselves are not included.

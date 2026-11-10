# Anonymo

Desktop app (Windows, macOS, Linux) that anonymizes **PDF, Word (.docx) and Excel (.xlsx)** files
before an accountant pastes them into ChatGPT or Claude. Drag & drop, tick what to hide, click
**Anonymizovať**. Everything runs **offline**: no API calls, no telemetry, nothing stored besides
the anonymized output files.

```
Ján Novák, r. č. 850101/0001, IBAN SK31 1200 …   →   [OSOBA_1], r. č. [RODNE_CISLO_1], IBAN [IBAN_1]
```

The same value always maps to the same placeholder across all files in a batch, including Slovak
inflections ("Novák / Nováka / Novákovi" → `[OSOBA_1]`), so the AI still understands who is who.

## Stack

| Part | Tech |
| --- | --- |
| Shell | Electron + electron-vite, TypeScript everywhere |
| UI | React 19, Tailwind v4, colours/fonts from shanoon.sk, Slovak copy (`src/renderer/src/i18n.ts`) |
| Detection | Presidio-style engine in TS: regex + checksum validators (rodné číslo, IČO, DIČ/IČ DPH, IBAN mod 97, Luhn…) + context words + offline NER (`Xenova/bert-base-multilingual-cased-ner-hrl`, int8 ONNX via Transformers.js) |
| DOCX / XLSX | Direct OOXML (JSZip) rewriting, so formatting, formulas, charts and pivots survive. Also covers headers/footers, comments, tracked-change authors, hyperlinks, metadata, sheet names, pivot caches |
| PDF | MuPDF (WASM): **true redaction** (text removed, not covered), placeholder drawn in place, metadata scrubbed, form fields anonymized, optional `.md` text export |
| OCR | tesseract.js with bundled Slovak + English data, for scanned pages; image pixels under the redaction are destroyed |

Processing runs in an Electron `utilityProcess` (`src/main/worker.ts`). The engine (`src/engine/`)
is plain Node/TS with no Electron dependency.

## Privacy guarantees (implemented)

- All non-`file:` network requests are cancelled at the session level; `fetch` is blocked in the worker.
- Models and OCR data ship inside the installer (`resources/`), with remote model loading disabled.
- Files are processed in memory. No temp files, no logs with content, and the placeholder map is discarded after each job.
- Chromium caches and storage are wiped on quit; spell-check downloads, background networking and crash reporting are disabled.

## Development

```bash
npm install
npm run fetch-assets   # one-time: NER model (~180 MB) + OCR data into resources/
npm run dev            # run the app
npm test               # engine + DOCX/XLSX/PDF/OCR round-trip tests
npm run e2e            # launches the real Electron app and anonymizes through the UI
npm run build:win      # NSIS installer → dist/  (build on Windows or via CI, see below)
```

Installers are built per OS by `.github/workflows/build.yml` (push a `v*` tag). Native modules
(onnxruntime, sharp) must match the target OS, so the Windows installer should come from the Windows
runner. An `afterPack` hook strips runtime binaries for other platforms.

**Code signing:** unsigned Windows installers trigger SmartScreen warnings. Configure Azure Trusted
Signing (or a .pfx certificate) in `electron-builder.yml` before distributing.

## License

AGPL-3.0-or-later. Required by MuPDF (AGPL). Free distribution is fine, but the source code must stay
available to users.

## Distribution (Cloudflare)

Installers live in the R2 bucket `anonymo` under `v<version>/` and are served by the Worker in
`download-worker/` at https://anonymo.shanoon.workers.dev (download page, `/windows`, `/mac`,
resumable downloads, edge-cached). Free tier covers this usage (R2 egress is free).

Release a new version: bump `"version"` in `package.json`, commit, then tag and push:

```bash
git tag v<version> && git push origin v<version>
```

`.github/workflows/release.yml` then builds the installers (via `build.yml`), uploads the `.exe`,
the `.dmg` and `SHA256SUMS.txt` to R2 under `v<version>/`, and redeploys the worker with
`--var VERSION:<version>`, so `/windows` and `/mac` point at the new files. It refuses to run if the
tag doesn't match `package.json` or the version is already in R2. It needs the secrets
`CLOUDFLARE_API_TOKEN` (Workers R2 Storage: Edit + Workers Scripts: Edit) and `CLOUDFLARE_ACCOUNT_ID`.

Manual fallback, from `dist/`:

```bash
shasum -a 256 *.exe *.dmg > SHA256SUMS.txt
for f in *.exe *.dmg SHA256SUMS.txt; do
  npx wrangler r2 object put "anonymo/v<version>/$f" --file "$f" --remote \
    --content-disposition "attachment; filename=\"$f\""
done
cd ../download-worker && npx wrangler deploy --var VERSION:<version>
```

`wrangler r2 object put` accepts files up to 300 MiB; the DMG uses LZFSE compression to stay below it.

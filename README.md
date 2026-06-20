# Evernote ScanSnap Classifier

MIT-licensed local web UI for reviewing ScanSnap imports in Evernote before applying titles, tags, and notebook moves through the Evernote MCP API.

## Development

```bash
npm run dev
npm test
```

The UI runs at `http://127.0.0.1:5175` and expects the Evernote MCP API at `http://127.0.0.1:8080` unless `EVERNOTE_MCP_API_BASE` is set.

This project requires [Evernote MCP Server](https://github.com/jonmlevine/evernote-mcp-server) `3.1.0` or newer. Start that sibling service with `npm run api` before loading candidates in the classifier UI.

## Local Configuration

`npm run dev` and `npm start` source `~/.config/evernote-scansnap-classifier/env` before starting the server. Use that file for local-only settings such as API keys and path overrides. To use a different file for one run, set `SCANSNAP_ENV_FILE=/path/to/env`.
If candidate loading is slow against your Evernote account, increase `SCANSNAP_LIST_NOTES_TIMEOUT_MS` from the default `30000`.

Backend OCR is preferred, but matching local OCR text files under `SCANSNAP_LOCAL_OCR_DIR` are merged in when they add missing text such as second-page policy details. Local OCR filenames can match a note ID, sanitized note title, resource ID, or sanitized attachment filename, with `.txt` or `.ocr.txt` suffixes.

When backend OCR references a back page that is missing from the OCR payload, PDF attachments can be OCRed locally and cached under `SCANSNAP_PDF_OCR_CACHE_DIR`. On macOS this defaults to `/usr/bin/swift scripts/pdf-ocr-macos.swift`, which uses Apple Vision. Set `SCANSNAP_PDF_OCR_COMMAND=` to disable this fallback, or set `SCANSNAP_PDF_OCR_TIMEOUT_MS` for slower documents.

## Attachment Previews

PDF and common image attachments are displayed directly. Microsoft Office-type attachments, including Word (`.doc`, `.docx`), Excel (`.xls`, `.xlsx`), and PowerPoint (`.ppt`, `.pptx`) files, are converted to PDF for preview with LibreOffice in headless mode. The app uses `soffice` when available, auto-detects the standard macOS LibreOffice app path, and can be pointed at a custom binary with `SCANSNAP_OFFICE_CONVERTER_COMMAND`.

## LLM Classification

Rules and learned exact matches remain the default. To try the LLM classification workflow for low-confidence fallback guesses, set:

```bash
SCANSNAP_LLM_ENABLED=true
SCANSNAP_LLM_API_KEY=...
SCANSNAP_LLM_MODEL=gpt-4.1-mini
SCANSNAP_LLM_TIMEOUT_MS=600000
```

The adapter calls an OpenAI-compatible `/chat/completions` endpoint and can be pointed at another compatible service with `SCANSNAP_LLM_API_BASE`. The workflow runs a classification agent first, then a verification agent that rejects ScanSnap placeholder titles, OCR noise, missing notebooks, or low-confidence outputs before falling back to the deterministic suggestion.

The review UI includes an editable LLM model field plus a `Run LLM` button for the selected note. It keeps the deterministic suggestion in the form, fetches a separate LLM suggestion on demand, and lets the reviewer choose either result before applying the Evernote update. Applying an LLM-selected result appends a row to `SCANSNAP_CLASSIFICATION_PATTERNS.md` so the deterministic engine can learn from that choice.

### LM Studio Comparison

Start the LM Studio local server, load the models you want to test, then compare them with:

```bash
npm run compare:llm
```

The comparison command sources the same local env file as the server and defaults to:

```bash
SCANSNAP_LLM_API_BASE=http://127.0.0.1:1234/v1
SCANSNAP_LLM_API_KEY=lm-studio
SCANSNAP_LLM_RESPONSE_FORMAT=json_schema
SCANSNAP_LLM_DISABLE_THINKING=true
SCANSNAP_LLM_COMPARE_MODELS=qwen-3.6-27b,gemma-4-31b
SCANSNAP_LLM_TIMEOUT_MS=600000
```

For single-model local runs, set both the UI model and comparison model to the loaded model:

```bash
SCANSNAP_LLM_MODEL=gemma-4-31b
SCANSNAP_LLM_COMPARE_MODELS=gemma-4-31b
```

Use exact LM Studio model IDs if they differ locally:

```bash
npm run compare:llm -- --models qwen-3.6-27b,gemma-4-31b --limit 5
npm run compare:llm -- --models qwen/qwen3.6-27b --limit 3 --ocr-chars 4000 --max-examples 0
npm run compare:llm -- --notes note-guid-1,note-guid-2
```

If your machine cannot keep both local models loaded, run one model at a time. For example:

```bash
SCANSNAP_LLM_COMPARE_MODELS=gemma-4-31b npm run compare:llm -- --limit 5
SCANSNAP_LLM_COMPARE_MODELS=qwen-3.6-27b npm run compare:llm -- --limit 5
```

The command prints each model's verified title, tags, notebook, confidence, elapsed time, and reason without printing OCR text.
The LLM payload includes a configurable OCR sample plus deterministic rule-engine context: the current note's match tokens, suggested tags, suggested notebooks, and the complete rule-engine choice set of candidate tags, candidate notebooks, and strong match tokens.

## Private Data

Real ScanSnap correction logs, tests with personal note data, and private classification rules live under `private/`, which is intended to be a separate private Git submodule. Use `scripts/init-private-stubs.sh` to create placeholder files when the private submodule is unavailable.

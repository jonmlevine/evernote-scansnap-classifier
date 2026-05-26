# Repository Guidelines

## Project Structure & Module Organization

This repository contains a local MVC web app for reviewing ScanSnap imports in Evernote.

- `src/server.js` creates the HTTP server and wires dependencies.
- `src/controllers/` contains API and static-file controllers.
- `src/models/` contains MCP access, OCR extraction, suggestion logic, local OCR supplementation/fallback, and learning persistence.
- `src/views/` contains response helpers for JSON, errors, and binary previews.
- `public/` contains the browser UI: `index.html`, `app.js`, and `styles.css`.
- `test/` contains public UI/helper tests that do not expose note data.
- `private/` is intended to be a private submodule. It contains `SCANSNAP_CLASSIFICATION_PATTERNS.md`, `classificationRules.js`, and private tests for API routing, model behavior, and learning persistence.

The app depends on the sibling MCP server at `~/Documents/Projects/Evernote-Mcp/evernote-mcp-server`.

## Build, Test, and Development Commands

- `npm test` runs public tests and any private tests present under `private/test/`.
- `npm run test:public` runs only public tests in `test/`.
- `npm run test:private` runs private tests in `private/test/`.
- `npm run dev` starts the local UI server at `http://127.0.0.1:5175`.
- `npm start` runs the same server entry point for non-watch local use.
- `npm run compare:llm` compares LM Studio models against current candidate notes.
- `bash scripts/init-private-stubs.sh` creates stub private files when the private submodule is not installed.

`npm run dev` and `npm start` source `~/.config/evernote-scansnap-classifier/env` before launching the server. Set `SCANSNAP_ENV_FILE=/path/to/env` to use a different local configuration file.

Start the Evernote MCP REST API separately from the sibling repository with `npm run api`; the classifier expects it at `http://127.0.0.1:8080` unless `EVERNOTE_MCP_API_BASE` is set.

Microsoft Office-type attachment previews are converted to PDF with LibreOffice in headless mode. This includes Word, Excel, and PowerPoint files. Install LibreOffice locally or set `SCANSNAP_OFFICE_CONVERTER_COMMAND` to the `soffice` binary path.

## Coding Style & Naming Conventions

Use modern JavaScript ES modules and 2-space indentation. Keep MVC boundaries clear: controllers handle HTTP, models hold business logic and external service adapters, and browser code stays in `public/`.

Use `camelCase` for functions and variables, `PascalCase` for classes, and descriptive filenames such as `reviewNoteModel.js` or `learningStore.js`.

## Testing Guidelines

Tests use `node --test`. Add sanitized public tests in `test/*.test.js`; put tests with real note GUIDs, titles, OCR snippets, or learned classification examples in `private/test/*.test.js`. Prefer fakes and shape-only assertions over live Evernote calls. Live integration checks should avoid printing note titles, OCR text, or personal document contents.

## Configuration & Security

Use environment variables for local paths and endpoints: `EVERNOTE_MCP_API_BASE`, `EVERNOTE_MCP_API_KEY`, `SCANSNAP_LEARNINGS_PATH`, `SCANSNAP_CLASSIFICATION_PATTERNS_PATH`, `SCANSNAP_CLASSIFICATION_RULES_PATH`, `SCANSNAP_SUGGESTIONS_CSV`, `SCANSNAP_LOCAL_OCR_DIR`, `SCANSNAP_PDF_OCR_COMMAND`, `SCANSNAP_PDF_OCR_CACHE_DIR`, `SCANSNAP_OFFICE_CONVERTER_COMMAND`, and `SCANSNAP_OFFICE_PREVIEW_CACHE_DIR`. By default, UI corrections append to `private/SCANSNAP_CLASSIFICATION_PATTERNS.md`, optional private rules load from `private/classificationRules.js`, converted Office preview PDFs are cached under `tmp/office-previews`, and local PDF OCR text is cached under `tmp/pdf-ocr`.

Never commit Evernote tokens, real scanned documents, OCR exports, or personal note data. Store sanitized examples only.

## Pull Request Guidelines

Use concise, imperative commits such as `Add MCP attachment preview`. Pull requests should describe UI/API behavior changes, test results, MCP server assumptions, and any configuration changes.

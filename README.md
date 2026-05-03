# Evernote ScanSnap Classifier

MIT-licensed local web UI for reviewing ScanSnap imports in Evernote before applying titles, tags, and notebook moves through the Evernote MCP API.

## Development

```bash
npm run dev
npm test
```

The UI runs at `http://127.0.0.1:5175` and expects the Evernote MCP API at `http://127.0.0.1:8080` unless `EVERNOTE_MCP_API_BASE` is set.

This project requires [Evernote MCP Server](https://github.com/jonmlevine/evernote-mcp-server) `3.1.0` or newer. Start that sibling service with `npm run api` before loading candidates in the classifier UI.

## Attachment Previews

PDF and common image attachments are displayed directly. Microsoft Office-type attachments, including Word (`.doc`, `.docx`), Excel (`.xls`, `.xlsx`), and PowerPoint (`.ppt`, `.pptx`) files, are converted to PDF for preview with LibreOffice in headless mode. The app uses `soffice` when available, auto-detects the standard macOS LibreOffice app path, and can be pointed at a custom binary with `SCANSNAP_OFFICE_CONVERTER_COMMAND`.

## Private Data

Real ScanSnap correction logs, tests with personal note data, and private classification rules live under `private/`, which is intended to be a separate private Git submodule. Use `scripts/init-private-stubs.sh` to create placeholder files when the private submodule is unavailable.

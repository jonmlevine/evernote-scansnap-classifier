import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const home = homedir();
const mcpServerDir = resolve(home, "Documents/Projects/Evernote-Mcp/evernote-mcp-server");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function defaultOfficeConverterCommand(env) {
  if (env.SCANSNAP_OFFICE_CONVERTER_COMMAND) return env.SCANSNAP_OFFICE_CONVERTER_COMMAND;
  if (env.SCANSNAP_PRESENTATION_CONVERTER_COMMAND) return env.SCANSNAP_PRESENTATION_CONVERTER_COMMAND;
  if (existsSync("/Applications/LibreOffice.app/Contents/MacOS/soffice")) {
    return "/Applications/LibreOffice.app/Contents/MacOS/soffice";
  }
  return "soffice";
}

export function getConfig(env = process.env) {
  return {
    port: Number.parseInt(env.PORT || "5175", 10),
    mcpApiBase: env.EVERNOTE_MCP_API_BASE || "http://127.0.0.1:8080",
    mcpApiKey: env.EVERNOTE_MCP_API_KEY || "",
    mcpServerDir: env.EVERNOTE_MCP_SERVER_DIR || mcpServerDir,
    learningsPath:
      env.SCANSNAP_LEARNINGS_PATH ||
      resolve(home, "Documents/scansnap-title-tag-suggestions.md"),
    classificationPatternsPath:
      env.SCANSNAP_CLASSIFICATION_PATTERNS_PATH ||
      resolve(repoRoot, "private/SCANSNAP_CLASSIFICATION_PATTERNS.md"),
    classificationRulesPath:
      env.SCANSNAP_CLASSIFICATION_RULES_PATH ||
      resolve(repoRoot, "private/classificationRules.js"),
    fallbackLearningsPath:
      env.SCANSNAP_LEARNINGS_FALLBACK_PATH ||
      resolve(mcpServerDir, "scansnap-title-tag-suggestions.md"),
    suggestionsCsvPath:
      env.SCANSNAP_SUGGESTIONS_CSV ||
      resolve(mcpServerDir, "scansnap-title-tag-suggestions.csv"),
    localOcrDir: env.SCANSNAP_LOCAL_OCR_DIR || resolve(home, "Documents/ScanSnap OCR"),
    officePreviewCacheDir:
      env.SCANSNAP_OFFICE_PREVIEW_CACHE_DIR ||
      env.SCANSNAP_PRESENTATION_PREVIEW_CACHE_DIR ||
      resolve(repoRoot, "tmp/office-previews"),
    officeConverterCommand: defaultOfficeConverterCommand(env),
    officeConverterTimeoutMs: Number.parseInt(
      env.SCANSNAP_OFFICE_CONVERTER_TIMEOUT_MS || env.SCANSNAP_PRESENTATION_CONVERTER_TIMEOUT_MS || "30000",
      10
    ),
    maxCandidates: Number.parseInt(env.SCANSNAP_MAX_CANDIDATES || "100", 10),
  };
}

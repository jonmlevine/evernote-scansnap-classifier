import { access, appendFile, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { defaultClassificationRules, mergeClassificationRules } from "./classificationRules.js";
import { normalizeSuggestedTitle } from "./titleNormalization.js";

function splitMarkdownRow(row) {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function unescapeMarkdown(value = "") {
  return value.replace(/\\\|/g, "|").replace(/<br>/g, "; ");
}

function escapeMarkdown(value = "") {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.length)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [headers = [], ...body] = rows;
  return body.map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header.trim(), (cells[index] || "").trim()]))
  );
}

function normalizeTags(tags = "") {
  return tags
    .split(/[;,]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function titleKey(title = "") {
  return String(title).trim().toLowerCase();
}

function exampleFromRecord(record, rules = defaultClassificationRules) {
  const noteId = record.guid || record["Note ID"] || record["Note Id"] || "";
  const originalTitle = record.original_title || record["Original title"] || "";
  const rawSuggestedTitle =
    record["Final title"] ||
    record.suggested_title ||
    record["OCR-based suggested title"] ||
    record["Suggested title"] ||
    "";
  const suggestedNotebook =
    record["Final notebook"] || record.suggested_notebook || record["Suggested notebook"] || "";
  const suggestedTags = normalizeTags(
    record["Final tags"] ||
      record.suggested_tags ||
      record["OCR-based tags"] ||
      record["Suggested tags"] ||
      ""
  );
  const ocrEvidence = record.ocr_evidence || record["OCR cue"] || "";
  const suggestedTitle = normalizeSuggestedTitle(rawSuggestedTitle, {
    tags: suggestedTags,
    ocrText: ocrEvidence,
    rules,
  });

  if (!noteId && !originalTitle && !suggestedTitle) return null;

  return {
    noteId,
    originalTitle,
    suggestedTitle,
    suggestedNotebook,
    suggestedTags,
    ocrEvidence,
    scanDate: record.scan_date || record["Scan date"] || "",
    source: record.guid ? "csv" : "markdown",
  };
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export class LearningStore {
  constructor({ learningsPath, classificationPatternsPath, fallbackLearningsPath, suggestionsCsvPath, rules }) {
    this.learningsPath = learningsPath;
    this.classificationPatternsPath = classificationPatternsPath || learningsPath;
    this.fallbackLearningsPath = fallbackLearningsPath;
    this.suggestionsCsvPath = suggestionsCsvPath;
    this.rules = mergeClassificationRules(rules);
    this.cache = null;
  }

  async load() {
    if (this.cache) return this.cache;

    const examples = [];

    if (this.suggestionsCsvPath && (await exists(this.suggestionsCsvPath))) {
      const csv = await readFile(this.suggestionsCsvPath, "utf8");
      for (const record of parseCsv(csv)) {
        const example = exampleFromRecord(record, this.rules);
        if (example) examples.push(example);
      }
    }

    const markdownPath = (await exists(this.learningsPath))
      ? this.learningsPath
      : this.fallbackLearningsPath;

    if (markdownPath && (await exists(markdownPath))) {
      const markdown = await readFile(markdownPath, "utf8");
      examples.push(...this.parseMarkdownTables(markdown));
    }

    if (
      this.classificationPatternsPath &&
      this.classificationPatternsPath !== markdownPath &&
      (await exists(this.classificationPatternsPath))
    ) {
      const markdown = await readFile(this.classificationPatternsPath, "utf8");
      examples.push(...this.parseMarkdownTables(markdown));
    }

    const byGuid = new Map();
    const byOriginalTitle = new Map();
    for (const example of examples) {
      if (example.noteId) byGuid.set(example.noteId, example);
      if (example.originalTitle) byOriginalTitle.set(titleKey(example.originalTitle), example);
    }

    this.cache = { examples, byGuid, byOriginalTitle };
    return this.cache;
  }

  parseMarkdownTables(markdown) {
    const lines = markdown.split(/\r?\n/);
    const examples = [];

    for (let index = 0; index < lines.length - 1; index += 1) {
      const header = lines[index];
      const divider = lines[index + 1];
      if (!header.trim().startsWith("|") || !/^\s*\|?[-:\s|]+\|?\s*$/.test(divider)) {
        continue;
      }

      const headers = splitMarkdownRow(header);
      index += 2;

      while (index < lines.length && lines[index].trim().startsWith("|")) {
        const values = splitMarkdownRow(lines[index]).map(unescapeMarkdown);
        const record = Object.fromEntries(headers.map((key, cellIndex) => [key, values[cellIndex] || ""]));
        const example = exampleFromRecord(record, this.rules);
        if (example) examples.push(example);
        index += 1;
      }
    }

    return examples;
  }

  async appendLearning({ noteId, original, suggestion, final, ocrSample, changes }) {
    const path = this.classificationPatternsPath;
    await mkdir(dirname(path), { recursive: true });
    const existsAlready = await exists(path);
    const timestamp = new Date().toISOString();
    const header = existsAlready
      ? ""
      : "# ScanSnap Classification Patterns\n\n" +
        "This file is updated by the review UI when user-applied changes differ from the initial suggestion.\n\n";
    const section =
      "## UI Correction Log\n\n" +
      "| Timestamp | Note ID | Original title | Suggested title | Final title | Suggested notebook | Final notebook | Suggested tags | Final tags | Changes | OCR cue |\n" +
      "|---|---|---|---|---|---|---|---|---|---|---|\n";
    const needsSection = !existsAlready || !(await readFile(path, "utf8")).includes("## UI Correction Log");
    const row = [
      timestamp,
      noteId,
      original?.title || "",
      suggestion?.title || "",
      final?.title || "",
      suggestion?.notebook || "",
      final?.notebook || "",
      (suggestion?.tags || []).join("; "),
      (final?.tags || []).join("; "),
      changes.join(", "),
      ocrSample || "",
    ]
      .map(escapeMarkdown)
      .join(" | ");

    await appendFile(
      path,
      `${header}${needsSection ? section : ""}| ${row} |\n`,
      "utf8"
    );
    this.cache = null;
  }
}

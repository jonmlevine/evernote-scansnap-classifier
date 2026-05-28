import { isScanSnapImportTitle } from "./titleNormalization.js";
import { normalizeClassificationResult } from "./classificationAgent.js";

function stringArray(value = []) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : String(value || "")
        .split(/[;,]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function truncateText(value = "", maxChars = 6000) {
  const text = String(value || "");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[truncated]` : text;
}

function systemPrompt(baseInstructions = [], ruleEngineContext = {}, instructionKey = "") {
  return [
    ...baseInstructions,
    ...stringArray(ruleEngineContext.instructions),
    ...stringArray(ruleEngineContext[instructionKey]),
  ].join(" ");
}

export function suggestionGuardrailIssues(suggestion = {}, note = {}) {
  const issues = [];
  const title = String(suggestion.title || "").trim();
  if (!title) issues.push("missing title");
  if (isScanSnapImportTitle(title)) issues.push("title is a ScanSnap import placeholder");
  if (title && note.title && title.trim().toLowerCase() === String(note.title).trim().toLowerCase()) {
    issues.push("title repeats current import title");
  }
  if (!String(suggestion.notebook || "").trim()) issues.push("missing notebook");
  if (!Array.isArray(suggestion.tags)) issues.push("tags must be an array");
  return issues;
}

export function normalizeVerificationResult(payload = {}, originalSuggestion = {}) {
  const accepted = Boolean(payload.accepted);
  const candidate = normalizeClassificationResult({
    ...originalSuggestion,
    ...payload,
    title: payload.title || originalSuggestion.title,
    tags: payload.tags || originalSuggestion.tags,
    notebook: payload.notebook || originalSuggestion.notebook,
    confidence: payload.confidence ?? originalSuggestion.confidence,
    reason: payload.reason || originalSuggestion.reason,
  });

  return {
    ...candidate,
    accepted,
    issues: stringArray(payload.issues),
  };
}

export class VerificationAgent {
  constructor({ llmClient, maxOcrChars = 6000 } = {}) {
    this.llmClient = llmClient;
    this.maxOcrChars = maxOcrChars;
  }

  async verify({ note, ocrText = "", suggestion, ruleEngineContext = {}, notebooks = [], tags = [] }) {
    const localIssues = suggestionGuardrailIssues(suggestion, note);
    if (localIssues.length) {
      return { ...suggestion, accepted: false, issues: localIssues };
    }

    const payload = {
      note: {
        id: note.id || note.noteId || "",
        currentTitle: note.title || "",
      },
      ocrText: truncateText(ocrText, this.maxOcrChars),
      suggestion,
      ruleEngine: ruleEngineContext,
      existingNotebooks: notebooks.map((notebook) => notebook.name).filter(Boolean),
      existingTags: tags.map((tag) => tag.name).filter(Boolean),
    };

    const baseSystemInstructions = [
      "You verify a proposed classification for an Evernote ScanSnap import.",
      "Return only JSON with accepted, title, tags, notebook, confidence, reason, and issues.",
      "The response must be syntactically valid JSON; escape quotation marks and newlines inside string values, and keep issues and reasons short.",
      "Reject titles that are ScanSnap import placeholders, OCR noise, or use the import date instead of the document date.",
      "Correct minor title, tag, or notebook issues when the OCR evidence is clear.",
      "For medical approval or prior authorization letters, prefer Person Insurer Service Approval Month Year titles and require the title to start with the patient/customer first name from OCR.",
      "For invoices and receipts, prefer concise Vendor Invoice Month Year or Vendor Receipt Month Year titles and remove invoice numbers unless they are needed to distinguish duplicate documents.",
      "For travel or business invoices, verify business, client, and tax-routing tags and notebooks against ruleEngine.instructions and OCR evidence.",
      "Treat ruleEngine.instructions as strict local filing rules when present.",
      "Use the ruleEngine suggestedTags, suggestedNotebooks, and choiceSet candidateTags/candidateNotebooks as a strong prior unless OCR evidence clearly contradicts them.",
    ];

    const result = await this.llmClient.completeJson({
      system: systemPrompt(baseSystemInstructions, ruleEngineContext, "verifierInstructions"),
      user: JSON.stringify(payload),
      temperature: 0,
      maxTokens: 900,
    });

    const verified = normalizeVerificationResult(result, suggestion);
    const issues = suggestionGuardrailIssues(verified, note);
    if (issues.length) return { ...verified, accepted: false, issues: [...verified.issues, ...issues] };
    return verified;
  }
}

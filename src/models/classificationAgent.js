function truncateText(value = "", maxChars = 12000) {
  const text = String(value || "");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[truncated]` : text;
}

function stringArray(value = []) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : String(value || "")
        .split(/[;,]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function clampConfidence(value, fallback = 0.65) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

export function normalizeClassificationResult(payload = {}) {
  const title = String(payload.title || "").trim();
  const notebook = String(payload.notebook || "").trim();
  const tags = [...new Set(stringArray(payload.tags))];
  if (!title) throw new Error("LLM classification did not return a title");
  if (!notebook) throw new Error("LLM classification did not return a notebook");

  return {
    title,
    tags,
    notebook,
    confidence: clampConfidence(payload.confidence),
    reason: String(payload.reason || "LLM classification").trim(),
    evidence: stringArray(payload.evidence).slice(0, 6),
  };
}

function compactExample(example = {}) {
  return {
    originalTitle: example.originalTitle || "",
    suggestedTitle: example.suggestedTitle || "",
    suggestedTags: stringArray(example.suggestedTags),
    suggestedNotebook: example.suggestedNotebook || "",
    evidence: truncateText(example.ocrEvidence || "", 400),
  };
}

function systemPrompt(baseInstructions = [], ruleEngineContext = {}, instructionKey = "") {
  return [
    ...baseInstructions,
    ...stringArray(ruleEngineContext.instructions),
    ...stringArray(ruleEngineContext[instructionKey]),
  ].join(" ");
}

export class ClassificationAgent {
  constructor({ llmClient, maxOcrChars = 12000, maxExamples = 8 } = {}) {
    this.llmClient = llmClient;
    this.maxOcrChars = maxOcrChars;
    this.maxExamples = maxExamples;
  }

  async classify({
    note,
    ocrText = "",
    deterministicSuggestion,
    ruleEngineContext = {},
    examples = [],
    notebooks = [],
    tags = [],
  }) {
    const payload = {
      note: {
        id: note.id || note.noteId || "",
        currentTitle: note.title || "",
      },
      ocrText: truncateText(ocrText, this.maxOcrChars),
      deterministicSuggestion,
      ruleEngine: ruleEngineContext,
      learnedExamples: examples.slice(0, this.maxExamples).map(compactExample),
      existingNotebooks: notebooks.map((notebook) => notebook.name).filter(Boolean),
      existingTags: tags.map((tag) => tag.name).filter(Boolean),
    };

    const baseSystemInstructions = [
      "You classify scanned Evernote documents imported by ScanSnap.",
      "Return only JSON with title, tags, notebook, confidence, reason, and evidence.",
      "The response must be syntactically valid JSON; escape quotation marks and newlines inside string values, and keep evidence snippets short.",
      "Do not return a ScanSnap import title like YYYYMMDD_text.",
      "Use the document OCR for the document date; do not use the import date unless no document date exists.",
      "Prefer existing notebook and tag names when they match the document, but propose new tags when needed.",
      "For statements, include the relevant month and year in the title.",
      "For medical approval or prior authorization letters, use the title format Person Insurer Service Approval Month Year and start the title with the patient/customer first name from OCR.",
      "For invoices and receipts, use a concise title like Vendor Invoice Month Year or Vendor Receipt Month Year; do not include invoice numbers unless needed to distinguish duplicate documents.",
      "For travel or business invoices, preserve explicit business, client, or tax-routing tags and notebooks from ruleEngine.instructions or OCR evidence.",
      "Treat ruleEngine.instructions as strict local filing rules when present.",
      "The ruleEngine field contains deterministic match tokens, the current note's suggestedTags and suggestedNotebooks, and choiceSet candidateTags/candidateNotebooks/strongMatchTokens that the local rules engine can choose from; use it as a strong prior but correct it when OCR evidence contradicts it.",
    ];

    const result = await this.llmClient.completeJson({
      system: systemPrompt(baseSystemInstructions, ruleEngineContext, "classifierInstructions"),
      user: JSON.stringify(payload),
      temperature: 0,
      maxTokens: 1200,
    });

    return normalizeClassificationResult(result);
  }
}

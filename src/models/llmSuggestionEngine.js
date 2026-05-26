function tokens(value = "") {
  return new Set(
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2)
  );
}

function exampleText(example = {}) {
  return [
    example.originalTitle,
    example.suggestedTitle,
    Array.isArray(example.suggestedTags) ? example.suggestedTags.join(" ") : example.suggestedTags,
    example.suggestedNotebook,
    example.ocrEvidence,
  ]
    .filter(Boolean)
    .join(" ");
}

export function selectRelevantExamples(examples = [], note = {}, ocrText = "", limit = 8) {
  const haystack = tokens(`${note.title || ""} ${ocrText}`);
  return [...examples]
    .map((example, index) => {
      const overlap = [...tokens(exampleText(example))].filter((token) => haystack.has(token)).length;
      return { example, score: overlap, index };
    })
    .sort((left, right) => right.score - left.score || right.index - left.index)
    .slice(0, limit)
    .map((entry) => entry.example);
}

export class LlmSuggestionEngine {
  constructor({
    deterministicEngine,
    learningStore,
    harness,
    maxExamples = 8,
    deterministicConfidenceThreshold = 0.5,
  } = {}) {
    this.deterministicEngine = deterministicEngine;
    this.learningStore = learningStore;
    this.harness = harness;
    this.maxExamples = maxExamples;
    this.deterministicConfidenceThreshold = deterministicConfidenceThreshold;
  }

  shouldUseLlm(deterministicSuggestion) {
    return (
      deterministicSuggestion?.source === "fallback" ||
      Number(deterministicSuggestion?.confidence || 0) < this.deterministicConfidenceThreshold
    );
  }

  async suggestWithLlm(note, ocrText = "", context = {}) {
    const deterministic =
      context.deterministicSuggestion ||
      (await this.deterministicEngine.suggest(note, ocrText, context));
    const { examples = [] } = await this.learningStore.load();
    const ruleEngineContext =
      typeof this.deterministicEngine.ruleContext === "function"
        ? this.deterministicEngine.ruleContext(note, ocrText)
        : {};

    return this.harness.suggest({
      note,
      ocrText,
      deterministicSuggestion: deterministic,
      ruleEngineContext,
      examples: selectRelevantExamples(examples, note, ocrText, this.maxExamples),
      notebooks: context.notebooks || [],
      tags: context.tags || [],
    });
  }

  async suggest(note, ocrText = "", context = {}) {
    const deterministic = await this.deterministicEngine.suggest(note, ocrText, context);
    if (!this.shouldUseLlm(deterministic)) return deterministic;

    try {
      const llmSuggestion = await this.suggestWithLlm(note, ocrText, {
        ...context,
        deterministicSuggestion: deterministic,
      });
      return {
        ...llmSuggestion,
        confidence: Math.max(llmSuggestion.confidence, deterministic.confidence || 0),
        reason: `${llmSuggestion.reason} Verified by LLM classification workflow.`,
      };
    } catch (error) {
      return {
        ...deterministic,
        llmError: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

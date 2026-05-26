#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { ClassificationAgentHarness } from "../src/models/agentHarness.js";
import { ClassificationAgent } from "../src/models/classificationAgent.js";
import { loadClassificationRules } from "../src/models/classificationRules.js";
import { getConfig } from "../src/config.js";
import { OpenAiCompatibleLlmClient } from "../src/models/llmClient.js";
import { selectRelevantExamples } from "../src/models/llmSuggestionEngine.js";
import { VerificationAgent } from "../src/models/verificationAgent.js";
import { createDependencies } from "../src/server.js";

export function splitCsv(value = "") {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseArgs(argv, env = process.env) {
  const options = {
    limit: Number.parseInt(env.SCANSNAP_LLM_COMPARE_LIMIT || "3", 10),
    models: splitCsv(env.SCANSNAP_LLM_COMPARE_MODELS || "qwen-3.6-27b,gemma-4-31b"),
    noteIds: splitCsv(env.SCANSNAP_LLM_COMPARE_NOTE_IDS || ""),
    maxExamples: Number.parseInt(env.SCANSNAP_LLM_MAX_EXAMPLES || "8", 10),
    ocrChars: Number.parseInt(env.SCANSNAP_LLM_MAX_OCR_CHARS || "12000", 10),
    timeoutMs: Number.parseInt(env.SCANSNAP_LLM_TIMEOUT_MS || "600000", 10),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--limit" && next) {
      options.limit = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--models" && next) {
      options.models = splitCsv(next);
      index += 1;
    } else if (arg === "--notes" && next) {
      options.noteIds = splitCsv(next);
      index += 1;
    } else if (arg === "--max-examples" && next) {
      options.maxExamples = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--ocr-chars" && next) {
      options.ocrChars = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--timeout-ms" && next) {
      options.timeoutMs = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
  }

  return options;
}

export function helpText() {
  return `Usage: npm run compare:llm -- [options]

Options:
  --models qwen-3.6-27b,gemma-4-31b   Comma-separated LM Studio model IDs.
  --notes guid1,guid2                  Compare specific Evernote note GUIDs.
  --limit 3                            Number of current candidates to compare.
  --max-examples 8                     Learned examples sent to each model.
  --ocr-chars 12000                    OCR characters sent to each model.
  --timeout-ms 600000                  Per-request timeout.

Environment:
  SCANSNAP_LLM_API_BASE                Defaults to http://127.0.0.1:1234/v1.
  SCANSNAP_LLM_API_KEY                 Defaults to lm-studio.
  SCANSNAP_LLM_COMPARE_MODELS          Defaults to qwen-3.6-27b,gemma-4-31b.
  SCANSNAP_LLM_COMPARE_NOTE_IDS        Optional comma-separated note GUIDs.
`;
}

function printHelp() {
  console.log(helpText());
}

export function formatTags(tags = []) {
  return Array.isArray(tags) && tags.length ? tags.join("; ") : "(none)";
}

export function oneLine(value = "", max = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

export function llmErrorDiagnostics(error) {
  const details = error?.details;
  const diagnostics = [];
  if (details && typeof details === "object") {
    diagnostics.push(`details=${JSON.stringify(details)}`);
  }
  if (error?.rawResponsePreview) {
    diagnostics.push(`rawResponsePreview=${error.rawResponsePreview}`);
  }
  return diagnostics;
}

export async function classifyWithModel({
  model,
  config,
  detail,
  deterministicSuggestion,
  ruleEngineContext = {},
  examples,
  maxExamples,
  timeoutMs,
  fetchImpl = globalThis.fetch,
}) {
  const llmClient = new OpenAiCompatibleLlmClient({
    apiKey: config.llm.apiKey || "lm-studio",
    baseUrl: config.llm.apiBase || "http://127.0.0.1:1234/v1",
    model,
    responseFormat: config.llm.responseFormat,
    disableThinking: config.llm.disableThinking,
    timeoutMs,
    fetchImpl,
  });
  const harness = new ClassificationAgentHarness({
    classificationAgent: new ClassificationAgent({
      llmClient,
      maxOcrChars: config.llm.maxOcrChars,
      maxExamples,
    }),
    verificationAgent: new VerificationAgent({
      llmClient,
      maxOcrChars: Math.min(config.llm.maxOcrChars, 6000),
    }),
  });

  const started = Date.now();
  try {
    const suggestion = await harness.suggest({
      note: detail,
      ocrText: detail.ocr?.text || "",
      deterministicSuggestion,
      ruleEngineContext,
      examples: selectRelevantExamples(examples, detail, detail.ocr?.text || "", maxExamples),
      notebooks: detail.notebooks || [],
      tags: detail.tags || [],
    });
    return { model, ok: true, elapsedMs: Date.now() - started, suggestion };
  } catch (error) {
    return {
      model,
      ok: false,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
      diagnostics: llmErrorDiagnostics(error),
    };
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.models.length) throw new Error("At least one model is required");

  const rawConfig = getConfig();
  const config = {
    ...rawConfig,
    llm: {
      ...rawConfig.llm,
      enabled: false,
      apiKey: rawConfig.llm.apiKey || "lm-studio",
      apiBase: rawConfig.llm.apiBase || "http://127.0.0.1:1234/v1",
      maxOcrChars: options.ocrChars,
    },
  };
  const rules = await loadClassificationRules(config.classificationRulesPath);
  const { reviewModel } = createDependencies(config, { rules });
  const { examples = [] } = await reviewModel.learningStore.load();

  const noteIds = options.noteIds.length
    ? options.noteIds
    : (await reviewModel.listCandidates(options.limit)).map((candidate) => candidate.id);

  console.log(`LM Studio API: ${config.llm.apiBase}`);
  console.log(`Models: ${options.models.join(", ")}`);
  console.log(`Notes: ${noteIds.length}`);

  let failures = 0;
  for (const noteId of noteIds) {
    const detail = await reviewModel.getCandidate(noteId);
    const deterministicSuggestion = detail.suggestion;
    const ruleEngineContext =
      typeof reviewModel.suggestionEngine?.ruleContext === "function"
        ? reviewModel.suggestionEngine.ruleContext(detail, detail.ocr?.text || "")
        : {};

    console.log(`\nNote ${detail.id}`);
    console.log(`Current: ${oneLine(detail.title)}`);
    console.log(
      `Deterministic: ${oneLine(deterministicSuggestion.title)} | ${deterministicSuggestion.notebook || "(no notebook)"} | ${formatTags(deterministicSuggestion.tags)}`
    );
    console.log(
      `Rule engine: ${formatTags(ruleEngineContext.suggestedTags)} | ${formatTags(ruleEngineContext.suggestedNotebooks)} | ${ruleEngineContext.matchTokens?.length || 0} tokens`
    );
    console.log(
      `Rule choices: ${ruleEngineContext.choiceSet?.candidateTags?.length || 0} tags | ${ruleEngineContext.choiceSet?.candidateNotebooks?.length || 0} notebooks`
    );

    const results = [];
    for (const model of options.models) {
      results.push(
        await classifyWithModel({
          model,
          config,
          detail,
          deterministicSuggestion,
          ruleEngineContext,
          examples,
          maxExamples: options.maxExamples,
          timeoutMs: options.timeoutMs,
        })
      );
    }

    for (const result of results) {
      if (!result.ok) {
        failures += 1;
        console.log(`- ${result.model}: ERROR after ${result.elapsedMs}ms`);
        console.log(`  ${oneLine(result.error, 220)}`);
        for (const diagnostic of result.diagnostics || []) {
          console.log(`  ${oneLine(diagnostic, 1200)}`);
        }
        continue;
      }
      const suggestion = result.suggestion;
      console.log(`- ${result.model}: ${Math.round(suggestion.confidence * 100)}% in ${result.elapsedMs}ms`);
      console.log(`  Title: ${oneLine(suggestion.title)}`);
      console.log(`  Notebook: ${suggestion.notebook || "(none)"}`);
      console.log(`  Tags: ${formatTags(suggestion.tags)}`);
      console.log(`  Reason: ${oneLine(suggestion.reason, 220)}`);
    }
  }

  if (failures) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

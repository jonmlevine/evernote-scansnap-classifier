import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getConfig } from "./config.js";
import { ReviewController } from "./controllers/reviewController.js";
import { StaticController } from "./controllers/staticController.js";
import { LearningStore } from "./models/learningStore.js";
import { LocalOcrStore } from "./models/localOcrStore.js";
import { ClassificationAgentHarness } from "./models/agentHarness.js";
import { ClassificationAgent } from "./models/classificationAgent.js";
import { LlmSuggestionEngine } from "./models/llmSuggestionEngine.js";
import { OpenAiCompatibleLlmClient } from "./models/llmClient.js";
import { McpClient } from "./models/mcpClient.js";
import { OfficeDocumentConverter } from "./models/presentationConverter.js";
import { PdfOcrExtractor } from "./models/pdfOcrExtractor.js";
import { ReviewNoteModel } from "./models/reviewNoteModel.js";
import { loadClassificationRules } from "./models/classificationRules.js";
import { SuggestionEngine } from "./models/suggestionEngine.js";
import { VerificationAgent } from "./models/verificationAgent.js";
import { sendError } from "./views/apiView.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function createLlmSuggestionEngine({ config, learningStore, deterministicEngine }) {
  const llmClient = new OpenAiCompatibleLlmClient({
    apiKey: config.llm.apiKey,
    baseUrl: config.llm.apiBase,
    model: config.llm.model,
    responseFormat: config.llm.responseFormat,
    disableThinking: config.llm.disableThinking,
    timeoutMs: config.llm.timeoutMs,
  });
  const classificationAgent = new ClassificationAgent({
    llmClient,
    maxOcrChars: config.llm.maxOcrChars,
    maxExamples: config.llm.maxExamples,
  });
  const verificationAgent = config.llm.verificationEnabled
    ? new VerificationAgent({ llmClient, maxOcrChars: Math.min(config.llm.maxOcrChars, 6000) })
    : null;

  return new LlmSuggestionEngine({
    deterministicEngine,
    learningStore,
    harness: new ClassificationAgentHarness({ classificationAgent, verificationAgent }),
    maxExamples: config.llm.maxExamples,
  });
}

export function createDependencies(config = getConfig(), { rules } = {}) {
  const learningStore = new LearningStore({ ...config, rules });
  const deterministicSuggestionEngine = new SuggestionEngine({ learningStore, rules });
  const llmSuggestionEngine = createLlmSuggestionEngine({
    config,
    learningStore,
    deterministicEngine: deterministicSuggestionEngine,
  });
  const suggestionEngine = config.llm?.enabled ? llmSuggestionEngine : deterministicSuggestionEngine;
  return {
    reviewModel: new ReviewNoteModel({
      mcpClient: new McpClient({
        baseUrl: config.mcpApiBase,
        apiKey: config.mcpApiKey,
      }),
      learningStore,
      suggestionEngine,
      deterministicSuggestionEngine,
      llmSuggestionEngine,
      localOcrStore: new LocalOcrStore(config),
      officeConverter: new OfficeDocumentConverter({
        cacheDir: config.officePreviewCacheDir,
        command: config.officeConverterCommand,
        timeoutMs: config.officeConverterTimeoutMs,
      }),
      pdfOcrExtractor: new PdfOcrExtractor({
        cacheDir: config.pdfOcrCacheDir,
        command: config.pdfOcrCommand,
        scriptPath: config.pdfOcrScriptPath,
        timeoutMs: config.pdfOcrTimeoutMs,
        maxPages: config.pdfOcrMaxPages,
      }),
      maxCandidates: config.maxCandidates,
    }),
    publicDir: resolve(repoRoot, "public"),
  };
}

export function createApp(dependencies = createDependencies()) {
  const reviewController = new ReviewController({ reviewModel: dependencies.reviewModel });
  const staticController = new StaticController({ publicDir: dependencies.publicDir });

  return createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (await reviewController.handle(req, res, url)) return;
    if (await staticController.handle(req, res, url)) return;

    sendError(res, 404, "Not found");
  });
}

export function startServer(config = getConfig()) {
  const server = createApp(createDependencies(config));
  server.listen(config.port, "127.0.0.1", () => {
    console.log(`ScanSnap classifier UI on http://127.0.0.1:${config.port}`);
    console.log(`Using Evernote MCP API at ${config.mcpApiBase}`);
  });
  return server;
}

export async function startServerWithPrivateRules(config = getConfig()) {
  const rules = await loadClassificationRules(config.classificationRulesPath);
  const server = createApp(createDependencies(config, { rules }));
  server.listen(config.port, "127.0.0.1", () => {
    console.log(`ScanSnap classifier UI on http://127.0.0.1:${config.port}`);
    console.log(`Using Evernote MCP API at ${config.mcpApiBase}`);
  });
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startServerWithPrivateRules();
}

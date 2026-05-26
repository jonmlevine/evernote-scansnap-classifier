import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyWithModel,
  helpText,
  llmErrorDiagnostics,
  oneLine,
  parseArgs,
  splitCsv,
} from "../scripts/compare-llm-models.js";

function lmStudioResponse(payload, status = 200) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    }),
    {
      status,
      headers: { "content-type": "application/json" },
    }
  );
}

function comparisonContext() {
  return {
    config: {
      llm: {
        apiKey: "lm-studio",
        apiBase: "http://127.0.0.1:1234/v1",
        disableThinking: true,
        maxOcrChars: 12000,
      },
    },
    detail: {
      id: "note-1",
      title: "20260506_IIllllIlllllllIIIlf",
      ocr: { text: "CardCo Account Services April 29, 2026 account ending 1234" },
      notebooks: [{ id: "finance", name: "Finance" }],
      tags: [{ id: "cardco", name: "CardCo" }],
    },
    deterministicSuggestion: {
      title: "Undated Scanned Document",
      tags: [],
      notebook: "Scanned Items Notebook",
      confidence: 0.35,
      reason: "Fallback guess",
      source: "fallback",
    },
    examples: [
      {
        originalTitle: "20260429_scan",
        suggestedTitle: "Alex CardCo April 2026 Letter",
        suggestedTags: ["finance", "card", "CardCo", "Alex"],
        suggestedNotebook: "Finance",
      },
    ],
  };
}

describe("LM Studio comparison runner", () => {
  it("parses comparison model, note, and timeout options", () => {
    const env = {
      SCANSNAP_LLM_COMPARE_LIMIT: "2",
      SCANSNAP_LLM_COMPARE_MODELS: "env-qwen,env-gemma",
      SCANSNAP_LLM_COMPARE_NOTE_IDS: "env-note",
      SCANSNAP_LLM_MAX_EXAMPLES: "4",
      SCANSNAP_LLM_MAX_OCR_CHARS: "2000",
      SCANSNAP_LLM_TIMEOUT_MS: "90000",
    };

    assert.deepEqual(splitCsv(" qwen-3.6-27b, gemma-4-31b ,, "), ["qwen-3.6-27b", "gemma-4-31b"]);
    assert.deepEqual(
      parseArgs(
        [
          "--models",
          "qwen-3.6-27b,gemma-4-31b",
          "--notes",
          "note-1,note-2",
          "--limit",
          "5",
          "--max-examples",
          "7",
          "--ocr-chars",
          "4000",
          "--timeout-ms",
          "120000",
        ],
        env
      ),
      {
        limit: 5,
        models: ["qwen-3.6-27b", "gemma-4-31b"],
        noteIds: ["note-1", "note-2"],
        maxExamples: 7,
        ocrChars: 4000,
        timeoutMs: 120000,
      }
    );
  });

  it("documents LM Studio defaults in help text", () => {
    assert.match(helpText(), /SCANSNAP_LLM_API_BASE/);
    assert.match(helpText(), /qwen-3\.6-27b,gemma-4-31b/);
    assert.match(helpText(), /--ocr-chars 12000/);
    assert.equal(oneLine("a\n  b\tc", 20), "a b c");
  });

  it("runs classifier and verifier calls against an OpenAI-compatible LM Studio endpoint", async () => {
    const calls = [];
    const responses = [
      {
        title: "Alex CardCo April 29 2026 Letter",
        tags: ["finance", "card", "CardCo", "Alex"],
        notebook: "Finance",
        confidence: 0.82,
        reason: "OCR identifies CardCo correspondence.",
        evidence: ["CardCo Account Services", "April 29, 2026"],
      },
      {
        accepted: true,
        title: "Alex CardCo April 29 2026 Letter",
        tags: ["finance", "card", "CardCo", "Alex"],
        notebook: "Finance",
        confidence: 0.87,
        reason: "Verified against OCR date and issuer.",
        issues: [],
      },
    ];
    const fetchImpl = async (url, init) => {
      calls.push({
        url,
        headers: init.headers,
        body: JSON.parse(init.body),
      });
      return lmStudioResponse(responses.shift());
    };

    const result = await classifyWithModel({
      model: "qwen-3.6-27b",
      ...comparisonContext(),
      ruleEngineContext: {
        matchTokens: ["april", "card", "cardco", "credit"],
        suggestedTags: ["finance", "card", "CardCo", "Alex"],
        suggestedNotebooks: ["Finance"],
        choiceSet: {
          candidateTags: ["Statements", "Finance", "Records", "card", "CardCo", "Alex"],
          candidateNotebooks: ["Scanned Items Notebook", "Finance", "Records"],
          strongMatchTokens: ["cardco", "account", "letter"],
        },
        instructions: ["Use local notebook routing."],
      },
      maxExamples: 2,
      timeoutMs: 1000,
      fetchImpl,
    });

    assert.equal(result.ok, true);
    assert.equal(result.model, "qwen-3.6-27b");
    assert.equal(result.suggestion.title, "Alex CardCo April 29 2026 Letter");
    assert.equal(result.suggestion.notebook, "Finance");
    assert.deepEqual(result.suggestion.tags, ["finance", "card", "CardCo", "Alex"]);
    assert.equal(calls.length, 2);

    for (const call of calls) {
      assert.equal(call.url, "http://127.0.0.1:1234/v1/chat/completions");
      assert.equal(call.headers.Authorization, "Bearer lm-studio");
      assert.equal(call.body.model, "qwen-3.6-27b");
      assert.equal(call.body.response_format.type, "json_schema");
      assert.equal(call.body.response_format.json_schema.name, "scansnap_classification");
    }

    const classifierPrompt = calls[0].body.messages[1].content;
    assert.match(calls[0].body.messages[0].content, /ruleEngine\.instructions/);
    assert.match(classifierPrompt, /\/no_think$/);
    const classifierPayload = JSON.parse(classifierPrompt.replace(/\n\n\/no_think$/, ""));
    assert.equal(classifierPayload.note.id, "note-1");
    assert.deepEqual(classifierPayload.existingNotebooks, ["Finance"]);
    assert.deepEqual(classifierPayload.existingTags, ["CardCo"]);
    assert.equal(classifierPayload.learnedExamples.length, 1);
    assert.deepEqual(classifierPayload.ruleEngine.suggestedTags, [
      "finance",
      "card",
      "CardCo",
      "Alex",
    ]);
    assert.deepEqual(classifierPayload.ruleEngine.suggestedNotebooks, ["Finance"]);
    assert.deepEqual(classifierPayload.ruleEngine.matchTokens, ["april", "card", "cardco", "credit"]);
    assert.deepEqual(classifierPayload.ruleEngine.choiceSet.candidateTags, [
      "Statements",
      "Finance",
      "Records",
      "card",
      "CardCo",
      "Alex",
    ]);
    assert.deepEqual(classifierPayload.ruleEngine.choiceSet.candidateNotebooks, [
      "Scanned Items Notebook",
      "Finance",
      "Records",
    ]);
    assert.deepEqual(classifierPayload.ruleEngine.instructions, ["Use local notebook routing."]);

    const verifierPrompt = calls[1].body.messages[1].content;
    assert.match(calls[1].body.messages[0].content, /ruleEngine\.instructions/);
    assert.match(verifierPrompt, /\/no_think$/);
    const verifierPayload = JSON.parse(verifierPrompt.replace(/\n\n\/no_think$/, ""));
    assert.equal(verifierPayload.suggestion.title, "Alex CardCo April 29 2026 Letter");
    assert.deepEqual(verifierPayload.ruleEngine.suggestedNotebooks, ["Finance"]);
    assert.deepEqual(verifierPayload.ruleEngine.choiceSet.strongMatchTokens, ["cardco", "account", "letter"]);
  });

  it("returns comparison errors when the local LM Studio request fails", async () => {
    const fetchImpl = async () =>
      new Response("model is not loaded", {
        status: 500,
        headers: { "content-type": "text/plain" },
      });

    const result = await classifyWithModel({
      model: "gemma-4-31b",
      ...comparisonContext(),
      maxExamples: 2,
      timeoutMs: 1000,
      fetchImpl,
    });

    assert.equal(result.ok, false);
    assert.equal(result.model, "gemma-4-31b");
    assert.match(result.error, /LLM request failed \(500\): model is not loaded/);
  });

  it("surfaces sanitized raw response diagnostics for empty LM Studio content", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          id: "chatcmpl-empty",
          object: "chat.completion",
          model: "qwen/qwen3.6-27b",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "",
                reasoning_content: "",
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );

    const result = await classifyWithModel({
      model: "qwen/qwen3.6-27b",
      ...comparisonContext(),
      maxExamples: 0,
      timeoutMs: 1000,
      fetchImpl,
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, "LLM response was empty");
    assert.match(result.diagnostics[0], /reasoningContentLength/);
    assert.match(result.diagnostics[0], /prompt_tokens/);
    assert.match(result.diagnostics[1], /rawResponsePreview=/);
  });

  it("parses JSON from LM Studio reasoning content when message content is empty", async () => {
    let callCount = 0;
    const sequentialFetch = async (url, init) => {
      const payloads = [
        {
          title: "Alex CardCo April 29 2026 Letter",
          tags: ["finance", "card", "CardCo", "Alex"],
          notebook: "Finance",
          confidence: 0.82,
          reason: "Qwen placed JSON in reasoning_content.",
          evidence: ["CardCo"],
        },
        {
          accepted: true,
          title: "Alex CardCo April 29 2026 Letter",
          tags: ["finance", "card", "CardCo", "Alex"],
          notebook: "Finance",
          confidence: 0.84,
          reason: "Verified.",
          issues: [],
        },
      ];
      const payload = payloads[callCount];
      callCount += 1;
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "",
                reasoning_content: JSON.stringify(payload),
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    };

    const result = await classifyWithModel({
      model: "qwen/qwen3.6-27b",
      ...comparisonContext(),
      maxExamples: 0,
      timeoutMs: 1000,
      fetchImpl: sequentialFetch,
    });

    assert.equal(result.ok, true);
    assert.equal(result.suggestion.title, "Alex CardCo April 29 2026 Letter");
    assert.equal(result.suggestion.notebook, "Finance");
    assert.equal(callCount, 2);
  });

  it("formats LLM error diagnostics from attached details", () => {
    const error = new Error("LLM response was empty");
    error.details = { messageKeys: ["role", "content"], contentLength: 0 };
    error.rawResponsePreview = '{"choices":[{"message":{"content":""}}]}';

    assert.deepEqual(llmErrorDiagnostics(error), [
      'details={"messageKeys":["role","content"],"contentLength":0}',
      'rawResponsePreview={"choices":[{"message":{"content":""}}]}',
    ]);
  });
});

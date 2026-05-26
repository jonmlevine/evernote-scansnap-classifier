function normalizeBaseUrl(baseUrl = "") {
  return String(baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
}

function safeKeys(value) {
  return value && typeof value === "object" ? Object.keys(value) : [];
}

function createEmptyContentError(data) {
  const choice = data?.choices?.[0] || {};
  const message = choice.message || {};
  const error = new Error("LLM response was empty");
  error.details = {
    responseId: data?.id,
    object: data?.object,
    model: data?.model,
    created: data?.created,
    choicesLength: Array.isArray(data?.choices) ? data.choices.length : 0,
    choiceKeys: safeKeys(choice),
    choiceFinishReason: choice.finish_reason,
    choiceIndex: choice.index,
    messageKeys: safeKeys(message),
    messageRole: message.role,
    contentType: typeof message.content,
    contentLength: typeof message.content === "string" ? message.content.length : undefined,
    reasoningContentLength:
      typeof message.reasoning_content === "string" ? message.reasoning_content.length : undefined,
    thinkingLength: typeof message.thinking === "string" ? message.thinking.length : undefined,
    toolCallsLength: Array.isArray(message.tool_calls) ? message.tool_calls.length : undefined,
    usage: data?.usage,
  };
  error.rawResponsePreview = JSON.stringify(data, (_key, value) => {
    if (typeof value === "string" && value.length > 500) return `${value.slice(0, 500)}...[truncated]`;
    return value;
  }).slice(0, 4000);
  return error;
}

function firstMessageContent(data) {
  const message = data?.choices?.[0]?.message || {};
  if (typeof message.content === "string" && message.content.trim()) return message.content;
  if (typeof message.reasoning_content === "string" && message.reasoning_content.trim()) {
    return message.reasoning_content;
  }
  if (typeof message.thinking === "string" && message.thinking.trim()) return message.thinking;
  return "";
}

function parseJsonObject(content = "", data = null) {
  const trimmed = String(content || "").trim();
  if (!trimmed) throw createEmptyContentError(data);

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("LLM response did not contain JSON");
    return JSON.parse(match[0]);
  }
}

function responseFormatPayload(format = "json_schema") {
  if (format === "json_object") return { type: "json_object" };
  if (format === "text") return { type: "text" };
  return {
    type: "json_schema",
    json_schema: {
      name: "scansnap_classification",
      strict: false,
      schema: {
        type: "object",
        additionalProperties: true,
      },
    },
  };
}

export class OpenAiCompatibleLlmClient {
  constructor({
    apiKey = "",
    baseUrl = "https://api.openai.com/v1",
    model = "gpt-4.1-mini",
    responseFormat = "json_schema",
    disableThinking = false,
    timeoutMs = 600000,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.model = model;
    this.responseFormat = responseFormat;
    this.disableThinking = disableThinking;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  userPrompt(user) {
    const text = String(user || "");
    if (!this.disableThinking || /\/no_think\s*$/i.test(text)) return text;
    return `${text}\n\n/no_think`;
  }

  async completeJson({ system, user, temperature = 0, maxTokens = 1200 }) {
    if (!this.apiKey) {
      const error = new Error("SCANSNAP_LLM_API_KEY or OPENAI_API_KEY is required when LLM classification is enabled");
      error.status = 503;
      throw error;
    }
    if (typeof this.fetchImpl !== "function") {
      throw new Error("No fetch implementation is available for LLM requests");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer?.unref?.();

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: this.userPrompt(user) },
          ],
          temperature,
          max_tokens: maxTokens,
          response_format: responseFormatPayload(this.responseFormat),
        }),
        signal: controller.signal,
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`LLM request failed (${response.status}): ${text.slice(0, 300)}`);
      }

      const data = JSON.parse(text);
      return parseJsonObject(firstMessageContent(data), data);
    } finally {
      clearTimeout(timer);
    }
  }
}

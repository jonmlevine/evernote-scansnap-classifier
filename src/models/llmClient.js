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

function stripJsonFences(content = "") {
  return String(content || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

const KNOWN_RESPONSE_KEYS = [
  "accepted",
  "title",
  "tags",
  "notebook",
  "confidence",
  "reason",
  "evidence",
  "issues",
];
const KNOWN_RESPONSE_KEY_PATTERN = KNOWN_RESPONSE_KEYS.join("|");

function extractJsonBlock(content = "") {
  const text = stripJsonFences(content);
  const start = text.indexOf("{");
  if (start < 0) return "";

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  const end = text.lastIndexOf("}");
  return end > start ? text.slice(start, end + 1) : "";
}

function extractKnownResponseBlock(content = "") {
  return extractKnownResponseBlocks(content)[0] || "";
}

function extractKnownResponseBlocks(content = "") {
  const text = stripJsonFences(content);
  const keyPattern = new RegExp(
    `(?:"(?:${KNOWN_RESPONSE_KEY_PATTERN})"|(?:${KNOWN_RESPONSE_KEY_PATTERN}))\\s*:`,
    "gi"
  );
  const blocks = [];
  const seen = new Set();

  for (const keyMatch of text.matchAll(keyPattern)) {
    const keyIndex = keyMatch.index || 0;
    const lineStart = Math.max(text.lastIndexOf("\n", keyIndex) + 1, 0);
    const objectStart = text.lastIndexOf("{", keyIndex);
    const start = objectStart >= 0 ? objectStart : lineStart;
    const end = text.indexOf("}", keyIndex);
    const block = end >= 0 ? text.slice(start, end + 1) : text.slice(start);
    if (!block || seen.has(block)) continue;
    seen.add(block);
    blocks.push(block);
  }

  return blocks;
}

function withoutTrailingCommas(content = "") {
  return content.replace(/,\s*([}\]])/g, "$1");
}

function hasKnownResponseField(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    KNOWN_RESPONSE_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function isUsefulResponsePayload(value) {
  if (!hasKnownResponseField(value)) return false;
  if (String(value.title || "").trim() && String(value.notebook || "").trim()) return true;
  return Object.prototype.hasOwnProperty.call(value, "accepted");
}

function parseKnownJsonObject(content = "") {
  const parsed = JSON.parse(content);
  return isUsefulResponsePayload(parsed) ? parsed : null;
}

function valueSlice(content = "", name = "") {
  const key = content.match(new RegExp(`(?:"${name}"|${name})\\s*:`, "i"));
  if (!key) return "";

  const start = (key.index || 0) + key[0].length;
  const rest = content.slice(start).trimStart();
  const nextKey = new RegExp(
    `"?\\s*(?:[,;]|\\r?\\n)\\s*(?:"(?:${KNOWN_RESPONSE_KEY_PATTERN})"|(?:${KNOWN_RESPONSE_KEY_PATTERN}))\\s*:`,
    "i"
  );

  if (rest.startsWith("\"")) {
    const body = rest.slice(1);
    const delimiter = body.search(nextKey);
    if (delimiter >= 0) return body.slice(0, delimiter).replace(/"\s*$/, "").trim();
    return body.replace(/"\s*}?\s*$/s, "").trim();
  }

  const delimiter = rest.search(nextKey);
  const rawValue = delimiter >= 0 ? rest.slice(0, delimiter) : rest;
  return rawValue.replace(/[,}\]]+\s*$/s, "").trim();
}

function stringField(content = "", name = "") {
  const pattern = new RegExp(`"${name}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?=,\\s*"[A-Za-z_][A-Za-z0-9_]*"\\s*:|\\s*[}\\]])`, "i");
  const match = content.match(pattern);
  if (match?.[1]) return match[1].replace(/\\"/g, "\"").trim();
  return valueSlice(content, name).replace(/^"|"$/g, "").replace(/\\"/g, "\"").trim();
}

function arrayField(content = "", name = "") {
  const match = content.match(new RegExp(`"${name}"\\s*:\\s*\\[([\\s\\S]*?)\\]`, "i"));
  const raw = match?.[1] || valueSlice(content, name).replace(/^\[/, "").replace(/\]\s*$/, "");
  if (!raw) return [];
  const values = [];
  for (const valueMatch of raw.matchAll(/"([\s\S]*?)"\s*(?=,|$)/g)) {
    const value = valueMatch[1].replace(/\\"/g, "\"").trim();
    if (value) values.push(value);
  }
  if (values.length) return values;
  return raw
    .split(/[;,]/)
    .map((value) => value.replace(/^['"\s]+|['"\s]+$/g, "").trim())
    .filter(Boolean);
}

function numberField(content = "", name = "") {
  const match = content.match(new RegExp(`"${name}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "i"));
  return match ? Number(match[1]) : undefined;
}

function booleanField(content = "", name = "") {
  const match = content.match(new RegExp(`"${name}"\\s*:\\s*(true|false)`, "i"));
  return match ? match[1].toLowerCase() === "true" : undefined;
}

function salvageKnownJsonObject(content = "") {
  const blocks = [
    ...extractKnownResponseBlocks(content),
    extractJsonBlock(content),
    stripJsonFences(content),
  ].filter(Boolean);

  for (const objectText of blocks) {
    const payload = {};
    const title = stringField(objectText, "title");
    const notebook = stringField(objectText, "notebook");
    const reason = stringField(objectText, "reason");
    const tags = arrayField(objectText, "tags");
    const evidence = arrayField(objectText, "evidence");
    const issues = arrayField(objectText, "issues");
    const confidence = numberField(objectText, "confidence");
    const accepted = booleanField(objectText, "accepted");

    if (title) payload.title = title;
    if (notebook) payload.notebook = notebook;
    if (tags.length) payload.tags = tags;
    if (evidence.length) payload.evidence = evidence;
    if (issues.length) payload.issues = issues;
    if (reason) payload.reason = reason;
    if (confidence !== undefined) payload.confidence = confidence;
    if (accepted !== undefined) payload.accepted = accepted;
    if (isUsefulResponsePayload(payload)) return payload;
  }

  return null;
}

function parseJsonObject(content = "", data = null) {
  const trimmed = String(content || "").trim();
  if (!trimmed) throw createEmptyContentError(data);

  const candidates = [
    stripJsonFences(trimmed),
    ...extractKnownResponseBlocks(trimmed),
    extractJsonBlock(trimmed),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = parseKnownJsonObject(candidate);
      if (parsed) return parsed;
    } catch {}

    try {
      const parsed = parseKnownJsonObject(withoutTrailingCommas(candidate));
      if (parsed) return parsed;
    } catch {}
  }

  const salvaged = salvageKnownJsonObject(trimmed);
  if (salvaged) return salvaged;

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const wrapped = new Error(`LLM response did not contain valid JSON: ${error.message}`);
    wrapped.cause = error;
    wrapped.details = {
      contentLength: trimmed.length,
      parseError: error.message,
    };
    throw wrapped;
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

  getModel() {
    return this.model;
  }

  setModel(model = "") {
    const value = String(model || "").trim();
    if (!value) {
      const error = new Error("LLM model is required");
      error.status = 400;
      throw error;
    }
    this.model = value;
    return this.model;
  }

  requestBody({ system, user, temperature, maxTokens, retry = false }) {
    const retrySystem = retry
      ? [
          system,
          "The previous response was invalid or truncated.",
          "Return only one compact JSON object now.",
          "Do not include reasoning, markdown, code fences, OCR quotes, or explanatory text.",
          "Keep reason under 12 words and evidence or issues under 3 short strings.",
        ].join(" ")
      : system;
    const retryUser = retry
      ? `${user}\n\nReturn compact valid JSON only.`
      : user;
    return {
      model: this.model,
      messages: [
        { role: "system", content: retrySystem },
        { role: "user", content: this.userPrompt(retryUser) },
      ],
      temperature,
      max_tokens: retry ? Math.min(maxTokens, 500) : maxTokens,
      response_format: responseFormatPayload(this.responseFormat),
    };
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

    let lastParseError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      timer?.unref?.();
      let response;
      let text;
      try {
        response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(this.requestBody({
            system,
            user,
            temperature,
            maxTokens,
            retry: attempt > 0,
          })),
          signal: controller.signal,
        });
        text = await response.text();
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        throw new Error(`LLM request failed (${response.status}): ${text.slice(0, 300)}`);
      }

      const data = JSON.parse(text);
      try {
        return parseJsonObject(firstMessageContent(data), data);
      } catch (error) {
        lastParseError = error;
        if (attempt === 0) continue;
      }
    }

    throw lastParseError;
  }
}

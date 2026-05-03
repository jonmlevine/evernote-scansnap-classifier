export class McpError extends Error {
  constructor(message, { status = 500, details } = {}) {
    super(message);
    this.name = "McpError";
    this.status = status;
    this.details = details;
  }
}

export class McpClient {
  constructor({ baseUrl, apiKey = "", fetchImpl = globalThis.fetch }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }

  async request(path, { method = "GET", body, headers = {} } = {}) {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(this.apiKey ? { "X-API-Key": this.apiKey } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await response.json() : await response.text();

    if (!response.ok) {
      throw new McpError(data?.error || `MCP request failed: ${response.status}`, {
        status: response.status,
        details: data,
      });
    }

    return data;
  }

  listNotes(maxResults = 100) {
    return this.request(`/api/notes?maxResults=${encodeURIComponent(maxResults)}`).then((data) =>
      normalizeNotesResponse(data)
    );
  }

  getNote(noteId, { includeContent = true } = {}) {
    const query = includeContent ? "" : "?includeContent=false";
    return this.request(`/api/notes/${encodeURIComponent(noteId)}${query}`);
  }

  getNoteMetadata(noteId) {
    return this.getNote(noteId, { includeContent: false });
  }

  updateNote(noteId, update) {
    return this.request(`/api/notes/${encodeURIComponent(noteId)}`, {
      method: "PUT",
      body: update,
    });
  }

  getNoteOcr(noteId) {
    return this.request(`/api/notes/${encodeURIComponent(noteId)}/ocr?includeSearchText=true`);
  }

  listNotebooks() {
    return this.request("/api/notebooks");
  }

  createNotebook(name) {
    return this.request("/api/notebooks", {
      method: "POST",
      body: { name },
    });
  }

  listTags() {
    return this.request("/api/tags");
  }

  createTag(name) {
    return this.request("/api/tags", {
      method: "POST",
      body: { name },
    });
  }

  listAttachments(noteId) {
    return this.request(`/api/notes/${encodeURIComponent(noteId)}/attachments`);
  }

  async getResourceData(resourceId) {
    const attachment = await this.request(
      `/api/resources/${encodeURIComponent(resourceId)}?includeData=true`
    );
    if (!attachment.data || attachment.encoding !== "base64") {
      throw new McpError(`Resource data unavailable: ${resourceId}`, {
        status: 502,
        details: attachment,
      });
    }

    return {
      buffer: Buffer.from(attachment.data, "base64"),
      contentType: attachment.mime || "application/pdf",
    };
  }
}

function normalizeNotesResponse(data) {
  const notes = Array.isArray(data)
    ? data
    : Array.isArray(data?.hits)
      ? data.hits
      : Array.isArray(data?.semanticHits)
        ? data.semanticHits
        : [];

  return notes.map((note) => ({
    ...note,
    noteId: note.noteId || note.noteGuid || note.id || note.guid,
    title: note.title || note.noteTitle || note.name || "",
    snippet: note.snippet || note.chunkContent || "",
  }));
}

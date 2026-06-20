import { extractOcrText, htmlToText, mergeOcrText, ocrDisplayExcerpt, ocrLearningSample } from "./ocr.js";
import { titleKey } from "./learningStore.js";

function noteId(note) {
  return note.noteId || note.noteGuid || note.id || note.guid;
}

function noteTitle(note) {
  return note.title || "";
}

function isImportedScan(note) {
  return /^\d{8}[_\s-]/.test(noteTitle(note));
}

function normalizeResource(resource = {}, noteGuid = "") {
  const mime = resource.mime || resource.mimeType || resource.type || "";
  return {
    id: resource.id || resource.guid || "",
    noteId: resource.noteId || resource.noteGuid || noteGuid,
    mime,
    filename: resource.filename || resource.attributes?.fileName || resource.attributes?.attachment || "",
    size: resource.size || resource.data?.size || resource.dataSize,
  };
}

function normalizedMime(value = "") {
  return String(value).toLowerCase().split(";")[0].trim();
}

function mimeFromFilename(filename = "") {
  const extension = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
  return (
    {
      pdf: "application/pdf",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      bmp: "image/bmp",
      ppt: "application/vnd.ms-powerpoint",
      pps: "application/vnd.ms-powerpoint",
      pot: "application/vnd.ms-powerpoint",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      pptm: "application/vnd.ms-powerpoint.presentation.macroenabled.12",
      ppsx: "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
      ppsm: "application/vnd.ms-powerpoint.slideshow.macroenabled.12",
      potx: "application/vnd.openxmlformats-officedocument.presentationml.template",
      potm: "application/vnd.ms-powerpoint.template.macroenabled.12",
      odp: "application/vnd.oasis.opendocument.presentation",
      doc: "application/msword",
      dot: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      docm: "application/vnd.ms-word.document.macroenabled.12",
      dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
      dotm: "application/vnd.ms-word.template.macroenabled.12",
      rtf: "application/rtf",
      odt: "application/vnd.oasis.opendocument.text",
      xls: "application/vnd.ms-excel",
      xlt: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      xlsm: "application/vnd.ms-excel.sheet.macroenabled.12",
      xlsb: "application/vnd.ms-excel.sheet.binary.macroenabled.12",
      xltx: "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
      xltm: "application/vnd.ms-excel.template.macroenabled.12",
      xlam: "application/vnd.ms-excel.addin.macroenabled.12",
      ods: "application/vnd.oasis.opendocument.spreadsheet",
    }[extension] || ""
  );
}

function resourceContentType(resource) {
  const type = normalizedMime(resource.mime);
  const filenameType = mimeFromFilename(resource.filename);
  if (["application/octet-stream", "binary/octet-stream"].includes(type) && filenameType) {
    return filenameType;
  }
  if (!type) return filenameType;
  if (type === "image/jpg" || type === "image/pjpeg") return "image/jpeg";
  if (type === "image/x-png") return "image/png";
  return type;
}

function isPdf(resource) {
  return resourceContentType(resource) === "application/pdf";
}

function isDisplayableImage(resource) {
  return ["image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"].includes(
    resourceContentType(resource)
  );
}

function isOfficeDocument(resource) {
  return [
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint.presentation.macroenabled.12",
    "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
    "application/vnd.ms-powerpoint.slideshow.macroenabled.12",
    "application/vnd.openxmlformats-officedocument.presentationml.template",
    "application/vnd.ms-powerpoint.template.macroenabled.12",
    "application/vnd.oasis.opendocument.presentation",
    "application/msword",
    "application/rtf",
    "text/rtf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-word.document.macroenabled.12",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
    "application/vnd.ms-word.template.macroenabled.12",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.ms-excel",
    "application/vnd.ms-excel.sheet.macroenabled.12",
    "application/vnd.ms-excel.sheet.binary.macroenabled.12",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
    "application/vnd.ms-excel.template.macroenabled.12",
    "application/vnd.ms-excel.addin.macroenabled.12",
    "application/vnd.oasis.opendocument.spreadsheet",
  ].includes(resourceContentType(resource));
}

function previewKind(resource) {
  if (isPdf(resource)) return "pdf";
  if (isDisplayableImage(resource)) return "image";
  if (isOfficeDocument(resource)) return "pdf";
  return "";
}

function previewFilename(noteIdValue, resource, kind) {
  if (isOfficeDocument(resource)) {
    return (resource.filename || `${noteIdValue}.office`).replace(/\.[^.]+$/, "") + ".pdf";
  }
  return resource.filename || `${noteIdValue}.${kind === "pdf" ? "pdf" : "image"}`;
}

function previewMetadata(noteIdValue, resource) {
  const kind = previewKind(resource);
  if (!kind) return null;
  return {
    resourceId: resource.id,
    filename: previewFilename(noteIdValue, resource, kind),
    contentType: isOfficeDocument(resource) ? "application/pdf" : resourceContentType(resource),
    kind,
    url: `/api/candidates/${encodeURIComponent(noteIdValue)}/preview`,
  };
}

function namesEqual(left = "", right = "") {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function sameTags(left = [], right = []) {
  const a = left.map((tag) => tag.toLowerCase()).sort().join("|");
  const b = right.map((tag) => tag.toLowerCase()).sort().join("|");
  return a === b;
}

function splitTagInput(tags = []) {
  if (Array.isArray(tags)) return tags.map((tag) => String(tag).trim()).filter(Boolean);
  return String(tags)
    .split(/[;,]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function tagKey(name = "") {
  return name.trim().toLowerCase();
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function timeoutError(message) {
  const error = new Error(message);
  error.status = 504;
  return error;
}

function hasSecondPageText(text = "") {
  return /\bPage\s+2\s+of\s+\d+\b/i.test(text) || /\b2\s+of\s+\d+\b/i.test(text);
}

function referencesBackPage(text = "") {
  return /\bsee\s+back\b|\bon\s+back\b|\bback\s+for\b|\bpolicy\s+details\b|\bcoverage\s+detail\s+on\s+back\b/i.test(
    text
  );
}

function pdfOcrStartPage(text = "") {
  if (!String(text || "").trim()) return 1;
  if (referencesBackPage(text) && !hasSecondPageText(text)) return 2;
  return 0;
}

function withTimeout(promise, timeoutMs, message) {
  if (!timeoutMs) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(timeoutError(message)), timeoutMs);
    timer?.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class ReviewNoteModel {
  constructor({
    mcpClient,
    learningStore,
    suggestionEngine,
    localOcrStore,
    officeConverter = null,
    presentationConverter = null,
    pdfOcrExtractor = null,
    deterministicSuggestionEngine = null,
    llmSuggestionEngine = null,
    maxCandidates = 100,
    listNotesTimeoutMs = 30000,
  }) {
    this.mcpClient = mcpClient;
    this.learningStore = learningStore;
    this.suggestionEngine = suggestionEngine;
    this.deterministicSuggestionEngine = deterministicSuggestionEngine || suggestionEngine;
    this.llmSuggestionEngine = llmSuggestionEngine;
    this.localOcrStore = localOcrStore;
    this.officeConverter = officeConverter || presentationConverter;
    this.pdfOcrExtractor = pdfOcrExtractor;
    this.maxCandidates = maxCandidates;
    this.listNotesTimeoutMs = listNotesTimeoutMs;
  }

  getLlmSettings() {
    return {
      configured: typeof this.llmSuggestionEngine?.suggestWithLlm === "function",
      model: this.llmSuggestionEngine?.getModel?.() || "",
    };
  }

  updateLlmSettings(input = {}) {
    if (typeof this.llmSuggestionEngine?.setModel !== "function") {
      const error = new Error("LLM classification is not configured");
      error.status = 503;
      throw error;
    }
    return {
      configured: true,
      model: this.llmSuggestionEngine.setModel(input.model),
    };
  }

  async listCandidates(limit = this.maxCandidates) {
    const requestedLimit = Number.isFinite(limit) && limit > 0 ? limit : this.maxCandidates;
    const maxResults = Math.min(this.maxCandidates, Math.max(requestedLimit, requestedLimit * 3));
    const notes = await withTimeout(
      this.mcpClient.listNotes(maxResults),
      this.listNotesTimeoutMs,
      `Timed out loading candidate notes from Evernote MCP API after ${this.listNotesTimeoutMs}ms`
    );
    const { byGuid, byOriginalTitle } = await this.learningStore.load();
    const hydratedNotes = await this.hydrateCandidateNotes(notes, byGuid);

    return hydratedNotes
      .filter((note) => isImportedScan(note) || byGuid.has(noteId(note)))
      .slice(0, limit)
      .map((note) => {
        const id = noteId(note);
        const title = noteTitle(note);
        const learned = byGuid.get(id) || byOriginalTitle?.get(titleKey(title));
        const currentTitleIsReviewTitle = title && !isImportedScan(note);
        return {
          id,
          title,
          created: note.created,
          updated: note.updated,
          notebookId: note.notebookId,
          suggestedTitle: currentTitleIsReviewTitle ? title : learned?.suggestedTitle || "",
          suggestedNotebook: learned?.suggestedNotebook || "",
        };
      });
  }

  async hydrateCandidateNotes(notes, byGuid) {
    return mapWithConcurrency(notes, 5, async (note) => {
      const id = noteId(note);
      if (!id || (noteTitle(note) && !byGuid.has(id))) return note;

      try {
        const full = await this.getReviewNote(id);
        return {
          ...note,
          ...full,
          noteId: noteId(full) || id,
          snippet: note.snippet,
        };
      } catch {
        return note;
      }
    });
  }

  async getCandidate(id) {
    const context = await this.loadCandidateContext(id);
    const suggestion = await this.suggestionEngine.suggest(context.noteWithResources, context.ocrText, {
      notebooks: context.notebooks,
      tags: context.tags,
    });
    return this.candidateDetailFromContext(context, suggestion);
  }

  async loadCandidateContext(id) {
    const [note, notebooks, tags] = await Promise.all([
      this.getReviewNote(id),
      this.mcpClient.listNotebooks(),
      this.mcpClient.listTags(),
    ]);

    let backendOcrText = "";
    let ocrSource = "none";
    try {
      backendOcrText = extractOcrText(await this.mcpClient.getNoteOcr(id));
      if (backendOcrText) ocrSource = "backend";
    } catch (error) {
      backendOcrText = "";
    }

    const resources = (await this.noteResources(note)).map((resource) => normalizeResource(resource, note.id));
    const noteWithResources = { ...note, resources };
    const localOcrText =
      typeof this.localOcrStore?.findText === "function" ? await this.localOcrStore.findText(noteWithResources) : "";
    const pdfResource = resources.find(isPdf) || null;
    let ocrText = backendOcrText;
    const ocrSources = [];
    if (backendOcrText) ocrSources.push("backend");
    if (localOcrText) {
      const merged = mergeOcrText(ocrText, localOcrText);
      if (merged !== ocrText) {
        if (!ocrText) ocrSources.length = 0;
        ocrSources.push("local");
        ocrText = merged;
      }
    }

    const pdfOcrText = await this.supplementalPdfOcrText({
      noteId: note.id,
      resource: pdfResource,
      currentOcrText: ocrText,
    });
    if (pdfOcrText) {
      const merged = mergeOcrText(ocrText, pdfOcrText);
      if (merged !== ocrText) {
        if (!ocrText) ocrSources.length = 0;
        ocrSources.push("pdf");
        ocrText = merged;
      }
    }

    const contentText = htmlToText(note.content || "");
    if (!ocrText) ocrText = contentText;
    ocrSource = ocrSources.length ? ocrSources.join("+") : "none";
    const previewResource = pdfResource || resources.find(isDisplayableImage) || resources.find(isOfficeDocument) || null;
    const preview = previewResource ? previewMetadata(note.id, previewResource) : null;

    return {
      note,
      resources,
      noteWithResources,
      ocrText,
      ocrSource,
      notebooks,
      tags,
      pdfResource,
      preview,
    };
  }

  candidateDetailFromContext(context, suggestion) {
    const { note, resources, ocrText, ocrSource, notebooks, tags, pdfResource, preview } = context;
    return {
      id: note.id,
      title: note.title,
      created: note.created,
      updated: note.updated,
      notebookId: note.notebookId,
      tagIds: note.tagIds || [],
      resources,
      pdf: pdfResource
        ? {
            resourceId: pdfResource.id,
            filename: pdfResource.filename || `${note.id}.pdf`,
            url: `/api/candidates/${encodeURIComponent(note.id)}/pdf`,
          }
        : null,
      preview,
      suggestion,
      ocr: {
        source: ocrSource,
        text: ocrText,
        excerpt: ocrDisplayExcerpt(ocrText),
      },
      notebooks,
      tags,
    };
  }

  async getLlmSuggestion(id) {
    if (typeof this.llmSuggestionEngine?.suggestWithLlm !== "function") {
      const error = new Error("LLM classification is not configured");
      error.status = 503;
      throw error;
    }

    const context = await this.loadCandidateContext(id);
    const deterministicSuggestion = await this.deterministicSuggestionEngine.suggest(
      context.noteWithResources,
      context.ocrText,
      { notebooks: context.notebooks, tags: context.tags }
    );
    const llmSuggestion = await this.llmSuggestionEngine.suggestWithLlm(
      context.noteWithResources,
      context.ocrText,
      {
        notebooks: context.notebooks,
        tags: context.tags,
        deterministicSuggestion,
      }
    );

    return {
      id: context.note.id,
      deterministicSuggestion,
      llmSuggestion,
      ocr: {
        source: context.ocrSource,
        excerpt: ocrDisplayExcerpt(context.ocrText),
      },
    };
  }

  async supplementalPdfOcrText({ noteId, resource, currentOcrText }) {
    if (!resource?.id || typeof this.pdfOcrExtractor?.extract !== "function") return "";

    const fromPage = pdfOcrStartPage(currentOcrText);
    if (!fromPage) return "";

    try {
      const data = await this.mcpClient.getResourceData(resource.id);
      return await this.pdfOcrExtractor.extract({
        buffer: data.buffer,
        filename: resource.filename || `${noteId}.pdf`,
        resourceId: resource.id,
        fromPage,
      });
    } catch {
      return "";
    }
  }

  async getCandidatePreview(id) {
    const note = await this.getReviewNote(id);
    const resources = (await this.noteResources(note)).map((resource) => normalizeResource(resource, note.id));
    const resource = resources.find(isPdf) || resources.find(isDisplayableImage) || resources.find(isOfficeDocument);
    if (!resource?.id) {
      const error = new Error("No PDF, Office document, or displayable image attachment found for this note");
      error.status = 404;
      throw error;
    }

    const data = await this.mcpClient.getResourceData(resource.id);
    if (isOfficeDocument(resource)) {
      return this.convertOfficePreview(resource, data);
    }

    return {
      ...data,
      contentType: resourceContentType(resource) || data.contentType,
      filename: resource.filename || `${note.id}.${isPdf(resource) ? "pdf" : "image"}`,
    };
  }

  async convertOfficePreview(resource, data) {
    if (!this.officeConverter?.convert) {
      const error = new Error("Office document preview conversion is not configured");
      error.status = 501;
      throw error;
    }

    return this.officeConverter.convert({
      buffer: data.buffer,
      filename: resource.filename || `${resource.id}.office`,
      resourceId: resource.id,
      contentType: resourceContentType(resource) || data.contentType,
    });
  }

  async getCandidatePdf(id) {
    const note = await this.getReviewNote(id);
    const resources = (await this.noteResources(note)).map((resource) => normalizeResource(resource, note.id));
    const pdfResource = resources.find(isPdf);
    if (!pdfResource?.id) {
      const error = new Error("No PDF attachment found for this note");
      error.status = 404;
      throw error;
    }

    const data = await this.mcpClient.getResourceData(pdfResource.id);
    return {
      ...data,
      filename: pdfResource.filename || `${note.id}.pdf`,
    };
  }

  async noteResources(note) {
    if (Array.isArray(note.resources) && note.resources.length) {
      return note.resources;
    }
    if (typeof this.mcpClient.listAttachments !== "function") {
      return [];
    }
    try {
      return await this.mcpClient.listAttachments(note.id);
    } catch {
      return [];
    }
  }

  async getReviewNote(id) {
    const loader =
      typeof this.mcpClient.getNoteMetadata === "function"
        ? this.mcpClient.getNoteMetadata.bind(this.mcpClient)
        : this.mcpClient.getNote.bind(this.mcpClient);
    const note = await loader(id);
    const normalizedId = noteId(note) || id;
    return {
      ...note,
      id: normalizedId,
      noteId: normalizedId,
      title: noteTitle(note),
    };
  }

  async applyCandidate(id, input) {
    const detail = await this.getCandidate(id);
    const finalTitle = String(input.title || "").trim();
    const finalTags = splitTagInput(input.tags);
    const finalNotebookName = String(input.notebook || input.destinationNotebook || "").trim();

    if (!finalTitle) {
      const error = new Error("Title is required");
      error.status = 400;
      throw error;
    }

    const notebook = await this.resolveNotebook({
      notebookName: finalNotebookName,
      notebookId: input.notebookId,
      createNotebook: Boolean(input.createNotebook),
      existingNotebooks: detail.notebooks,
    });
    const tagIds = await this.resolveTagIds(finalTags, detail.tags);
    const update = {
      title: finalTitle,
      tagIds,
      ...(notebook.id ? { notebookId: notebook.id } : {}),
    };

    const updated = await this.mcpClient.updateNote(id, update);
    const changes = [];
    if (detail.suggestion.title !== finalTitle) changes.push("title");
    if (!sameTags(detail.suggestion.tags, finalTags)) changes.push("tags");
    if (notebook.name && !namesEqual(detail.suggestion.notebook, notebook.name)) changes.push("notebook");
    if (String(input.selectedSuggestionSource || "").toLowerCase() === "llm" && !changes.includes("llm")) {
      changes.push("llm");
    }

    if (changes.length) {
      await this.learningStore.appendLearning({
        noteId: id,
        original: { title: detail.title },
        suggestion: detail.suggestion,
        final: { title: finalTitle, tags: finalTags, notebook: notebook.name },
        changes,
        ocrSample: ocrLearningSample(detail.ocr.text),
      });
    }

    const warnings = [];
    if (notebook.id && updated.notebookId && updated.notebookId !== notebook.id) {
      warnings.push("The MCP server did not report the requested notebook after update.");
    }

    return {
      updated,
      applied: update,
      notebook,
      changes,
      warnings,
    };
  }

  async resolveNotebook({ notebookName, notebookId, createNotebook, existingNotebooks }) {
    const existing = existingNotebooks.find((notebook) => {
      return notebook.id === notebookId || namesEqual(notebook.name, notebookName);
    });
    if (existing) return { id: existing.id, name: existing.name, created: false };

    if (!notebookName) return { id: "", name: "", created: false };

    if (!createNotebook) {
      const error = new Error(`Notebook not found: ${notebookName}`);
      error.status = 400;
      throw error;
    }

    const created = await this.mcpClient.createNotebook(notebookName);
    if (!created?.id) {
      const error = new Error(`Notebook creation failed: ${notebookName}`);
      error.status = 502;
      throw error;
    }
    return { id: created.id, name: created.name || notebookName, created: true };
  }

  async resolveTagIds(tagNames, existingTags) {
    const byName = new Map(existingTags.map((tag) => [tagKey(tag.name), tag]));
    const seen = new Set();
    const ids = [];

    for (const name of tagNames) {
      const key = tagKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const existing = byName.get(key);
      if (existing?.id) {
        ids.push(existing.id);
        continue;
      }
      const created = await this.mcpClient.createTag(name);
      if (created?.id) {
        byName.set(key, created);
        ids.push(created.id);
      }
    }

    return ids;
  }
}

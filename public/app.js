export class ApiClient {
  async json(path, options = {}) {
    const response = await fetch(path, {
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      ...options,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  listCandidates() {
    return this.json("/api/candidates");
  }

  getCandidate(id, options = {}) {
    return this.json(`/api/candidates/${encodeURIComponent(id)}`, options);
  }

  applyCandidate(id, payload) {
    return this.json(`/api/candidates/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  getLlmSettings() {
    return this.json("/api/llm/settings");
  }

  updateLlmSettings(payload) {
    return this.json("/api/llm/settings", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  runLlmClassifier(id, options = {}) {
    return this.json(`/api/candidates/${encodeURIComponent(id)}/llm-suggestion`, {
      method: "POST",
      ...options,
    });
  }
}

export function joinTags(tags = []) {
  return tags.join("; ");
}

export function splitTags(value = "") {
  return value
    .split(/[;,]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function confidenceText(suggestion = {}) {
  if (typeof suggestion.confidence !== "number") return "No confidence score";
  return `${Math.round(suggestion.confidence * 100)}% confidence - ${suggestion.reason || suggestion.source || "suggested"}`;
}

export function suggestionChoiceText(suggestion = {}) {
  const parts = [
    suggestion.title || "Untitled suggestion",
    suggestion.notebook || "No notebook",
    joinTags(suggestion.tags || []),
    typeof suggestion.confidence === "number" ? `${Math.round(suggestion.confidence * 100)}%` : "",
  ].filter(Boolean);
  return parts.join(" | ");
}

export function candidateLabel(candidate) {
  return candidate.suggestedTitle || candidate.title || "Untitled note";
}

export function candidateSubtitle(candidate) {
  const label = candidateLabel(candidate);
  if (candidate.title && candidate.title !== label && isScanSnapImportDisplayTitle(candidate.title)) {
    return candidate.title;
  }
  return candidate.suggestedNotebook || "";
}

export function candidateGuidText(candidate) {
  return candidate.id ? `GUID: ${candidate.id}` : "GUID unavailable";
}

function isScanSnapImportDisplayTitle(title = "") {
  return /^\d{8}[_\s-]/.test(String(title).trim());
}

export function candidatePdfUrl(id) {
  return `/api/candidates/${encodeURIComponent(id)}/pdf`;
}

export function candidatePreviewUrl(id) {
  return `/api/candidates/${encodeURIComponent(id)}/preview`;
}

export function pdfPreviewUrl(url, { fitKey } = {}) {
  const base = String(url || "").split("#")[0];
  const versionedBase =
    fitKey === undefined
      ? base
      : `${base}${base.includes("?") ? "&" : "?"}previewFit=${encodeURIComponent(fitKey)}`;
  return `${versionedBase}#view=FitH&zoom=page-width`;
}

export function candidatePdfPreviewUrl(id, options = {}) {
  return pdfPreviewUrl(candidatePdfUrl(id), options);
}

const NEW_NOTEBOOK_VALUE = "__new_notebook__";

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export class PaneResizeController {
  constructor(
    {
      shell,
      leftHandle,
      rightHandle,
      storage = globalThis.localStorage,
      windowObject = globalThis.window,
      documentObject = globalThis.document,
      minLeft = 260,
      minRight = 300,
      minCenter = 420,
      handleWidth = 8,
      keyboardStep = 24,
    } = {}
  ) {
    this.shell = shell;
    this.handles = { left: leftHandle, right: rightHandle };
    this.storage = storage;
    this.windowObject = windowObject;
    this.documentObject = documentObject;
    this.minLeft = minLeft;
    this.minRight = minRight;
    this.minCenter = minCenter;
    this.handleWidth = handleWidth;
    this.keyboardStep = keyboardStep;
    this.leftWidth = this.readStoredWidth("left", 352);
    this.rightWidth = this.readStoredWidth("right", 384);
    this.drag = null;
  }

  bind() {
    this.applyWidths(this.leftWidth, this.rightWidth);
    this.bindHandle("left");
    this.bindHandle("right");
  }

  bindHandle(side) {
    const handle = this.handles[side];
    if (!handle?.addEventListener) return;
    handle.addEventListener("pointerdown", (event) => this.startDrag(side, event));
    handle.addEventListener("keydown", (event) => this.handleKeydown(side, event));
  }

  readStoredWidth(side, fallback) {
    const value = Number.parseFloat(this.storage?.getItem?.(`scansnap.${side}PaneWidth`) || "");
    return Number.isFinite(value) ? value : fallback;
  }

  shellWidth() {
    return this.shell?.getBoundingClientRect?.().width || this.windowObject?.innerWidth || 0;
  }

  maxLeft(rightWidth = this.rightWidth) {
    return Math.max(this.minLeft, this.shellWidth() - rightWidth - this.minCenter - this.handleWidth * 2);
  }

  maxRight(leftWidth = this.leftWidth) {
    return Math.max(this.minRight, this.shellWidth() - leftWidth - this.minCenter - this.handleWidth * 2);
  }

  normalizedWidths(leftWidth, rightWidth) {
    const left = clamp(leftWidth, this.minLeft, this.maxLeft(rightWidth));
    const right = clamp(rightWidth, this.minRight, this.maxRight(left));
    return { left, right };
  }

  applyWidths(leftWidth, rightWidth, { persist = true } = {}) {
    const widths = this.normalizedWidths(leftWidth, rightWidth);
    this.leftWidth = widths.left;
    this.rightWidth = widths.right;
    this.shell?.style?.setProperty?.("--left-pane-width", `${Math.round(widths.left)}px`);
    this.shell?.style?.setProperty?.("--right-pane-width", `${Math.round(widths.right)}px`);
    this.updateHandleValues();
    if (persist) this.persistWidths();
  }

  persistWidths() {
    this.storage?.setItem?.("scansnap.leftPaneWidth", String(Math.round(this.leftWidth)));
    this.storage?.setItem?.("scansnap.rightPaneWidth", String(Math.round(this.rightWidth)));
  }

  updateHandleValues() {
    this.handles.left?.setAttribute?.("aria-valuenow", String(Math.round(this.leftWidth)));
    this.handles.left?.setAttribute?.("aria-valuemin", String(this.minLeft));
    this.handles.left?.setAttribute?.("aria-valuemax", String(Math.round(this.maxLeft())));
    this.handles.right?.setAttribute?.("aria-valuenow", String(Math.round(this.rightWidth)));
    this.handles.right?.setAttribute?.("aria-valuemin", String(this.minRight));
    this.handles.right?.setAttribute?.("aria-valuemax", String(Math.round(this.maxRight())));
  }

  startDrag(side, event) {
    event?.preventDefault?.();
    this.drag = {
      side,
      startX: event?.clientX || 0,
      startLeft: this.leftWidth,
      startRight: this.rightWidth,
    };
    this.shell?.classList?.add?.("resizing");
    this.handles[side]?.setPointerCapture?.(event?.pointerId);
    this.windowObject?.addEventListener?.("pointermove", this.onPointerMove);
    this.windowObject?.addEventListener?.("pointerup", this.onPointerUp);
  }

  onPointerMove = (event) => {
    if (!this.drag) return;
    const delta = (event?.clientX || 0) - this.drag.startX;
    if (this.drag.side === "left") {
      this.applyWidths(this.drag.startLeft + delta, this.drag.startRight);
    } else {
      this.applyWidths(this.drag.startLeft, this.drag.startRight - delta);
    }
  };

  onPointerUp = () => {
    this.drag = null;
    this.shell?.classList?.remove?.("resizing");
    this.windowObject?.removeEventListener?.("pointermove", this.onPointerMove);
    this.windowObject?.removeEventListener?.("pointerup", this.onPointerUp);
  };

  handleKeydown(side, event) {
    const key = event?.key;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return;
    event?.preventDefault?.();
    if (side === "left") {
      const target =
        key === "Home" ? this.minLeft : key === "End" ? this.maxLeft() : this.leftWidth + (key === "ArrowRight" ? this.keyboardStep : -this.keyboardStep);
      this.applyWidths(target, this.rightWidth);
    } else {
      const target =
        key === "Home" ? this.minRight : key === "End" ? this.maxRight() : this.rightWidth + (key === "ArrowLeft" ? this.keyboardStep : -this.keyboardStep);
      this.applyWidths(this.leftWidth, target);
    }
  }
}

class CandidateListView {
  constructor({ list, onSelect }) {
    this.list = list;
    this.onSelect = onSelect;
    this.activeId = "";
  }

  setActive(id) {
    this.activeId = id;
    for (const item of this.list.querySelectorAll("[data-candidate-id]")) {
      item.classList.toggle("active", item.dataset.candidateId === id);
    }
    for (const button of this.list.querySelectorAll("button[data-id]")) {
      button.classList.toggle("active", button.dataset.id === id);
    }
  }

  render(candidates) {
    this.list.textContent = "";
    for (const candidate of candidates) {
      const item = document.createElement("li");
      item.className = "candidate-item";
      item.dataset.candidateId = candidate.id;
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.id = candidate.id;
      button.innerHTML = `
        <span class="candidate-title"></span>
        <span class="candidate-suggestion"></span>
      `;
      button.querySelector(".candidate-title").textContent = candidateLabel(candidate);
      button.querySelector(".candidate-suggestion").textContent = candidateSubtitle(candidate);
      button.addEventListener("click", () => this.onSelect(candidate.id));
      const guid = document.createElement("code");
      guid.className = "candidate-guid";
      guid.tabIndex = 0;
      guid.textContent = candidateGuidText(candidate);
      guid.setAttribute("aria-label", candidate.id ? `Candidate GUID ${candidate.id}` : "Candidate GUID unavailable");
      item.append(button, guid);
      this.list.append(item);
    }
  }
}

export class DetailView {
  constructor(
    elements,
    {
      resizeDelayMs = 180,
      widthThreshold = 8,
      widthPollMs = 300,
      resizeObserverClass = globalThis.ResizeObserver,
      windowObject = globalThis.window,
      setTimeoutFn = globalThis.setTimeout,
      clearTimeoutFn = globalThis.clearTimeout,
      setIntervalFn = globalThis.setInterval,
      clearIntervalFn = globalThis.clearInterval,
      requestAnimationFrameFn = globalThis.requestAnimationFrame,
    } = {}
  ) {
    this.elements = elements;
    this.currentPdfUrl = "";
    this.fitKey = 0;
    this.lastPreviewWidth = 0;
    this.resizeTimer = null;
    this.widthWatchTimer = null;
    this.resizeDelayMs = resizeDelayMs;
    this.widthThreshold = widthThreshold;
    this.widthPollMs = widthPollMs;
    this.windowObject = windowObject;
    const timerHost = this.windowObject || globalThis;
    this.setTimeout = typeof setTimeoutFn === "function" ? setTimeoutFn.bind(timerHost) : null;
    this.clearTimeout = typeof clearTimeoutFn === "function" ? clearTimeoutFn.bind(timerHost) : null;
    this.setInterval = typeof setIntervalFn === "function" ? setIntervalFn.bind(timerHost) : null;
    this.clearInterval = typeof clearIntervalFn === "function" ? clearIntervalFn.bind(timerHost) : null;
    this.requestAnimationFrame =
      typeof requestAnimationFrameFn === "function" ? requestAnimationFrameFn.bind(timerHost) : null;
    if (resizeObserverClass && (this.elements.pane || this.elements.frame)) {
      this.resizeObserver = new resizeObserverClass((entries = []) => {
        const width = entries[0]?.contentRect?.width || this.previewWidth();
        this.handlePreviewResize(width);
      });
      this.resizeObserver.observe(this.elements.pane || this.elements.frame);
    }
    this.windowObject?.addEventListener?.("resize", () => this.handlePreviewResize(this.previewWidth()));
  }

  renderEmpty(message) {
    this.currentPdfUrl = "";
    this.stopPreviewWidthWatch();
    this.elements.title.textContent = "Select a note";
    this.elements.frame.classList.add("hidden");
    this.elements.image?.classList.add("hidden");
    this.elements.link.classList.add("hidden");
    this.elements.empty.classList.remove("hidden");
    this.elements.empty.textContent = message;
  }

  renderLoading(id) {
    const url = candidatePreviewUrl(id);
    this.elements.title.textContent = "Loading note...";
    this.setPreviewUrl(url);
    this.elements.link.href = url;
    this.elements.frame.classList.remove("hidden");
    this.elements.image?.classList.add("hidden");
    this.elements.link.classList.remove("hidden");
    this.elements.empty.classList.add("hidden");
  }

  render(detail) {
    this.elements.title.textContent = detail.suggestion?.title || detail.title || "Untitled note";
    const preview = detail.preview || detail.pdf;
    if (preview?.url) {
      this.elements.link.href = preview.url;
      if (preview.kind === "image") {
        this.setImagePreviewUrl(preview.url);
      } else {
        this.setPreviewUrl(preview.url);
        this.elements.frame.classList.remove("hidden");
        this.elements.image?.classList.add("hidden");
      }
      this.elements.link.classList.remove("hidden");
      this.elements.empty.classList.add("hidden");
    } else {
      this.currentPdfUrl = "";
      this.elements.frame.classList.add("hidden");
      this.elements.image?.classList.add("hidden");
      this.elements.link.classList.add("hidden");
      this.elements.empty.classList.remove("hidden");
      this.elements.empty.textContent = "No PDF, Office document, or displayable image attachment was found for this note.";
    }
  }

  setImagePreviewUrl(url) {
    this.currentPdfUrl = "";
    this.stopPreviewWidthWatch();
    this.elements.frame.classList.add("hidden");
    if (this.elements.image) {
      this.elements.image.src = url;
      this.elements.image.classList.remove("hidden");
    }
  }

  setPreviewUrl(url, { force = false, rerenderFrame = false } = {}) {
    const baseUrl = String(url || "").split("#")[0];
    if (!force && this.currentPdfUrl === baseUrl && !this.elements.frame.classList.contains("hidden")) {
      return;
    }
    this.currentPdfUrl = baseUrl;
    this.lastPreviewWidth = this.previewWidth();
    this.fitKey += 1;
    const nextSrc = pdfPreviewUrl(baseUrl, { fitKey: this.fitKey });
    this.startPreviewWidthWatch();
    if (rerenderFrame) {
      this.rerenderPreviewFrame(nextSrc);
    } else {
      this.elements.frame.src = nextSrc;
    }
  }

  startPreviewWidthWatch() {
    if (this.widthWatchTimer || !this.setInterval || !this.widthPollMs) return;
    this.widthWatchTimer = this.setInterval(() => this.handlePreviewResize(this.previewWidth()), this.widthPollMs);
    this.widthWatchTimer?.unref?.();
  }

  stopPreviewWidthWatch() {
    if (!this.widthWatchTimer) return;
    this.clearInterval?.(this.widthWatchTimer);
    this.widthWatchTimer = null;
  }

  rerenderPreviewFrame(src) {
    const frame = this.elements.frame;
    if (frame?.parentNode && typeof frame.cloneNode === "function") {
      const replacement = frame.cloneNode(false);
      if (typeof frame.replaceWith === "function") {
        frame.replaceWith(replacement);
      } else {
        frame.parentNode.replaceChild(replacement, frame);
      }
      this.elements.frame = replacement;
      this.deferFrameSrc(replacement, src);
      return;
    }
    this.elements.frame.src = src;
  }

  deferFrameSrc(frame, src) {
    const assign = () => {
      frame.src = src;
    };
    if (typeof this.requestAnimationFrame === "function") {
      this.requestAnimationFrame(assign);
    } else {
      assign();
    }
  }

  previewWidth() {
    return (
      this.elements.pane?.getBoundingClientRect?.().width ||
      this.elements.frame?.getBoundingClientRect?.().width ||
      0
    );
  }

  handlePreviewResize(width = this.previewWidth()) {
    if (!this.currentPdfUrl || !width) return;
    if (this.lastPreviewWidth && Math.abs(width - this.lastPreviewWidth) < this.widthThreshold) return;
    this.lastPreviewWidth = width;
    if (this.resizeTimer) this.clearTimeout(this.resizeTimer);
    if (this.resizeDelayMs === 0) {
      this.refreshPreviewFit();
      return;
    }
    this.resizeTimer = this.setTimeout(() => this.refreshPreviewFit(), this.resizeDelayMs);
  }

  refreshPreviewFit() {
    if (!this.currentPdfUrl || this.elements.frame.classList.contains("hidden")) return;
    this.resizeTimer = null;
    this.setPreviewUrl(this.currentPdfUrl, { force: true, rerenderFrame: true });
  }
}

export class EditorView {
  constructor(elements) {
    this.elements = elements;
    this.deterministicSuggestion = null;
    this.llmSuggestion = null;
    this.selectedSuggestionSource = "deterministic";
    this.elements.notebook.addEventListener("change", () => this.syncNotebookMode());
    this.elements.useDeterministic?.addEventListener("click", () => this.useSuggestion("deterministic"));
    this.elements.useLlm?.addEventListener("click", () => this.useSuggestion("llm"));
  }

  render(detail) {
    const { suggestion } = detail;
    this.deterministicSuggestion = suggestion || {};
    this.llmSuggestion = null;
    this.selectedSuggestionSource = "deterministic";
    this.elements.fields.disabled = false;
    this.elements.notebook.textContent = "";
    for (const notebook of detail.notebooks || []) {
      const option = document.createElement("option");
      option.value = notebook.name;
      option.textContent = notebook.name;
      option.dataset.id = notebook.id;
      this.elements.notebook.append(option);
    }
    const newOption = document.createElement("option");
    newOption.value = NEW_NOTEBOOK_VALUE;
    newOption.textContent = "Create new notebook...";
    this.elements.notebook.append(newOption);
    this.applySuggestionToFields(suggestion, "deterministic", { fallbackTitle: detail.title || "" });
    this.elements.ocrSource.textContent = `OCR source: ${detail.ocr?.source || "none"}`;
    this.elements.ocr.value = detail.ocr?.excerpt || "";
    this.elements.runLlm.disabled = false;
    this.elements.llmStatus.textContent = "";
    this.renderSuggestionChoices();
    this.syncNotebookMode();
  }

  setLlmLoading(loading) {
    this.elements.runLlm.disabled = loading || this.elements.fields.disabled;
    this.elements.llmStatus.textContent = loading ? "Running..." : "";
  }

  setLlmError(message) {
    this.elements.runLlm.disabled = this.elements.fields.disabled;
    this.elements.llmStatus.textContent = message || "LLM failed";
  }

  renderLlmSettings(settings = {}) {
    if (this.elements.llmModel) this.elements.llmModel.value = settings.model || "";
    if (this.elements.saveLlmModel) this.elements.saveLlmModel.disabled = !settings.configured;
    if (this.elements.runLlm) this.elements.runLlm.disabled = !settings.configured || this.elements.fields.disabled;
    this.elements.llmStatus.textContent = settings.configured
      ? `LLM model: ${settings.model || "unset"}`
      : "LLM classification is not configured";
  }

  llmModelValue() {
    return String(this.elements.llmModel?.value || "").trim();
  }

  setLlmModelLoading(loading) {
    if (this.elements.saveLlmModel) this.elements.saveLlmModel.disabled = loading;
    this.elements.llmStatus.textContent = loading ? "Saving LLM model..." : "";
  }

  setLlmSuggestion(result = {}) {
    this.deterministicSuggestion = result.deterministicSuggestion || this.deterministicSuggestion;
    this.llmSuggestion = result.llmSuggestion || null;
    this.elements.runLlm.disabled = false;
    this.elements.llmStatus.textContent = this.llmSuggestion ? "Ready" : "No suggestion";
    this.renderSuggestionChoices();
  }

  useSuggestion(source) {
    const suggestion = source === "llm" ? this.llmSuggestion : this.deterministicSuggestion;
    if (!suggestion) return;
    this.applySuggestionToFields(suggestion, source);
    this.renderSuggestionChoices();
  }

  applySuggestionToFields(suggestion = {}, source = "deterministic", { fallbackTitle = "" } = {}) {
    this.selectedSuggestionSource = source;
    this.elements.title.value = suggestion.title || fallbackTitle;
    this.elements.tags.value = joinTags(suggestion.tags || []);
    this.selectNotebook(suggestion.notebook || "");
    this.elements.confidence.textContent = `${source === "llm" ? "LLM" : "Deterministic"}: ${confidenceText(suggestion)}`;
  }

  selectNotebook(name = "") {
    let matched = false;
    for (const option of this.elements.notebook.options || []) {
      const isMatch = option.value !== NEW_NOTEBOOK_VALUE && option.value === name;
      option.selected = isMatch;
      matched = matched || isMatch;
    }

    if (name && !matched) {
      this.elements.notebook.value = NEW_NOTEBOOK_VALUE;
      this.elements.newNotebook.value = name;
    } else {
      this.elements.newNotebook.value = "";
    }
    this.syncNotebookMode();
  }

  renderSuggestionChoices() {
    const hasLlm = Boolean(this.llmSuggestion);
    this.elements.choices?.classList.toggle("hidden", !hasLlm);
    if (!hasLlm) {
      if (this.elements.deterministicChoiceText) this.elements.deterministicChoiceText.textContent = "";
      if (this.elements.llmChoiceText) this.elements.llmChoiceText.textContent = "";
      return;
    }

    this.elements.deterministicChoiceText.textContent = suggestionChoiceText(this.deterministicSuggestion || {});
    this.elements.llmChoiceText.textContent = suggestionChoiceText(this.llmSuggestion || {});
    const deterministicSelected = this.selectedSuggestionSource === "deterministic";
    const llmSelected = this.selectedSuggestionSource === "llm";
    this.elements.useDeterministic.classList.toggle("selected", deterministicSelected);
    this.elements.useLlm.classList.toggle("selected", llmSelected);
    this.elements.useDeterministic.setAttribute?.("aria-pressed", String(deterministicSelected));
    this.elements.useLlm.setAttribute?.("aria-pressed", String(llmSelected));
  }

  payload() {
    const selected = this.elements.notebook.selectedOptions[0];
    const creatingNotebook = selected?.value === NEW_NOTEBOOK_VALUE;
    const notebook = creatingNotebook ? this.elements.newNotebook.value.trim() : this.elements.notebook.value;
    return {
      title: this.elements.title.value,
      tags: splitTags(this.elements.tags.value),
      notebook,
      notebookId: creatingNotebook ? "" : selected?.dataset.id || "",
      createNotebook: creatingNotebook,
      selectedSuggestionSource: this.selectedSuggestionSource,
    };
  }

  syncNotebookMode() {
    const creatingNotebook = this.elements.notebook.value === NEW_NOTEBOOK_VALUE;
    this.elements.newNotebookRow.classList.toggle("hidden", !creatingNotebook);
    this.elements.newNotebook.required = creatingNotebook;
  }
}

export class ReviewController {
  constructor({ api, listView, detailView, editorView, status, form, refreshButton, runLlmButton, saveLlmModelButton }) {
    this.api = api;
    this.listView = listView;
    this.detailView = detailView;
    this.editorView = editorView;
    this.status = status;
    this.form = form;
    this.refreshButton = refreshButton;
    this.runLlmButton = runLlmButton;
    this.saveLlmModelButton = saveLlmModelButton;
    this.activeId = "";
    this.selectionRequestId = 0;
    this.detailAbortController = null;
    this.llmAbortController = null;
  }

  bind() {
    this.refreshButton.addEventListener("click", () => this.loadCandidates());
    this.form.addEventListener("submit", (event) => this.apply(event));
    this.runLlmButton?.addEventListener("click", () => this.runLlmClassifier());
    this.saveLlmModelButton?.addEventListener("click", () => this.saveLlmModel());
    this.loadLlmSettings();
  }

  async loadLlmSettings() {
    if (typeof this.api.getLlmSettings !== "function") return;
    try {
      const settings = await this.api.getLlmSettings();
      this.editorView.renderLlmSettings?.(settings);
    } catch (error) {
      this.editorView.setLlmError?.(error.message);
    }
  }

  async saveLlmModel() {
    if (typeof this.api.updateLlmSettings !== "function") return;
    const model = this.editorView.llmModelValue?.() || "";
    this.editorView.setLlmModelLoading?.(true);
    try {
      const settings = await this.api.updateLlmSettings({ model });
      this.editorView.renderLlmSettings?.(settings);
      this.status.textContent = `LLM model set to ${settings.model}`;
    } catch (error) {
      this.editorView.setLlmError?.(error.message);
      this.status.textContent = error.message;
    }
  }

  async loadCandidates({ selectId = "" } = {}) {
    this.status.textContent = "Loading imported notes...";
    try {
      const { candidates } = await this.api.listCandidates();
      this.listView.render(candidates);
      this.status.textContent = `${candidates.length} imported notes ready`;
      const selected = candidates.find((candidate) => candidate.id === selectId) || candidates[0];
      if (selected) await this.select(selected.id);
    } catch (error) {
      this.status.textContent = error.message;
      this.detailView.renderEmpty(error.message || "Unable to load candidate notes.");
    }
  }

  async select(id) {
    this.activeId = id;
    const requestId = ++this.selectionRequestId;
    this.detailAbortController?.abort();
    this.llmAbortController?.abort();
    this.detailAbortController = typeof AbortController === "undefined" ? null : new AbortController();
    this.listView.setActive(id);
    this.detailView.renderLoading?.(id);
    this.status.textContent = "Loading note details...";
    try {
      const detail = await this.api.getCandidate(
        id,
        this.detailAbortController ? { signal: this.detailAbortController.signal } : {}
      );
      if (requestId !== this.selectionRequestId || this.activeId !== id) return;
      if (detail.id && detail.id !== id) {
        this.status.textContent = "Loaded details for a different note. Refresh and try again.";
        return;
      }
      this.detailView.render(detail);
      this.editorView.render(detail);
      this.status.textContent = "Review suggestion and apply changes";
    } catch (error) {
      if (requestId !== this.selectionRequestId || this.activeId !== id) return;
      this.status.textContent = error.message;
    }
  }

  async runLlmClassifier() {
    if (!this.activeId) return;
    const id = this.activeId;
    const requestId = this.selectionRequestId;
    this.llmAbortController?.abort();
    this.llmAbortController = typeof AbortController === "undefined" ? null : new AbortController();
    this.editorView.setLlmLoading(true);
    this.status.textContent = "Running LLM classifier...";

    try {
      const result = await this.api.runLlmClassifier(
        id,
        this.llmAbortController ? { signal: this.llmAbortController.signal } : {}
      );
      if (requestId !== this.selectionRequestId || this.activeId !== id) return;
      this.editorView.setLlmSuggestion(result);
      this.status.textContent = "LLM suggestion ready";
    } catch (error) {
      if (requestId !== this.selectionRequestId || this.activeId !== id) return;
      this.editorView.setLlmError(error.message);
      this.status.textContent = error.message;
    }
  }

  async apply(event) {
    event.preventDefault();
    if (!this.activeId) return;
    const appliedId = this.activeId;
    this.status.textContent = "Applying changes to Evernote...";
    try {
      const result = await this.api.applyCandidate(this.activeId, this.editorView.payload());
      this.status.textContent = result.warnings?.length ? result.warnings.join(" ") : "Updated Evernote note";
      await this.loadCandidates({ selectId: appliedId });
    } catch (error) {
      this.status.textContent = error.message;
    }
  }
}

function bootstrap() {
  const shell = document.querySelector(".app-shell");
  const paneResizeController = new PaneResizeController({
    shell,
    leftHandle: document.getElementById("leftResizeHandle"),
    rightHandle: document.getElementById("rightResizeHandle"),
  });
  paneResizeController.bind();

  const listView = new CandidateListView({
    list: document.getElementById("candidateList"),
    onSelect: (id) => controller.select(id),
  });
  const detailView = new DetailView({
    pane: document.querySelector(".pdf-pane"),
    title: document.getElementById("documentTitle"),
    frame: document.getElementById("pdfFrame"),
    image: document.getElementById("imagePreview"),
    link: document.getElementById("openPdfLink"),
    empty: document.getElementById("emptyPreview"),
  });
  const editorView = new EditorView({
    fields: document.getElementById("editorFields"),
    title: document.getElementById("titleInput"),
    tags: document.getElementById("tagsInput"),
    notebook: document.getElementById("notebookSelect"),
    newNotebookRow: document.getElementById("newNotebookRow"),
    newNotebook: document.getElementById("newNotebookInput"),
    confidence: document.getElementById("confidenceText"),
    ocrSource: document.getElementById("ocrSourceText"),
    ocr: document.getElementById("ocrExcerpt"),
    llmModel: document.getElementById("llmModelInput"),
    saveLlmModel: document.getElementById("saveLlmModelButton"),
    runLlm: document.getElementById("runLlmButton"),
    llmStatus: document.getElementById("llmStatusText"),
    choices: document.getElementById("suggestionChoices"),
    useDeterministic: document.getElementById("useDeterministicButton"),
    useLlm: document.getElementById("useLlmButton"),
    deterministicChoiceText: document.getElementById("deterministicChoiceText"),
    llmChoiceText: document.getElementById("llmChoiceText"),
  });
  const controller = new ReviewController({
    api: new ApiClient(),
    listView,
    detailView,
    editorView,
    status: document.getElementById("statusLine"),
    form: document.getElementById("reviewForm"),
    refreshButton: document.getElementById("refreshButton"),
    runLlmButton: document.getElementById("runLlmButton"),
    saveLlmModelButton: document.getElementById("saveLlmModelButton"),
  });
  controller.bind();
  controller.loadCandidates();
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", bootstrap);
}

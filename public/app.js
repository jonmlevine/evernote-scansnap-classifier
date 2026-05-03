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

class EditorView {
  constructor(elements) {
    this.elements = elements;
    this.elements.notebook.addEventListener("change", () => this.syncNotebookMode());
  }

  render(detail) {
    const { suggestion } = detail;
    this.elements.fields.disabled = false;
    this.elements.title.value = suggestion.title || detail.title || "";
    this.elements.tags.value = joinTags(suggestion.tags || []);
    this.elements.notebook.textContent = "";
    const suggestedNotebookExists = (detail.notebooks || []).some((notebook) => notebook.name === suggestion.notebook);
    for (const notebook of detail.notebooks || []) {
      const option = document.createElement("option");
      option.value = notebook.name;
      option.textContent = notebook.name;
      option.dataset.id = notebook.id;
      option.selected = notebook.name === suggestion.notebook;
      this.elements.notebook.append(option);
    }
    const newOption = document.createElement("option");
    newOption.value = NEW_NOTEBOOK_VALUE;
    newOption.textContent = "Create new notebook...";
    this.elements.notebook.append(newOption);
    if (suggestion.notebook && !suggestedNotebookExists) {
      newOption.selected = true;
      this.elements.newNotebook.value = suggestion.notebook;
    } else {
      this.elements.newNotebook.value = "";
    }
    this.elements.confidence.textContent = confidenceText(suggestion);
    this.elements.ocrSource.textContent = `OCR source: ${detail.ocr?.source || "none"}`;
    this.elements.ocr.value = detail.ocr?.excerpt || "";
    this.syncNotebookMode();
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
    };
  }

  syncNotebookMode() {
    const creatingNotebook = this.elements.notebook.value === NEW_NOTEBOOK_VALUE;
    this.elements.newNotebookRow.classList.toggle("hidden", !creatingNotebook);
    this.elements.newNotebook.required = creatingNotebook;
  }
}

export class ReviewController {
  constructor({ api, listView, detailView, editorView, status, form, refreshButton }) {
    this.api = api;
    this.listView = listView;
    this.detailView = detailView;
    this.editorView = editorView;
    this.status = status;
    this.form = form;
    this.refreshButton = refreshButton;
    this.activeId = "";
    this.selectionRequestId = 0;
    this.detailAbortController = null;
  }

  bind() {
    this.refreshButton.addEventListener("click", () => this.loadCandidates());
    this.form.addEventListener("submit", (event) => this.apply(event));
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
  });
  const controller = new ReviewController({
    api: new ApiClient(),
    listView,
    detailView,
    editorView,
    status: document.getElementById("statusLine"),
    form: document.getElementById("reviewForm"),
    refreshButton: document.getElementById("refreshButton"),
  });
  controller.bind();
  controller.loadCandidates();
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", bootstrap);
}

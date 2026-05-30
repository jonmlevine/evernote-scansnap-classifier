import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DetailView,
  EditorView,
  PaneResizeController,
  ReviewController,
  candidatePdfPreviewUrl,
  candidateGuidText,
  candidateLabel,
  candidateSubtitle,
  candidatePdfUrl,
  candidatePreviewUrl,
  confidenceText,
  joinTags,
  suggestionChoiceText,
  splitTags,
} from "../public/app.js";

function createClassList() {
  return {
    values: new Set(),
    add(value) {
      this.values.add(value);
    },
    remove(value) {
      this.values.delete(value);
    },
    contains(value) {
      return this.values.has(value);
    },
    toggle(value, force) {
      const shouldAdd = force === undefined ? !this.values.has(value) : Boolean(force);
      if (shouldAdd) this.values.add(value);
      else this.values.delete(value);
      return shouldAdd;
    },
  };
}

function createElementMock({ width = 0 } = {}) {
  const listeners = {};
  const attributes = {};
  return {
    attributes,
    classList: createClassList(),
    listeners,
    style: {
      values: {},
      setProperty(name, value) {
        this.values[name] = value;
      },
    },
    addEventListener(name, callback) {
      listeners[name] = callback;
    },
    removeEventListener(name) {
      delete listeners[name];
    },
    setAttribute(name, value) {
      attributes[name] = value;
    },
    setPointerCapture() {},
    getBoundingClientRect() {
      return { width };
    },
  };
}

function createStorageMock(values = {}) {
  return {
    values: { ...values },
    getItem(key) {
      return this.values[key] || null;
    },
    setItem(key, value) {
      this.values[key] = value;
    },
  };
}

function createNotebookMock(names = []) {
  const notebook = {
    value: "",
    options: [],
    textContent: "",
    addEventListener() {},
    append(option) {
      this.options.push(option);
    },
    get selectedOptions() {
      return this.options.filter((option) => option.selected);
    },
  };
  notebook.options = names.map((name) => {
    let selected = false;
    return {
      value: name,
      textContent: name,
      dataset: { id: `${name}-id` },
      get selected() {
        return selected;
      },
      set selected(value) {
        selected = Boolean(value);
        if (selected) notebook.value = name;
      },
    };
  });
  return notebook;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe("UI helpers", () => {
  it("resizes side panes independently and persists widths", () => {
    const shell = createElementMock({ width: 1400 });
    const leftHandle = createElementMock();
    const rightHandle = createElementMock();
    const storage = createStorageMock();
    const windowObject = createElementMock();
    const controller = new PaneResizeController({
      shell,
      leftHandle,
      rightHandle,
      storage,
      windowObject,
      minLeft: 260,
      minRight: 300,
      minCenter: 420,
    });

    controller.bind();
    assert.equal(shell.style.values["--left-pane-width"], "352px");
    assert.equal(shell.style.values["--right-pane-width"], "384px");

    rightHandle.listeners.pointerdown({ clientX: 1000, pointerId: 1, preventDefault() {} });
    windowObject.listeners.pointermove({ clientX: 900 });
    windowObject.listeners.pointerup({});

    assert.equal(shell.style.values["--left-pane-width"], "352px");
    assert.equal(shell.style.values["--right-pane-width"], "484px");
    assert.equal(storage.values["scansnap.rightPaneWidth"], "484");

    leftHandle.listeners.pointerdown({ clientX: 300, pointerId: 2, preventDefault() {} });
    windowObject.listeners.pointermove({ clientX: 360 });
    windowObject.listeners.pointerup({});

    assert.equal(shell.style.values["--left-pane-width"], "412px");
    assert.equal(shell.style.values["--right-pane-width"], "484px");
    assert.equal(storage.values["scansnap.leftPaneWidth"], "412");
  });

  it("clamps side pane resizing so the center panel remains usable", () => {
    const shell = createElementMock({ width: 1100 });
    const rightHandle = createElementMock();
    const controller = new PaneResizeController({
      shell,
      rightHandle,
      storage: createStorageMock(),
      windowObject: createElementMock(),
      minLeft: 260,
      minRight: 300,
      minCenter: 420,
    });

    controller.bind();
    rightHandle.listeners.pointerdown({ clientX: 900, pointerId: 1, preventDefault() {} });
    controller.windowObject.listeners.pointermove({ clientX: 100 });
    controller.windowObject.listeners.pointerup({});

    assert.equal(shell.style.values["--right-pane-width"], "404px");
  });

  it("supports keyboard resizing on pane handles", () => {
    const shell = createElementMock({ width: 1400 });
    const leftHandle = createElementMock();
    const rightHandle = createElementMock();
    const controller = new PaneResizeController({
      shell,
      leftHandle,
      rightHandle,
      storage: createStorageMock(),
      windowObject: createElementMock(),
      keyboardStep: 40,
    });

    controller.bind();
    leftHandle.listeners.keydown({ key: "ArrowRight", preventDefault() {} });
    rightHandle.listeners.keydown({ key: "ArrowLeft", preventDefault() {} });

    assert.equal(shell.style.values["--left-pane-width"], "392px");
    assert.equal(shell.style.values["--right-pane-width"], "424px");
  });

  it("formats tag input consistently", () => {
    assert.equal(joinTags(["Topic A", "Topic B"]), "Topic A; Topic B");
    assert.deepEqual(splitTags("Topic A; Topic B, Topic C"), ["Topic A", "Topic B", "Topic C"]);
  });

  it("shows confidence and candidate labels", () => {
    assert.equal(candidateLabel({ title: "20260420_scan", suggestedTitle: "Review Letter" }), "Review Letter");
    assert.equal(candidateSubtitle({ title: "20260420_scan", suggestedTitle: "Review Letter" }), "20260420_scan");
    assert.equal(candidateSubtitle({ title: "Review Letter", suggestedTitle: "Review Letter", suggestedNotebook: "Records" }), "Records");
    assert.equal(
      candidateSubtitle({
        title: "Original Document March 2026",
        suggestedTitle: "Updated Document April 2026",
        suggestedNotebook: "Target Notebook",
      }),
      "Target Notebook"
    );
    assert.equal(candidateGuidText({ id: "note-guid-1" }), "GUID: note-guid-1");
    assert.equal(candidatePdfUrl("note id/with spaces"), "/api/candidates/note%20id%2Fwith%20spaces/pdf");
    assert.equal(candidatePreviewUrl("note id/with spaces"), "/api/candidates/note%20id%2Fwith%20spaces/preview");
    assert.equal(candidatePdfPreviewUrl("note id/with spaces"), "/api/candidates/note%20id%2Fwith%20spaces/pdf#view=FitH&zoom=page-width");
    assert.equal(candidatePdfPreviewUrl("note-id", { fitKey: 3 }), "/api/candidates/note-id/pdf?previewFit=3#view=FitH&zoom=page-width");
    assert.equal(confidenceText({ confidence: 0.84, reason: "learned match" }), "84% confidence - learned match");
    assert.equal(
      suggestionChoiceText({
        title: "Review Title",
        notebook: "Review Notebook",
        tags: ["Tag A", "Tag B"],
        confidence: 0.92,
      }),
      "Review Title | Review Notebook | Tag A; Tag B | 92%"
    );
  });

  it("shows selectable deterministic and LLM suggestion panels after an LLM run", () => {
    const choices = { classList: createClassList() };
    choices.classList.add("hidden");
    const useDeterministic = createElementMock();
    const useLlm = createElementMock();
    const notebook = createNotebookMock(["Rule Notebook", "LLM Notebook"]);
    const view = new EditorView({
      fields: { disabled: false },
      notebook,
      newNotebook: { value: "", required: false },
      newNotebookRow: { classList: createClassList() },
      title: { value: "" },
      tags: { value: "" },
      confidence: { textContent: "" },
      ocrSource: { textContent: "" },
      ocr: { value: "" },
      runLlm: { disabled: false },
      llmStatus: { textContent: "" },
      choices,
      useDeterministic,
      useLlm,
      deterministicChoiceText: { textContent: "" },
      llmChoiceText: { textContent: "" },
    });

    view.setLlmSuggestion({
      deterministicSuggestion: {
        title: "Rule Title",
        tags: ["Rule Tag"],
        notebook: "Rule Notebook",
        confidence: 0.77,
      },
      llmSuggestion: {
        title: "LLM Title",
        tags: ["Tag A", "Tag B"],
        notebook: "LLM Notebook",
        confidence: 0.91,
      },
    });

    assert.equal(choices.classList.contains("hidden"), false);
    assert.match(view.elements.deterministicChoiceText.textContent, /Rule Title/);
    assert.match(view.elements.llmChoiceText.textContent, /LLM Title/);
    assert.equal(useDeterministic.attributes["aria-pressed"], "true");
    assert.equal(useLlm.attributes["aria-pressed"], "false");

    useLlm.listeners.click();

    assert.equal(view.elements.title.value, "LLM Title");
    assert.equal(view.elements.tags.value, "Tag A; Tag B");
    assert.equal(notebook.value, "LLM Notebook");
    assert.equal(useDeterministic.attributes["aria-pressed"], "false");
    assert.equal(useLlm.attributes["aria-pressed"], "true");
    assert.equal(view.payload().selectedSuggestionSource, "llm");
  });

  it("renders editable LLM model settings", () => {
    const modelInput = { value: "" };
    const saveModel = { disabled: false };
    const runLlm = { disabled: false };
    const view = new EditorView({
      fields: { disabled: false },
      notebook: createNotebookMock([]),
      newNotebook: { value: "", required: false },
      newNotebookRow: { classList: createClassList() },
      title: { value: "" },
      tags: { value: "" },
      confidence: { textContent: "" },
      ocrSource: { textContent: "" },
      ocr: { value: "" },
      llmModel: modelInput,
      saveLlmModel: saveModel,
      runLlm,
      llmStatus: { textContent: "" },
      choices: { classList: createClassList() },
      useDeterministic: createElementMock(),
      useLlm: createElementMock(),
      deterministicChoiceText: { textContent: "" },
      llmChoiceText: { textContent: "" },
    });

    view.renderLlmSettings({ configured: true, model: "qwen/qwen3.6-27b" });

    assert.equal(modelInput.value, "qwen/qwen3.6-27b");
    assert.equal(view.llmModelValue(), "qwen/qwen3.6-27b");
    assert.equal(saveModel.disabled, false);
    assert.equal(runLlm.disabled, false);
    assert.match(view.elements.llmStatus.textContent, /qwen\/qwen3\.6-27b/);
  });

  it("refreshes the PDF preview fit when the preview width changes", () => {
    const frame = {
      classList: createClassList(),
      src: "",
      getBoundingClientRect() {
        return { width: 500 };
      },
    };
    const pane = {
      getBoundingClientRect() {
        return { width: 500 };
      },
    };
    const view = new DetailView(
      {
        pane,
        title: { textContent: "" },
        frame,
        link: { href: "", classList: createClassList() },
        empty: { textContent: "", classList: createClassList() },
      },
      { resizeDelayMs: 0, resizeObserverClass: null }
    );

    view.renderLoading("note-1");
    assert.equal(frame.src, "/api/candidates/note-1/preview?previewFit=1#view=FitH&zoom=page-width");
    view.handlePreviewResize(760);
    assert.equal(frame.src, "/api/candidates/note-1/preview?previewFit=2#view=FitH&zoom=page-width");
  });

  it("remounts the PDF iframe after an observed panel width change", () => {
    let resizeCallback;
    let observedElement;
    const animationFrames = [];
    class FakeResizeObserver {
      constructor(callback) {
        resizeCallback = callback;
      }

      observe(element) {
        observedElement = element;
      }
    }

    let replacementFrame;
    const parentNode = {
      replaceChild(newFrame) {
        replacementFrame = newFrame;
        replacementFrame.parentNode = parentNode;
      },
    };
    function makeFrame() {
      return {
        classList: createClassList(),
        parentNode,
        src: "",
        cloneNode() {
          const clone = makeFrame();
          for (const value of this.classList.values) clone.classList.add(value);
          return clone;
        },
        getBoundingClientRect() {
          return { width: 500 };
        },
      };
    }

    const frame = makeFrame();
    const pane = {
      getBoundingClientRect() {
        return { width: 500 };
      },
    };
    const view = new DetailView(
      {
        pane,
        title: { textContent: "" },
        frame,
        link: { href: "", classList: createClassList() },
        empty: { textContent: "", classList: createClassList() },
      },
      {
        resizeDelayMs: 0,
        resizeObserverClass: FakeResizeObserver,
        windowObject: null,
        setIntervalFn: null,
        requestAnimationFrameFn(callback) {
          animationFrames.push(callback);
        },
      }
    );

    view.renderLoading("note-1");
    resizeCallback([{ contentRect: { width: 760 } }]);

    assert.equal(observedElement, pane);
    assert.notEqual(view.elements.frame, frame);
    assert.equal(view.elements.frame, replacementFrame);
    assert.equal(replacementFrame.src, "");
    animationFrames.shift()();
    assert.equal(replacementFrame.src, "/api/candidates/note-1/preview?previewFit=2#view=FitH&zoom=page-width");
  });

  it("polls preview width while a PDF is visible", () => {
    let width = 500;
    let intervalCallback;
    let intervalDelay;
    let unrefCalled = false;
    const frame = {
      classList: createClassList(),
      src: "",
      getBoundingClientRect() {
        return { width };
      },
    };
    const pane = {
      getBoundingClientRect() {
        return { width };
      },
    };
    const view = new DetailView(
      {
        pane,
        title: { textContent: "" },
        frame,
        link: { href: "", classList: createClassList() },
        empty: { textContent: "", classList: createClassList() },
      },
      {
        resizeDelayMs: 0,
        resizeObserverClass: null,
        windowObject: null,
        setIntervalFn(callback, delay) {
          intervalCallback = callback;
          intervalDelay = delay;
          return { unref: () => { unrefCalled = true; } };
        },
      }
    );

    view.renderLoading("note-1");
    width = 760;
    intervalCallback();

    assert.equal(intervalDelay, 300);
    assert.equal(unrefCalled, true);
    assert.equal(frame.src, "/api/candidates/note-1/preview?previewFit=2#view=FitH&zoom=page-width");
  });

  it("binds browser timer callbacks to the window object", () => {
    let intervalCallback;
    const windowObject = {
      setInterval(callback) {
        assert.equal(this, windowObject);
        intervalCallback = callback;
        return 1;
      },
      clearInterval(timer) {
        assert.equal(this, windowObject);
        assert.equal(timer, 1);
      },
    };
    const frame = { classList: createClassList(), src: "" };
    const view = new DetailView(
      {
        title: { textContent: "" },
        frame,
        link: { href: "", classList: createClassList() },
        empty: { textContent: "", classList: createClassList() },
      },
      {
        resizeObserverClass: null,
        windowObject,
        setIntervalFn: windowObject.setInterval,
        clearIntervalFn: windowObject.clearInterval,
      }
    );

    view.renderLoading("note-1");
    assert.equal(typeof intervalCallback, "function");
    view.renderEmpty("done");
  });

  it("renders displayable image previews without PDF fit hashes", () => {
    const frame = { classList: createClassList(), src: "" };
    const image = { classList: createClassList(), src: "" };
    const link = { href: "", classList: createClassList() };
    const empty = { textContent: "", classList: createClassList() };
    const view = new DetailView(
      {
        title: { textContent: "" },
        frame,
        image,
        link,
        empty,
      },
      { resizeObserverClass: null }
    );

    view.render({
      title: "Image note",
      preview: {
        kind: "image",
        url: "/api/candidates/note-1/preview",
        contentType: "image/jpeg",
      },
    });

    assert.equal(image.src, "/api/candidates/note-1/preview");
    assert.equal(image.classList.contains("hidden"), false);
    assert.equal(frame.classList.contains("hidden"), true);
    assert.equal(link.href, "/api/candidates/note-1/preview");
    assert.equal(view.currentPdfUrl, "");
  });

  it("uses the suggested title in the attached document header", () => {
    const frame = { classList: createClassList(), src: "" };
    const title = { textContent: "" };
    const view = new DetailView(
      {
        title,
        frame,
        link: { href: "", classList: createClassList() },
        empty: { textContent: "", classList: createClassList() },
      },
      { resizeObserverClass: null }
    );

    view.render({
      title: "Current Evernote Title",
      suggestion: { title: "Suggested Review Title" },
      preview: { kind: "pdf", url: "/api/candidates/note-1/preview" },
    });

    assert.equal(title.textContent, "Suggested Review Title");
  });

  it("contains the review application landmarks", async () => {
    const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
    const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
    assert.match(html, /id="candidateList"/);
    assert.match(html, /id="pdfFrame"/);
    assert.match(html, /id="imagePreview"/);
    assert.match(html, /id="leftResizeHandle"/);
    assert.match(html, /id="rightResizeHandle"/);
    assert.match(html, /id="reviewForm"/);
    assert.match(html, /<textarea id="tagsInput"/);
    assert.match(html, /id="newNotebookInput"/);
    assert.match(html, /id="llmModelInput"/);
    assert.match(html, /id="saveLlmModelButton"/);
    assert.match(html, /id="runLlmButton"/);
    assert.match(html, /id="suggestionChoices"/);
    assert.match(html, /id="useDeterministicButton"/);
    assert.match(html, /id="useLlmButton"/);
    assert.match(html, /Apply to Evernote/);
    assert.match(css, /--left-pane-width:\s*22rem/);
    assert.match(css, /--right-pane-width:\s*24rem/);
    assert.match(css, /\.resize-handle\s*{[^}]*cursor:\s*col-resize/s);
    assert.match(css, /\.candidate-guid\s*{[^}]*user-select:\s*text/s);
    assert.match(css, /\.suggestion-choices\s*{/);
    assert.match(css, /\.llm-model-field\s*{/);
    assert.match(css, /\.suggestion-choice\.selected\s*{/);
    assert.match(css, /\.pdf-frame\s*{[^}]*height:\s*calc\(100vh - 72px\)/s);
    assert.match(css, /input,\s*select,\s*textarea\s*{[^}]*width:\s*100%/s);
  });

  it("ignores stale note detail responses when selection changes quickly", async () => {
    const first = deferred();
    const second = deferred();
    const renderedDetails = [];
    const renderedEditors = [];
    const loadingPreviews = [];
    const requestSignals = [];
    const activeSelections = [];
    const status = { textContent: "" };
    const controller = new ReviewController({
      api: {
        getCandidate(id, options = {}) {
          requestSignals.push(options.signal);
          return id === "note-1" ? first.promise : second.promise;
        },
      },
      listView: {
        setActive(id) {
          activeSelections.push(id);
        },
      },
      detailView: {
        renderLoading(id) {
          loadingPreviews.push(id);
        },
        render(detail) {
          renderedDetails.push(detail);
        },
      },
      editorView: {
        render(detail) {
          renderedEditors.push(detail);
        },
      },
      status,
      form: { addEventListener() {} },
      refreshButton: { addEventListener() {} },
    });

    const firstSelect = controller.select("note-1");
    const secondSelect = controller.select("note-2");
    assert.equal(requestSignals[0].aborted, true);
    second.resolve({ id: "note-2", suggestion: { title: "Second Title", tags: ["Second"], notebook: "Second" } });
    await secondSelect;
    first.resolve({ id: "note-1", suggestion: { title: "First Title", tags: ["First"], notebook: "First" } });
    await firstSelect;

    assert.deepEqual(activeSelections, ["note-1", "note-2"]);
    assert.deepEqual(loadingPreviews, ["note-1", "note-2"]);
    assert.deepEqual(renderedDetails.map((detail) => detail.id), ["note-2"]);
    assert.deepEqual(renderedEditors.map((detail) => detail.suggestion.title), ["Second Title"]);
    assert.equal(controller.activeId, "note-2");
    assert.equal(status.textContent, "Review suggestion and apply changes");
  });

  it("runs the LLM classifier for the active note", async () => {
    const loadingStates = [];
    const suggestions = [];
    const requested = [];
    const status = { textContent: "" };
    const controller = new ReviewController({
      api: {
        async runLlmClassifier(id, options = {}) {
          requested.push([id, Boolean(options.signal)]);
          return {
            id,
            llmSuggestion: { title: "LLM Title", tags: ["Tag A"], notebook: "Notebook A" },
            deterministicSuggestion: { title: "Rule Title", tags: ["Tag B"], notebook: "Notebook B" },
          };
        },
      },
      listView: { setActive() {} },
      detailView: {},
      editorView: {
        setLlmLoading(value) {
          loadingStates.push(value);
        },
        setLlmSuggestion(result) {
          suggestions.push(result);
        },
        setLlmError(message) {
          throw new Error(message);
        },
      },
      status,
      form: { addEventListener() {} },
      refreshButton: { addEventListener() {} },
    });
    controller.activeId = "note-1";
    controller.selectionRequestId = 3;

    await controller.runLlmClassifier();

    assert.deepEqual(requested, [["note-1", true]]);
    assert.deepEqual(loadingStates, [true]);
    assert.equal(suggestions[0].llmSuggestion.title, "LLM Title");
    assert.equal(status.textContent, "LLM suggestion ready");
  });

  it("updates the active LLM model from the UI", async () => {
    const loadingStates = [];
    const settings = [];
    const requested = [];
    const status = { textContent: "" };
    const controller = new ReviewController({
      api: {
        async updateLlmSettings(payload) {
          requested.push(payload);
          return { configured: true, model: payload.model };
        },
      },
      listView: { setActive() {} },
      detailView: {},
      editorView: {
        llmModelValue() {
          return "qwen/qwen3.6-27b";
        },
        setLlmModelLoading(value) {
          loadingStates.push(value);
        },
        renderLlmSettings(value) {
          settings.push(value);
        },
        setLlmError(message) {
          throw new Error(message);
        },
      },
      status,
      form: { addEventListener() {} },
      refreshButton: { addEventListener() {} },
    });

    await controller.saveLlmModel();

    assert.deepEqual(requested, [{ model: "qwen/qwen3.6-27b" }]);
    assert.deepEqual(loadingStates, [true]);
    assert.deepEqual(settings, [{ configured: true, model: "qwen/qwen3.6-27b" }]);
    assert.equal(status.textContent, "LLM model set to qwen/qwen3.6-27b");
  });

  it("does not render note details returned for a different note id", async () => {
    const renderedDetails = [];
    const status = { textContent: "" };
    const controller = new ReviewController({
      api: {
        async getCandidate() {
          return { id: "wrong-note", suggestion: { title: "Wrong Title" } };
        },
      },
      listView: { setActive() {} },
      detailView: {
        render(detail) {
          renderedDetails.push(detail);
        },
      },
      editorView: { render() {} },
      status,
      form: { addEventListener() {} },
      refreshButton: { addEventListener() {} },
    });

    await controller.select("selected-note");

    assert.deepEqual(renderedDetails, []);
    assert.equal(status.textContent, "Loaded details for a different note. Refresh and try again.");
  });
});

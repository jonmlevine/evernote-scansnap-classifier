import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DetailView,
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
    assert.equal(joinTags(["Investment", "Tax"]), "Investment; Tax");
    assert.deepEqual(splitTags("Investment; Tax, Owner"), ["Investment", "Tax", "Owner"]);
  });

  it("shows confidence and candidate labels", () => {
    assert.equal(candidateLabel({ title: "20260420_scan", suggestedTitle: "Brokerage Letter" }), "Brokerage Letter");
    assert.equal(candidateSubtitle({ title: "20260420_scan", suggestedTitle: "Brokerage Letter" }), "20260420_scan");
    assert.equal(candidateSubtitle({ title: "Brokerage Letter", suggestedTitle: "Brokerage Letter", suggestedNotebook: "Investment" }), "Investment");
    assert.equal(
      candidateSubtitle({
        title: "Owner Prescription Information March 2026",
        suggestedTitle: "Owner Prescription Information April 2026",
        suggestedNotebook: "Medical",
      }),
      "Medical"
    );
    assert.equal(candidateGuidText({ id: "note-guid-1" }), "GUID: note-guid-1");
    assert.equal(candidatePdfUrl("note id/with spaces"), "/api/candidates/note%20id%2Fwith%20spaces/pdf");
    assert.equal(candidatePreviewUrl("note id/with spaces"), "/api/candidates/note%20id%2Fwith%20spaces/preview");
    assert.equal(candidatePdfPreviewUrl("note id/with spaces"), "/api/candidates/note%20id%2Fwith%20spaces/pdf#view=FitH&zoom=page-width");
    assert.equal(candidatePdfPreviewUrl("note-id", { fitKey: 3 }), "/api/candidates/note-id/pdf?previewFit=3#view=FitH&zoom=page-width");
    assert.equal(confidenceText({ confidence: 0.84, reason: "learned match" }), "84% confidence - learned match");
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
    assert.match(html, /Apply to Evernote/);
    assert.match(css, /--left-pane-width:\s*22rem/);
    assert.match(css, /--right-pane-width:\s*24rem/);
    assert.match(css, /\.resize-handle\s*{[^}]*cursor:\s*col-resize/s);
    assert.match(css, /\.candidate-guid\s*{[^}]*user-select:\s*text/s);
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

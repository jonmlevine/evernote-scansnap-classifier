import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ReviewNoteModel } from "../src/models/reviewNoteModel.js";

const officeAttachments = [
  {
    label: "PowerPoint",
    resourceId: "deck-resource",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    filename: "review-deck.pptx",
    bytes: "PPTXDATA",
    pdfFilename: "review-deck.pdf",
  },
  {
    label: "Word",
    resourceId: "word-resource",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    filename: "review-document.docx",
    bytes: "DOCXDATA",
    pdfFilename: "review-document.pdf",
  },
  {
    label: "Excel",
    resourceId: "sheet-resource",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    filename: "review-workbook.xlsx",
    bytes: "XLSXDATA",
    pdfFilename: "review-workbook.pdf",
  },
];

function createModel({ officeConverter, presentationConverter, attachment = officeAttachments[0] }) {
  return new ReviewNoteModel({
    maxCandidates: 10,
    officeConverter,
    presentationConverter,
    mcpClient: {
      async getNoteMetadata(id) {
        return { id, title: "20260420_office" };
      },
      async getNoteOcr() {
        return { resources: [] };
      },
      async listNotebooks() {
        return [];
      },
      async listTags() {
        return [];
      },
      async listAttachments(noteId) {
        return [
          {
            id: attachment.resourceId,
            noteId,
            mime: attachment.mime,
            filename: attachment.filename,
          },
        ];
      },
      async getResourceData(resourceId) {
        assert.equal(resourceId, attachment.resourceId);
        return {
          buffer: Buffer.from(attachment.bytes),
          contentType: attachment.mime,
        };
      },
    },
    learningStore: {
      async load() {
        return { examples: [], byGuid: new Map() };
      },
    },
    suggestionEngine: {
      async suggest() {
        return { title: "Review Deck", tags: [], notebook: "", confidence: 0.2 };
      },
    },
    localOcrStore: {
      async findText() {
        return "";
      },
    },
  });
}

describe("Office document previews", () => {
  for (const attachment of officeAttachments) {
    it(`advertises ${attachment.label} attachments as PDF previews`, async () => {
      const model = createModel({
        attachment,
        officeConverter: {
          async convert() {
            throw new Error("detail metadata should not convert");
          },
        },
      });

      const detail = await model.getCandidate("note-1");

      assert.equal(detail.pdf, null);
      assert.deepEqual(detail.preview, {
        resourceId: attachment.resourceId,
        filename: attachment.pdfFilename,
        contentType: "application/pdf",
        kind: "pdf",
        url: "/api/candidates/note-1/preview",
      });
    });

    it(`converts ${attachment.label} attachments to PDF for preview responses`, async () => {
      const calls = [];
      const model = createModel({
        attachment,
        officeConverter: {
          async convert(input) {
            calls.push(input);
            return {
              buffer: Buffer.from("%PDF"),
              contentType: "application/pdf",
              filename: attachment.pdfFilename,
            };
          },
        },
      });

      const preview = await model.getCandidatePreview("note-1");

      assert.equal(preview.buffer.toString("utf8"), "%PDF");
      assert.equal(preview.contentType, "application/pdf");
      assert.equal(preview.filename, attachment.pdfFilename);
      assert.equal(calls[0].resourceId, attachment.resourceId);
      assert.equal(calls[0].filename, attachment.filename);
      assert.equal(calls[0].buffer.toString("utf8"), attachment.bytes);
    });
  }

  it("detects Office previews from filenames when the MIME type is generic", async () => {
    const attachment = {
      ...officeAttachments[2],
      mime: "application/octet-stream",
    };
    const model = createModel({
      attachment,
      officeConverter: {
        async convert() {
          throw new Error("detail metadata should not convert");
        },
      },
    });

    const detail = await model.getCandidate("note-1");

    assert.deepEqual(detail.preview, {
      resourceId: "sheet-resource",
      filename: "review-workbook.pdf",
      contentType: "application/pdf",
      kind: "pdf",
      url: "/api/candidates/note-1/preview",
    });
  });

  it("keeps the old presentationConverter dependency name working", async () => {
    const calls = [];
    const model = createModel({
      presentationConverter: {
        async convert(input) {
          calls.push(input);
          return {
            buffer: Buffer.from("%PDF"),
            contentType: "application/pdf",
            filename: "review-deck.pdf",
          };
        },
      },
    });

    const preview = await model.getCandidatePreview("note-1");

    assert.equal(preview.contentType, "application/pdf");
    assert.equal(calls[0].filename, "review-deck.pptx");
  });

  it("reports when Office document conversion is not configured", async () => {
    const model = createModel({ officeConverter: null });

    await assert.rejects(
      () => model.getCandidatePreview("note-1"),
      (error) => error.status === 501 && /Office document preview conversion is not configured/.test(error.message)
    );
  });
});

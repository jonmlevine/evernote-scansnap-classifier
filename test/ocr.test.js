import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeOcrText, ocrDisplayExcerpt, ocrLearningSample } from "../src/models/ocr.js";

describe("OCR text helpers", () => {
  it("merges supplemental OCR when it adds missing page text", () => {
    const merged = mergeOcrText(
      "Document Date 04/30/26\nSee back for supplemental details",
      "Page 2 of 2\nSupplemental Details\nBack Page Evidence"
    );

    assert.match(merged, /Document Date 04\/30\/26/);
    assert.match(merged, /Page 2 of 2/);
    assert.match(merged, /Back Page Evidence/);
  });

  it("does not duplicate OCR text already present in backend results", () => {
    const merged = mergeOcrText(
      "Document Date 04/30/26 See back for supplemental details",
      "Document Date 04/30/26\nSee back for supplemental details"
    );

    assert.equal(merged, "Document Date 04/30/26 See back for supplemental details");
  });

  it("keeps page two evidence in long learning samples", () => {
    const firstPage = `${"first page filler ".repeat(90)}Document Date 04/30/26`;
    const secondPage = "Page 2 of 2 Supplemental Details Back Page Evidence Reference 123";
    const sample = ocrLearningSample(`${firstPage}\n${secondPage}`, {
      maxChars: 500,
      headChars: 120,
      pageChars: 240,
    });

    assert.ok(sample.length <= 500);
    assert.match(sample, /first page filler/);
    assert.match(sample, /Page 2 of 2/);
    assert.match(sample, /Back Page Evidence/);
  });

  it("keeps page two evidence in displayed excerpts", () => {
    const firstPage = `${"first page filler ".repeat(90)}Document Date 04/30/26`;
    const secondPage = "Page 2 of 2 Supplemental Details Back Page Evidence Reference 123";
    const excerpt = ocrDisplayExcerpt(`${firstPage}\n${secondPage}`);

    assert.match(excerpt, /first page filler/);
    assert.match(excerpt, /Page 2 of 2/);
    assert.match(excerpt, /Back Page Evidence/);
  });
});

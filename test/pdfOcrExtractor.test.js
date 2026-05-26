import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PdfOcrExtractor } from "../src/models/pdfOcrExtractor.js";

function fakeChild({ stdout = "", stderr = "", code = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  queueMicrotask(() => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.emit("close", code);
  });
  return child;
}

describe("PDF OCR extractor", () => {
  it("runs the configured OCR script with page bounds and caches the result", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "pdf-ocr-test-"));
    const calls = [];
    const extractor = new PdfOcrExtractor({
      cacheDir,
      command: "swift",
      scriptPath: "scripts/pdf-ocr-macos.swift",
      timeoutMs: 1000,
      maxPages: 4,
      spawnImpl(command, args, options) {
        calls.push({ command, args, options });
        return fakeChild({ stdout: "Page 2 of 2\nSupplemental Details\nBack Page Evidence" });
      },
    });

    try {
      const first = await extractor.extract({
        buffer: Buffer.from("PDF"),
        filename: "scan.pdf",
        resourceId: "resource-1",
        fromPage: 2,
      });
      const second = await extractor.extract({
        buffer: Buffer.from("PDF"),
        filename: "scan.pdf",
        resourceId: "resource-1",
        fromPage: 2,
      });

      assert.equal(first, "Page 2 of 2\nSupplemental Details\nBack Page Evidence");
      assert.equal(second, first);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].command, "swift");
      assert.deepEqual(calls[0].args.slice(0, 2), ["scripts/pdf-ocr-macos.swift", calls[0].args[1]]);
      assert.deepEqual(calls[0].args.slice(2), ["--from-page", "2", "--max-pages", "4"]);
      assert.match(calls[0].options.env.CLANG_MODULE_CACHE_PATH, /swift-module-cache$/);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("is disabled when no OCR command is configured", async () => {
    const extractor = new PdfOcrExtractor({
      cacheDir: "/tmp/unused",
      command: "",
      scriptPath: "scripts/pdf-ocr-macos.swift",
      spawnImpl() {
        throw new Error("should not spawn");
      },
    });

    const text = await extractor.extract({ buffer: Buffer.from("PDF"), resourceId: "resource-1" });

    assert.equal(text, "");
  });
});

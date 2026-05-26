import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

function extractionError(message, details = "") {
  const error = new Error(details ? `${message}: ${details}` : message);
  error.status = 502;
  return error;
}

export class PdfOcrExtractor {
  constructor({
    cacheDir,
    command = "",
    scriptPath = "",
    timeoutMs = 120_000,
    maxPages = 6,
    spawnImpl = spawn,
  }) {
    this.cacheDir = cacheDir;
    this.command = command;
    this.scriptPath = scriptPath;
    this.timeoutMs = timeoutMs;
    this.maxPages = maxPages;
    this.spawnImpl = spawnImpl;
  }

  async extract({ buffer, filename = "document.pdf", resourceId = "", fromPage = 1 }) {
    if (!this.command || !this.scriptPath || !this.cacheDir) return "";

    await mkdir(this.cacheDir, { recursive: true });
    const cacheKey = createHash("sha256")
      .update(resourceId)
      .update("\0")
      .update(filename)
      .update("\0")
      .update(String(fromPage))
      .update("\0")
      .update(buffer)
      .digest("hex");
    const cachedText = join(this.cacheDir, `${cacheKey}.txt`);

    try {
      return await readFile(cachedText, "utf8");
    } catch {
      // Cache miss.
    }

    const workDir = await mkdtemp(join(this.cacheDir, "ocr-"));
    const inputPath = join(workDir, "input.pdf");
    try {
      await writeFile(inputPath, buffer);
      const text = await this.runOcr([
        this.scriptPath,
        inputPath,
        "--from-page",
        String(fromPage),
        "--max-pages",
        String(this.maxPages),
      ]);
      await writeFile(cachedText, text, "utf8");
      return text;
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  runOcr(args) {
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        CLANG_MODULE_CACHE_PATH: join(this.cacheDir, "swift-module-cache"),
      };
      const child = this.spawnImpl(this.command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill?.();
        reject(extractionError("Timed out extracting PDF OCR"));
      }, this.timeoutMs);
      timer.unref?.();

      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
        if (stderr.length > 2000) stderr = stderr.slice(-2000);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        if (error.code === "ENOENT") {
          reject(extractionError(`PDF OCR command not found (${this.command})`));
          return;
        }
        reject(extractionError("Unable to start PDF OCR command", error.message));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve(stdout.trim());
          return;
        }
        reject(extractionError(`PDF OCR failed with exit code ${code}`, stderr.trim()));
      });
    });
  }
}

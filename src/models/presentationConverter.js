import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

const OFFICE_EXTENSIONS = new Set([
  ".ppt",
  ".pptx",
  ".pptm",
  ".pps",
  ".ppsx",
  ".ppsm",
  ".pot",
  ".potx",
  ".potm",
  ".odp",
  ".doc",
  ".docx",
  ".docm",
  ".dot",
  ".dotx",
  ".dotm",
  ".rtf",
  ".odt",
  ".xls",
  ".xlsx",
  ".xlsm",
  ".xlsb",
  ".xlt",
  ".xltx",
  ".xltm",
  ".xlam",
  ".ods",
]);

function safeExtension(filename = "") {
  const extension = extname(filename).toLowerCase();
  return OFFICE_EXTENSIONS.has(extension) ? extension : ".docx";
}

function pdfFilename(filename = "document.docx") {
  const base = basename(filename).replace(/\.[^.]+$/, "") || "document";
  return `${base}.pdf`;
}

function conversionError(message, details = "") {
  const error = new Error(details ? `${message}: ${details}` : message);
  error.status = 502;
  return error;
}

export class OfficeDocumentConverter {
  constructor({ cacheDir, command = "soffice", timeoutMs = 30_000, spawnImpl = spawn }) {
    this.cacheDir = cacheDir;
    this.command = command;
    this.timeoutMs = timeoutMs;
    this.spawnImpl = spawnImpl;
  }

  async convert({ buffer, filename = "document.docx", resourceId = "" }) {
    if (!this.cacheDir) {
      const error = new Error("Office document preview conversion cache is not configured");
      error.status = 501;
      throw error;
    }

    await mkdir(this.cacheDir, { recursive: true });
    const cacheKey = createHash("sha256")
      .update(resourceId)
      .update("\0")
      .update(filename)
      .update("\0")
      .update(buffer)
      .digest("hex");
    const cachedPdf = join(this.cacheDir, `${cacheKey}.pdf`);

    try {
      return {
        buffer: await readFile(cachedPdf),
        contentType: "application/pdf",
        filename: pdfFilename(filename),
      };
    } catch {
      // Cache miss.
    }

    const workDir = await mkdtemp(join(this.cacheDir, "convert-"));
    const inputPath = join(workDir, `input${safeExtension(filename)}`);
    try {
      await writeFile(inputPath, buffer);
      await this.runLibreOffice([
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        workDir,
        inputPath,
      ]);
      const outputPath = await this.findConvertedPdf(workDir);
      await copyFile(outputPath, cachedPdf);
      return {
        buffer: await readFile(cachedPdf),
        contentType: "application/pdf",
        filename: pdfFilename(filename),
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  async runLibreOffice(args) {
    return new Promise((resolve, reject) => {
      const child = this.spawnImpl(this.command, args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill?.();
        reject(conversionError("Timed out converting Office document preview"));
      }, this.timeoutMs);
      timer.unref?.();

      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
        if (stderr.length > 2000) stderr = stderr.slice(-2000);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        if (error.code === "ENOENT") {
          reject(conversionError(`LibreOffice command not found (${this.command})`));
          return;
        }
        reject(conversionError("Unable to start LibreOffice Office document converter", error.message));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
          return;
        }
        reject(conversionError(`Office document conversion failed with exit code ${code}`, stderr.trim()));
      });
    });
  }

  async findConvertedPdf(workDir) {
    const files = await readdir(workDir);
    const pdf = files.find((file) => file.toLowerCase().endsWith(".pdf"));
    if (!pdf) throw conversionError("Office document conversion did not produce a PDF");
    return join(workDir, pdf);
  }
}

export { OfficeDocumentConverter as PresentationConverter };

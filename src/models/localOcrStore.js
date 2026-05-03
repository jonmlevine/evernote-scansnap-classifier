import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

function safeName(value = "") {
  return value.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
}

async function readable(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export class LocalOcrStore {
  constructor({ localOcrDir }) {
    this.localOcrDir = localOcrDir;
  }

  async findText(note) {
    if (!this.localOcrDir) return "";
    const resources = Array.isArray(note?.resources) ? note.resources : [];
    const candidates = [
      note?.id && `${note.id}.txt`,
      note?.title && `${safeName(note.title)}.txt`,
      note?.title && `${safeName(note.title)}.ocr.txt`,
      ...resources.flatMap((resource) => [
        resource?.id && `${resource.id}.txt`,
        resource?.guid && `${resource.guid}.txt`,
        resource?.filename && `${safeName(resource.filename)}.txt`,
        resource?.filename && `${safeName(resource.filename)}.ocr.txt`,
      ]),
    ].filter(Boolean);

    for (const filename of candidates) {
      const path = join(this.localOcrDir, filename);
      if (await readable(path)) {
        return readFile(path, "utf8");
      }
    }

    return "";
  }
}

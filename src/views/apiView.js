export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

export function sendError(res, status, message, details = undefined) {
  sendJson(res, status, {
    error: message,
    ...(details === undefined ? {} : { details }),
  });
}

function asciiFilenameFallback(filename) {
  const fallback = String(filename || "document.pdf")
    .replace(/[\r\n\0]+/g, " ")
    .replace(/[^\x20-\x7e]+/g, "_")
    .replace(/["\\]+/g, "")
    .trim();
  return fallback || "document.pdf";
}

function encodeHeaderFilename(filename) {
  return encodeURIComponent(String(filename || "document.pdf").replace(/[\r\n\0]+/g, " "))
    .replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A");
}

export function contentDispositionHeader(filename = "document.pdf") {
  return `inline; filename="${asciiFilenameFallback(filename)}"; filename*=UTF-8''${encodeHeaderFilename(filename)}`;
}

export function sendBuffer(res, status, buffer, contentType, filename = "document.pdf") {
  res.writeHead(status, {
    "Content-Type": contentType || "application/pdf",
    "Content-Length": buffer.byteLength,
    "Content-Disposition": contentDispositionHeader(filename),
    "Cache-Control": "private, max-age=300",
  });
  res.end(buffer);
}

export async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("error", reject);
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON request body"));
      }
    });
  });
}

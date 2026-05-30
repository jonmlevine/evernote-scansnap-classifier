import { readJsonBody, sendBuffer, sendError, sendJson } from "../views/apiView.js";

function pathParts(url) {
  return url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
}

function statusFromError(error) {
  return error.status || error.statusCode || 500;
}

export class ReviewController {
  constructor({ reviewModel }) {
    this.reviewModel = reviewModel;
  }

  async handle(req, res, url) {
    const parts = pathParts(url);

    try {
      if (req.method === "GET" && url.pathname === "/api/health") {
        sendJson(res, 200, { ok: true });
        return true;
      }

      if (parts[0] === "api" && parts[1] === "llm" && parts[2] === "settings") {
        if (req.method === "GET") {
          sendJson(res, 200, this.reviewModel.getLlmSettings());
          return true;
        }

        if (req.method === "PATCH" || req.method === "PUT" || req.method === "POST") {
          const body = await readJsonBody(req);
          sendJson(res, 200, this.reviewModel.updateLlmSettings(body));
          return true;
        }
      }

      if (req.method === "GET" && url.pathname === "/api/candidates") {
        const limit = Number.parseInt(url.searchParams.get("limit") || "100", 10);
        sendJson(res, 200, { candidates: await this.reviewModel.listCandidates(limit) });
        return true;
      }

      if (parts[0] === "api" && parts[1] === "candidates" && parts[2]) {
        const id = parts[2];

        if (req.method === "GET" && parts.length === 3) {
          sendJson(res, 200, await this.reviewModel.getCandidate(id));
          return true;
        }

        if (req.method === "POST" && parts[3] === "llm-suggestion") {
          sendJson(res, 200, await this.reviewModel.getLlmSuggestion(id));
          return true;
        }

        if (req.method === "GET" && parts[3] === "pdf") {
          const pdf = await this.reviewModel.getCandidatePdf(id);
          sendBuffer(res, 200, pdf.buffer, pdf.contentType, pdf.filename);
          return true;
        }

        if (req.method === "GET" && parts[3] === "preview") {
          const preview = await this.reviewModel.getCandidatePreview(id);
          sendBuffer(res, 200, preview.buffer, preview.contentType, preview.filename);
          return true;
        }

        if ((req.method === "PATCH" || req.method === "POST") && parts.length === 3) {
          const body = await readJsonBody(req);
          sendJson(res, 200, await this.reviewModel.applyCandidate(id, body));
          return true;
        }
      }

      return false;
    } catch (error) {
      sendError(res, statusFromError(error), error.message || "Request failed", error.details);
      return true;
    }
  }
}

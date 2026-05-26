const ENTITY_MAP = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function decodeXmlEntities(value = "") {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return ENTITY_MAP[entity] || match;
  });
}

export function recognitionXmlToText(xml = "") {
  if (!xml) return "";
  return decodeXmlEntities(
    xml
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function htmlToText(html = "") {
  return decodeXmlEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function extractOcrText(noteOcr) {
  const resources = Array.isArray(noteOcr?.resources) ? noteOcr.resources : [];
  const texts = [];

  for (const resource of resources) {
    if (resource.searchText) texts.push(resource.searchText);
    const recognitionText = recognitionXmlToText(resource.recognition?.content || "");
    if (recognitionText) texts.push(recognitionText);
  }

  return [...new Set(texts.map((text) => text.trim()).filter(Boolean))].join("\n\n");
}

function compactWhitespace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function mergeOcrText(primary = "", supplemental = "") {
  const primaryText = String(primary || "").trim();
  const supplementalText = String(supplemental || "").trim();
  if (!primaryText) return supplementalText;
  if (!supplementalText) return primaryText;

  const primaryKey = compactWhitespace(primaryText).toLowerCase();
  const supplementalKey = compactWhitespace(supplementalText).toLowerCase();
  if (primaryKey.includes(supplementalKey)) return primaryText;
  if (supplementalKey.includes(primaryKey)) return supplementalText;

  return `${primaryText}\n\n${supplementalText}`;
}

export function ocrLearningSample(text = "", { maxChars = 1800, headChars = 900, pageChars = 900 } = {}) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;

  const pageMatch = normalized.match(/\bPage\s+2\s+of\s+\d+\b/i) || normalized.match(/\b2\s+of\s+\d+\b/i);
  if (!pageMatch) return normalized.slice(0, maxChars).trim();

  const head = normalized.slice(0, headChars).trim();
  const page = normalized.slice(pageMatch.index, pageMatch.index + pageChars).trim();
  return mergeOcrText(head, page).slice(0, maxChars).trim();
}

export function ocrDisplayExcerpt(text = "") {
  return ocrLearningSample(text, { maxChars: 1800, headChars: 900, pageChars: 900 });
}

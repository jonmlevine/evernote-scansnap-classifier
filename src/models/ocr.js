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

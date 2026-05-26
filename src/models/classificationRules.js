import { access } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const defaultClassificationRules = {
  strongMatchTokens: [],
  tagVocabulary: [],
  notebookVocabulary: [],
  llmInstructions: [],
  classifierInstructions: [],
  verifierInstructions: [],
  directSuggestion() {
    return null;
  },
  isMortgageText() {
    return false;
  },
  isInsuranceText() {
    return false;
  },
  inferTags(_text, tags) {
    return tags;
  },
  inferNotebook(_tags, notebook) {
    return notebook;
  },
  normalizeExactTags(tags) {
    return tags;
  },
  tagsForContext(tags) {
    return tags;
  },
  notebookForContext(notebook) {
    return notebook;
  },
  fallbackTitle(title) {
    return title;
  },
  normalizeSuggestedTitle(title) {
    return title;
  },
};

export function mergeClassificationRules(rules = {}) {
  return { ...defaultClassificationRules, ...(rules || {}) };
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function loadClassificationRules(path) {
  if (!path || !(await exists(path))) return defaultClassificationRules;
  const module = await import(pathToFileURL(path).href);
  return mergeClassificationRules(module.classificationRules || module.default || {});
}

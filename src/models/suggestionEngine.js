import {
  isCreditCardStatementContext,
  isScanSnapImportTitle,
  normalizeSuggestedTitle,
} from "./titleNormalization.js";
import { defaultClassificationRules, mergeClassificationRules } from "./classificationRules.js";
import { titleKey } from "./learningStore.js";

const STOP_TOKENS = new Set(["the", "and", "for", "with", "from", "this", "that", "your", "you", "not"]);
const GENERIC_MATCH_TOKENS = new Set([
  "account",
  "amount",
  "balance",
  "current",
  "date",
  "document",
  "information",
  "letter",
  "number",
  "page",
  "payment",
  "plan",
  "please",
  "statement",
]);
const STRONG_MATCH_TOKENS = new Set([
  "loan",
  "medical",
  "mortgage",
  "pharmacy",
  "policy",
  "retirement",
]);

function tokenize(value = "", { forMatch = false } = {}) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => {
      if (token.length <= 2 || STOP_TOKENS.has(token)) return false;
      return !forMatch || !GENERIC_MATCH_TOKENS.has(token);
    });
}

function titleCase(value = "") {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase())
    .replace(/\bIra\b/g, "IRA")
    .replace(/\bPdf\b/g, "PDF");
}

function scanDateFromTitle(title = "") {
  const match = title.match(/^(\d{4})(\d{2})(\d{2})[_\s-]/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MONTH_WORD_PATTERN = [
  ...MONTHS,
  "Sept\\.?",
  "Jan\\.?",
  "Feb\\.?",
  "Mar\\.?",
  "Apr\\.?",
  "Jun\\.?",
  "Jul\\.?",
  "Aug\\.?",
  "Sep\\.?",
  "Oct\\.?",
  "Nov\\.?",
  "Dec\\.?",
].join("|");
const MONTH_ALIASES = new Map([
  ...MONTHS.map((month) => [month.toLowerCase(), month]),
  ["jan", "January"],
  ["feb", "February"],
  ["mar", "March"],
  ["apr", "April"],
  ["jun", "June"],
  ["jul", "July"],
  ["aug", "August"],
  ["sep", "September"],
  ["sept", "September"],
  ["oct", "October"],
  ["nov", "November"],
  ["dec", "December"],
]);

function normalizeYear(year) {
  const value = Number.parseInt(year, 10);
  return value < 100 ? 2000 + value : value;
}

function normalizeMonthName(month) {
  return MONTH_ALIASES.get(String(month).toLowerCase().replace(/\.$/, "")) || "";
}

function normalizeDay(day) {
  const value = Number.parseInt(String(day).replace(/[lI]/g, "1"), 10);
  return value >= 1 && value <= 31 ? value : undefined;
}

function dateParts(month, day, year) {
  const monthNumber = Number.parseInt(month, 10);
  if (!monthNumber || monthNumber < 1 || monthNumber > 12) return null;
  return {
    month: MONTHS[monthNumber - 1],
    day: Number.parseInt(day, 10),
    year: normalizeYear(year),
  };
}

function namedDateParts(month, day, year) {
  const normalizedMonth = normalizeMonthName(month);
  const normalizedDay = normalizeDay(day);
  if (!normalizedMonth || !normalizedDay) return null;
  return {
    month: normalizedMonth,
    day: normalizedDay,
    year: normalizeYear(year),
  };
}

function documentDateFromText(text = "", { preferLabeledDate = false } = {}) {
  const statementPeriodRange = text.match(
    /\bstatement\s+period\b[^\d]{0,80}(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\s*(?:-|to|through)\s*(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/i
  );
  if (preferLabeledDate && statementPeriodRange) {
    return dateParts(statementPeriodRange[4], statementPeriodRange[5], statementPeriodRange[6]);
  }
  const statementPeriodRangeBeforeLabel = text.match(
    /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\s*(?:-|to|through)\s*(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})[^\n]{0,80}statement\s+period\b/i
  );
  if (preferLabeledDate && statementPeriodRangeBeforeLabel) {
    return dateParts(
      statementPeriodRangeBeforeLabel[4],
      statementPeriodRangeBeforeLabel[5],
      statementPeriodRangeBeforeLabel[6]
    );
  }
  const namedDatePattern = `(${MONTH_WORD_PATTERN})\\s+([0-9lI]{1,2}),?\\s+(\\d{4})`;
  const namedStatementPeriodRange = text.match(
    new RegExp(
      `\\bstatement\\s+period\\b[^A-Za-z0-9]{0,80}${namedDatePattern}\\s*(?:-|to|through)\\s*${namedDatePattern}`,
      "i"
    )
  );
  if (preferLabeledDate && namedStatementPeriodRange) {
    return namedDateParts(namedStatementPeriodRange[4], namedStatementPeriodRange[5], namedStatementPeriodRange[6]);
  }
  const numericBillingCycleRange = text.match(
    /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\s*(?:-|to|through)\s*(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})[^\n]{0,80}\bbilling\s+cycle\b/i
  );
  if (preferLabeledDate && numericBillingCycleRange) {
    return dateParts(numericBillingCycleRange[4], numericBillingCycleRange[5], numericBillingCycleRange[6]);
  }
  const namedBillingCycleRange = text.match(
    new RegExp(`${namedDatePattern}\\s*(?:-|to|through)\\s*${namedDatePattern}[^\\n]{0,80}\\bbilling\\s+cycle\\b`, "i")
  );
  if (preferLabeledDate && namedBillingCycleRange) {
    return namedDateParts(namedBillingCycleRange[4], namedBillingCycleRange[5], namedBillingCycleRange[6]);
  }
  const closingDate = text.match(/\b(?:statement\s+closing\s+date|closing\s+date)\b[^\d]{0,80}(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/i);
  if (preferLabeledDate && closingDate) {
    return dateParts(closingDate[1], closingDate[2], closingDate[3]);
  }
  const statementDate = text.match(/\bstatement\s+date\b[^\d]{0,80}(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/i);
  if (preferLabeledDate && statementDate) {
    return dateParts(statementDate[1], statementDate[2], statementDate[3]);
  }
  const labeled = text.match(/\b(?:statement\s+date|document\s+date|date)\s*[:\-]?\s*(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/i);
  if (preferLabeledDate && labeled) return dateParts(labeled[1], labeled[2], labeled[3]);
  const named = text.match(
    new RegExp(`\\b(${MONTH_WORD_PATTERN})\\s+([0-9lI]{1,2}),?\\s+(\\d{4})\\b`, "i")
  );
  if (named) {
    return namedDateParts(named[1], named[2], named[3]);
  }
  const namedMonthYear = text.match(
    new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{4})\\b`, "i")
  );
  if (namedMonthYear) {
    return {
      month: MONTHS.find((month) => month.toLowerCase() === namedMonthYear[1].toLowerCase()),
      day: undefined,
      year: Number.parseInt(namedMonthYear[2], 10),
    };
  }
  if (labeled) return dateParts(labeled[1], labeled[2], labeled[3]);
  const anyDate = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  return anyDate ? dateParts(anyDate[1], anyDate[2], anyDate[3]) : null;
}

function titleWithCurrentDate(title = "", ocrText = "", { monthYearOnly = false, preferLabeledDate = false } = {}) {
  const date = documentDateFromText(ocrText, { preferLabeledDate });
  if (!date) return title;
  const monthPattern = MONTHS.join("|");
  const withMonth = `${date.month} ${date.year}`;
  const withDay = date.day ? `${date.month} ${date.day}, ${date.year}` : withMonth;
  const fullDatePattern = new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`);
  const fullDate = title.match(fullDatePattern);
  if (fullDate) {
    const sameDate =
      fullDate[1].toLowerCase() === date.month.toLowerCase() &&
      Number.parseInt(fullDate[2], 10) === date.day &&
      Number.parseInt(fullDate[3], 10) === date.year;
    if (sameDate) return title;
    return title.replace(fullDatePattern, monthYearOnly ? withMonth : withDay);
  }
  return title.replace(new RegExp(`\\b(${monthPattern})\\s+\\d{4}\\b`), withMonth);
}

function splitTags(value = []) {
  if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter(Boolean);
  return String(value)
    .split(/[;,]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function cleanupTitleFromScanTitle(title = "") {
  return title
    .replace(/^\d{8}[_\s-]*/, "")
    .replace(/[^a-zA-Z0-9&.' -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferTags(text, rules = defaultClassificationRules) {
  const lower = text.toLowerCase();
  const mortgage = isMortgageText(lower, rules);
  const tags = [];
  if (/patient|prescription|pharmacy|medical|doctor|benefit/.test(lower)) tags.push("Medical");
  if (/statement|account|balance|transaction|payment/.test(lower)) tags.push("Statements");
  if (mortgage) {
    tags.push("Mortgage", "Banking");
  }
  if (!mortgage && /investment|ira|fund|retirement/.test(lower)) tags.push("Investment");
  if (!mortgage && /invoice|receipt|total charges|amount due/.test(lower)) tags.push("Receipts");
  if (!mortgage && /insurance|premium|policy/.test(lower)) tags.push("Insurance");
  return [...new Set(rules.inferTags(lower, tags))];
}

function isMortgageText(text = "", rules = defaultClassificationRules) {
  const lower = text.toLowerCase();
  return /loan statement|mortgage/.test(lower) || rules.isMortgageText(lower);
}

function isInsuranceText(text = "", rules = defaultClassificationRules) {
  const lower = text.toLowerCase();
  return /insurance|policy|premium|insured|notice of lapse/.test(lower) || rules.isInsuranceText(lower);
}

function isIraText(text = "") {
  return /\bira\b|individual retirement account/i.test(text);
}

function normalizeExactTagsForContext(tags, example, context, rules = defaultClassificationRules) {
  let normalizedTags = tags;
  if (
    isIraText(context) &&
    (normalizedTags.some((tag) => /^investment$/i.test(tag)) || /^investment$/i.test(example.suggestedNotebook || "")) &&
    !normalizedTags.some((tag) => /^ira$/i.test(tag))
  ) {
    normalizedTags = [...normalizedTags, "IRA"];
  }
  const insuranceContext =
    /^insurance$/i.test(example.suggestedNotebook || "") ||
    normalizedTags.some((tag) => /^insurance$/i.test(tag)) ||
    isInsuranceText(example.suggestedTitle || "", rules);
  if (
    insuranceContext &&
    !isMortgageText(context, rules) &&
    !isCreditCardStatementContext(example.suggestedTitle || "", normalizedTags, context)
  ) {
    const normalized = normalizedTags.filter((tag) => tag.toLowerCase() !== "banking");
    if (!normalized.some((tag) => tag.toLowerCase() === "insurance")) normalized.push("Insurance");
    normalizedTags = normalized;
  }
  return rules.normalizeExactTags(normalizedTags, { example, context });
}

function mortgageTags(tags, context = "", rules = defaultClassificationRules) {
  return [...new Set(rules.tagsForContext(["Statements", "Mortgage", "Banking"], { tags, context, type: "mortgage" }))];
}

function inferNotebook(tags, rules = defaultClassificationRules) {
  const tagSet = new Set(tags.map((tag) => tag.toLowerCase()));
  let notebook = "Scanned Items Notebook";
  if (tagSet.has("medical")) notebook = "Medical";
  if (tagSet.has("mortgage") || tagSet.has("banking")) return "Banking";
  if (tagSet.has("investment")) notebook = "Investment";
  if (tagSet.has("insurance")) notebook = "Insurance";
  if (tagSet.has("receipts")) notebook = "Receipts";
  return rules.inferNotebook(tags, notebook);
}

function exampleText(example) {
  return `${example.originalTitle} ${example.suggestedTitle} ${example.ocrEvidence} ${example.suggestedTags.join(" ")}`;
}

function matchTokenSet(value) {
  return new Set(tokenize(value, { forMatch: true }));
}

function documentFrequency(examples) {
  const frequency = new Map();
  for (const example of examples) {
    for (const token of matchTokenSet(exampleText(example))) {
      frequency.set(token, (frequency.get(token) || 0) + 1);
    }
  }
  return frequency;
}

function tokenWeight(token, frequency, totalExamples, rules = defaultClassificationRules) {
  if (/^\d{6,}$/.test(token)) return 4;
  if (STRONG_MATCH_TOKENS.has(token) || rules.strongMatchTokens.includes(token)) return 3;
  const count = frequency.get(token) || 0;
  return Math.max(1, Math.log2(1 + totalExamples / (count + 1)));
}

function documentTypes(text = "", rules = defaultClassificationRules) {
  const lower = text.toLowerCase();
  const types = new Set();
  if (/loan statement/.test(lower) || (isMortgageText(lower, rules) && /statement date|payment due date/.test(lower))) {
    types.add("loan statement");
  }
  if (/acknowledg(?:e)?ment|underwriting|loan processing/.test(lower)) types.add("loan acknowledgment");
  return types;
}

function documentTypeScore(haystackText, exampleTextValue, rules = defaultClassificationRules) {
  const haystackTypes = documentTypes(haystackText, rules);
  const exampleTypes = documentTypes(exampleTextValue, rules);
  let score = 0;
  const strongMatches = [];

  for (const type of haystackTypes) {
    if (exampleTypes.has(type)) {
      score += 6;
      strongMatches.push(type);
    }
  }
  if (haystackTypes.has("loan statement") && exampleTypes.has("loan acknowledgment")) score -= 6;

  return { score, strongMatches };
}

function scoreExample(example, haystackTokens, haystackText, frequency, totalExamples, rules = defaultClassificationRules) {
  const exampleTextValue = exampleText(example);
  const overlaps = [...matchTokenSet(exampleTextValue)].filter((token) => haystackTokens.has(token));
  const strongMatches = overlaps.filter(
    (token) => STRONG_MATCH_TOKENS.has(token) || rules.strongMatchTokens.includes(token) || /^\d{6,}$/.test(token)
  );
  const typeMatch = documentTypeScore(haystackText, exampleTextValue, rules);
  const score = typeMatch.score + overlaps.reduce(
    (total, token) => total + tokenWeight(token, frequency, totalExamples, rules),
    0
  );
  return { score, overlaps, strongMatches: [...strongMatches, ...typeMatch.strongMatches] };
}

function findExactOriginalTitleExample(examples, title) {
  const key = titleKey(title);
  if (!key) return null;
  for (let index = examples.length - 1; index >= 0; index -= 1) {
    const example = examples[index];
    if (titleKey(example.originalTitle) === key && example.suggestedTitle) return example;
  }
  return null;
}

export class SuggestionEngine {
  constructor({ learningStore, rules }) {
    this.learningStore = learningStore;
    this.rules = mergeClassificationRules(rules);
  }

  async suggest(note, ocrText = "") {
    const { examples, byGuid, byOriginalTitle } = await this.learningStore.load();
    const exact = byGuid.get(note.id);
    if (exact) {
      return this.fromExample(exact, "Exact match from existing ScanSnap suggestions", 0.96, {
        ocrText,
        preserveClassification: true,
      });
    }

    const exactTitle = byOriginalTitle?.get(titleKey(note.title)) || findExactOriginalTitleExample(examples, note.title);
    if (exactTitle) {
      return this.fromExample(exactTitle, "Exact match from existing ScanSnap title", 0.9, {
        ocrText,
        preserveClassification: true,
      });
    }

    const haystack = `${note.title || ""} ${ocrText}`.toLowerCase();
    const haystackTokens = matchTokenSet(haystack);
    const frequency = documentFrequency(examples);
    let best = null;
    let bestMatch = null;
    let bestScore = 0;

    for (const example of examples) {
      const compatible = !isMortgageText(haystack, this.rules) || isMortgageText(exampleText(example), this.rules);
      if (!compatible) continue;
      const match = scoreExample(example, haystackTokens, haystack, frequency, examples.length || 1, this.rules);
      const eligible = match.score >= 6 && match.strongMatches.length >= 2;
      if (eligible && match.score > bestScore) {
        best = example;
        bestMatch = match;
        bestScore = match.score;
      }
    }

    if (best) {
      return this.fromExample(
        best,
        `Closest learned pattern matched ${bestMatch.strongMatches.slice(0, 4).join(", ")}`,
        Math.min(0.85, 0.55 + bestScore / 25),
        { ocrText }
      );
    }

    const tags = inferTags(haystack, this.rules);
    const cleaned = cleanupTitleFromScanTitle(note.title || "");
    const date = scanDateFromTitle(note.title || "");
    const mortgageContext = isMortgageText(haystack, this.rules);
    const inferredDate = documentDateFromText(ocrText, { preferLabeledDate: mortgageContext });
    const fallbackType = mortgageContext ? "mortgage" : "fallback";
    const baseFallbackTitle = mortgageContext
      ? `Mortgage ${inferredDate ? `${inferredDate.month} ${inferredDate.year}` : date || "Undated"} Statement`
      : cleaned
      ? titleCase(cleaned).split(" ").slice(0, 10).join(" ")
      : `${date || "Undated"} Scanned Document`;
    const fallbackTitle = this.rules.fallbackTitle(baseFallbackTitle, {
      context: haystack,
      inferredDate,
      date,
      type: fallbackType,
      tags,
    });

    return {
      title: fallbackTitle,
      tags,
      notebook: inferNotebook(tags, this.rules),
      confidence: 0.35,
      reason: "Fallback guess from current title and OCR keywords",
      source: "fallback",
    };
  }

  fromExample(example, reason, confidence, { ocrText = "", preserveClassification = false } = {}) {
    const context = `${exampleText(example)} ${ocrText}`;
    const rawTags = splitTags(example.suggestedTags);
    const mortgageContext = Boolean(ocrText && isMortgageText(context, this.rules));
    const baseTags = !preserveClassification && mortgageContext ? mortgageTags(rawTags, context, this.rules) : rawTags;
    const tags = preserveClassification ? normalizeExactTagsForContext(baseTags, example, context, this.rules) : baseTags;
    const learnedTitle = isScanSnapImportTitle(example.suggestedTitle) ? "" : example.suggestedTitle;
    const title = normalizeSuggestedTitle(
      titleWithCurrentDate(
        learnedTitle || cleanupTitleFromScanTitle(example.originalTitle),
        ocrText,
        {
          monthYearOnly: mortgageContext && /statement/i.test(learnedTitle || ""),
          preferLabeledDate: /statement/i.test(learnedTitle || ""),
        }
      ),
      { tags, ocrText, rules: this.rules }
    );
    return {
      title,
      tags,
      notebook:
        !preserveClassification && mortgageContext
          ? this.rules.notebookForContext("Banking", { tags, context, type: "mortgage", preserveClassification })
          : this.rules.notebookForContext(example.suggestedNotebook || inferNotebook(tags, this.rules), {
              tags,
              context,
              preserveClassification,
            }),
      confidence,
      reason,
      source: example.source,
    };
  }
}

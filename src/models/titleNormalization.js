const MONTH_PATTERN = "January|February|March|April|May|June|July|August|September|October|November|December";

export function isScanSnapImportTitle(title = "") {
  return /^\d{8}_.+/.test(String(title).trim());
}

export function isCreditCardStatementContext(title = "", tags = [], ocrText = "") {
  const context = `${title} ${tags.join(" ")} ${ocrText}`.toLowerCase();
  const creditCard = /credit\s*card|creditcard|visa|mastercard|american express|amex|\bcard\b/.test(context);
  const statement = /statement|statement period|statement closing date|closing date|open date/.test(context);
  return creditCard && statement;
}

function hasTag(tags, name) {
  return tags.some((tag) => tag.toLowerCase() === name);
}

function isInsurancePremiumNoticeStatement(title = "", tags = [], ocrText = "") {
  const context = `${title} ${tags.join(" ")} ${ocrText}`.toLowerCase();
  return (
    /\binsurance\b.*\bpremium notice\b/i.test(title) &&
    hasTag(tags, "insurance") &&
    (hasTag(tags, "statements") || /\bstatement\b/.test(context))
  );
}

function normalizeInsurancePremiumNoticeStatement(title = "") {
  const datedPremiumNotice = new RegExp(`\\bPremium Notice\\s+(${MONTH_PATTERN})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "i");
  if (datedPremiumNotice.test(title)) {
    return title.replace(datedPremiumNotice, "$1 $2 $3 Statement");
  }
  return title.replace(/\bPremium Notice\b/gi, "Statement");
}

export function normalizeSuggestedTitle(title = "", { tags = [], ocrText = "", rules = {} } = {}) {
  let normalized = title;
  if (isCreditCardStatementContext(normalized, tags, ocrText)) {
    normalized = normalized.replace(/\bPayment Notice\b/gi, "Statement");
  }
  if (isInsurancePremiumNoticeStatement(normalized, tags, ocrText)) {
    normalized = normalizeInsurancePremiumNoticeStatement(normalized);
  }
  if (typeof rules.normalizeSuggestedTitle === "function") {
    normalized = rules.normalizeSuggestedTitle(normalized, {
      tags,
      ocrText,
      helpers: { hasTag, monthPattern: MONTH_PATTERN },
    });
  }
  return isScanSnapImportTitle(normalized) ? "" : normalized;
}

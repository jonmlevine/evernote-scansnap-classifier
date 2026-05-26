import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ClassificationAgentHarness } from "../src/models/agentHarness.js";
import { ClassificationAgent } from "../src/models/classificationAgent.js";
import { LlmSuggestionEngine, selectRelevantExamples } from "../src/models/llmSuggestionEngine.js";
import { ruleEngineContextForNote } from "../src/models/suggestionEngine.js";
import { VerificationAgent } from "../src/models/verificationAgent.js";

class FakeLlmClient {
  constructor(responses = []) {
    this.responses = [...responses];
    this.requests = [];
  }

  async completeJson(request) {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response instanceof Error) throw response;
    if (typeof response === "function") return response(request);
    return response;
  }
}

function createHarness(fakeClient) {
  return new ClassificationAgentHarness({
    classificationAgent: new ClassificationAgent({ llmClient: fakeClient }),
    verificationAgent: new VerificationAgent({ llmClient: fakeClient }),
  });
}

describe("LLM suggestion workflow", () => {
  it("uses classifier and verifier agents for fallback suggestions", async () => {
    const fakeClient = new FakeLlmClient([
      {
        title: "Alex CardCo April 29 2026 Letter",
        tags: ["finance", "card", "CardCo", "Alex"],
        notebook: "Finance",
        confidence: 0.82,
        reason: "OCR identifies CardCo correspondence.",
        evidence: ["CardCo Account Services", "April 29, 2026"],
      },
      {
        accepted: true,
        title: "Alex CardCo April 29 2026 Letter",
        tags: ["finance", "card", "CardCo", "Alex"],
        notebook: "Finance",
        confidence: 0.86,
        reason: "Verified against OCR date and issuer.",
        issues: [],
      },
    ]);
    const engine = new LlmSuggestionEngine({
      deterministicEngine: {
        async suggest() {
          return {
            title: "Undated Scanned Document",
            tags: [],
            notebook: "Scanned Items Notebook",
            confidence: 0.35,
            reason: "Fallback guess",
            source: "fallback",
          };
        },
      },
      learningStore: {
        async load() {
          return {
            examples: [
              {
                originalTitle: "20260429_scan",
                suggestedTitle: "Alex CardCo April 2026 Letter",
                suggestedTags: ["finance", "card", "CardCo", "Alex"],
                suggestedNotebook: "Finance",
              },
            ],
          };
        },
      },
      harness: createHarness(fakeClient),
    });

    const suggestion = await engine.suggest(
      { id: "note-1", title: "20260506_IIllllIlllllllIIIlf" },
      "CardCo Account Services April 29, 2026 account ending 1234",
      {
        notebooks: [{ id: "finance", name: "Finance" }],
        tags: [{ id: "cardco", name: "CardCo" }],
      }
    );

    assert.equal(suggestion.source, "llm");
    assert.equal(suggestion.title, "Alex CardCo April 29 2026 Letter");
    assert.deepEqual(suggestion.tags, ["finance", "card", "CardCo", "Alex"]);
    assert.equal(suggestion.notebook, "Finance");
    assert.equal(fakeClient.requests.length, 2);
  });

  it("does not call the LLM for confident learned suggestions", async () => {
    const fakeClient = new FakeLlmClient();
    const learned = {
      title: "Alex FundCo April 2026 Statement",
      tags: ["Finance", "Alex"],
      notebook: "Finance",
      confidence: 0.96,
      reason: "Exact match",
      source: "markdown",
    };
    const engine = new LlmSuggestionEngine({
      deterministicEngine: { async suggest() { return learned; } },
      learningStore: { async load() { return { examples: [] }; } },
      harness: createHarness(fakeClient),
    });

    assert.equal(await engine.suggest({ id: "note-1", title: "20260501_scan" }, ""), learned);
    assert.equal(fakeClient.requests.length, 0);
  });

  it("can force an LLM suggestion for a confident deterministic suggestion", async () => {
    const fakeClient = new FakeLlmClient([
      {
        title: "Alex HealthPlan Benefits Notice April 30, 2026",
        tags: ["Health", "Insurance", "HealthPlan", "Alex"],
        notebook: "Health Records",
        confidence: 0.78,
        reason: "OCR identifies a benefits notice.",
      },
      {
        accepted: true,
        title: "Alex HealthPlan Benefits Notice April 30, 2026",
        tags: ["Health", "Insurance", "HealthPlan", "Alex"],
        notebook: "Health Records",
        confidence: 0.8,
        reason: "Verified.",
        issues: [],
      },
    ]);
    const deterministic = {
      title: "InsurerCo Account Notice April 30, 2026",
      tags: ["Insurance", "Statements"],
      notebook: "Insurance",
      confidence: 0.85,
      source: "markdown",
    };
    const engine = new LlmSuggestionEngine({
      deterministicEngine: { async suggest() { return deterministic; } },
      learningStore: { async load() { return { examples: [] }; } },
      harness: createHarness(fakeClient),
    });

    const suggestion = await engine.suggestWithLlm(
      { id: "note-1", title: "20260430_scan" },
      "HealthPlan BENEFITS NOTICE Service date April 30, 2026 for ALEX"
    );

    assert.equal(suggestion.source, "llm");
    assert.equal(suggestion.title, "Alex HealthPlan Benefits Notice April 30, 2026");
    assert.equal(suggestion.confidence, 0.8);
    assert.equal(fakeClient.requests.length, 2);
  });

  it("falls back when verification rejects a ScanSnap placeholder title", async () => {
    const fakeClient = new FakeLlmClient([
      {
        title: "20260501_scan",
        tags: ["Statements"],
        notebook: "Scanned Items Notebook",
        confidence: 0.9,
        reason: "Bad title",
      },
    ]);
    const fallback = {
      title: "Scan",
      tags: [],
      notebook: "Scanned Items Notebook",
      confidence: 0.35,
      reason: "Fallback guess",
      source: "fallback",
    };
    const engine = new LlmSuggestionEngine({
      deterministicEngine: { async suggest() { return fallback; } },
      learningStore: { async load() { return { examples: [] }; } },
      harness: createHarness(fakeClient),
    });

    const suggestion = await engine.suggest({ id: "note-1", title: "20260501_scan" }, "");

    assert.equal(suggestion.source, "fallback");
    assert.match(suggestion.llmError, /verification rejected/i);
  });

  it("selects learned examples by OCR/title relevance", () => {
    const examples = [
      { suggestedTitle: "Health Benefits", suggestedTags: ["Health"] },
      { suggestedTitle: "CardCo Card Letter", suggestedTags: ["CardCo", "finance"] },
      { suggestedTitle: "FundCo Statement", suggestedTags: ["Finance"] },
    ];

    assert.deepEqual(
      selectRelevantExamples(examples, { title: "20260501_CardCo" }, "card finance", 1),
      [examples[1]]
    );
  });

  it("includes the rule engine tag and notebook choice set", () => {
    const context = ruleEngineContextForNote(
      { id: "note-1", title: "20260501_CardCo" },
      "CardCo Account Services April 29, 2026 card statement",
      {
        strongMatchTokens: ["cardco"],
        tagVocabulary: ["CardCo", "Alex"],
        notebookVocabulary: ["Finance", "Health Records"],
        llmInstructions: ["Use local filing rules."],
      }
    );

    assert.ok(context.choiceSet.candidateTags.includes("Statements"));
    assert.ok(context.choiceSet.candidateTags.includes("CardCo"));
    assert.ok(context.choiceSet.candidateTags.includes("Alex"));
    assert.ok(context.choiceSet.candidateNotebooks.includes("Scanned Items Notebook"));
    assert.ok(context.choiceSet.candidateNotebooks.includes("Finance"));
    assert.ok(context.choiceSet.candidateNotebooks.includes("Health Records"));
    assert.ok(context.choiceSet.strongMatchTokens.includes("cardco"));
    assert.deepEqual(context.instructions, ["Use local filing rules."]);
    assert.ok(context.matchTokens.includes("cardco"));
  });

  it("prompts classifier and verifier to use invoice and receipt title conventions", async () => {
    const fakeClient = new FakeLlmClient([
      {
        title: "HotelCo City Invoice March 2026",
        tags: ["Receipts", "Business", "Alex", "Tax"],
        notebook: "Business",
        confidence: 0.84,
        reason: "OCR identifies a hotel invoice.",
      },
      {
        accepted: true,
        title: "HotelCo City Invoice March 2026",
        tags: ["Receipts", "Business", "Alex", "Tax"],
        notebook: "Business",
        confidence: 0.86,
        reason: "Verified invoice title and routing.",
        issues: [],
      },
    ]);
    const classificationAgent = new ClassificationAgent({ llmClient: fakeClient });
    const verificationAgent = new VerificationAgent({ llmClient: fakeClient });
    const suggestion = await classificationAgent.classify({
      note: { id: "note-1", title: "20260519_HotelCo Invoice no" },
      ocrText: "HotelCo City Invoice no 14-03-26 Guest Alex",
      deterministicSuggestion: { title: "HotelCo Invoice No", tags: ["Receipts"], notebook: "Receipts" },
      ruleEngineContext: {
        instructions: [
          "HotelCo City invoices are business tax receipts: use the Business notebook and tags Receipts, Business, Alex, Tax.",
        ],
      },
    });

    await verificationAgent.verify({
      note: { id: "note-1", title: "20260519_HotelCo Invoice no" },
      ocrText: "HotelCo City Invoice no 14-03-26 Guest Alex",
      suggestion,
      ruleEngineContext: { instructions: ["Use local invoice routing."] },
    });

    assert.match(fakeClient.requests[0].system, /Vendor Invoice Month Year/);
    assert.match(fakeClient.requests[0].system, /business invoices/);
    assert.match(fakeClient.requests[1].system, /Vendor Invoice Month Year/);
    assert.match(fakeClient.requests[1].system, /tax-routing tags/);
  });

  it("prompts classifier and verifier to use medical approval title conventions", async () => {
    const fakeClient = new FakeLlmClient([
      {
        title: "Alex HealthPlan Short Service Name Approval May 2026",
        tags: ["Health", "HealthPlan", "Alex", "Insurance"],
        notebook: "Health Records",
        confidence: 0.86,
        reason: "OCR identifies a health approval.",
      },
      {
        accepted: true,
        title: "Alex HealthPlan Short Service Name Approval May 2026",
        tags: ["Health", "HealthPlan", "Alex", "Insurance"],
        notebook: "Health Records",
        confidence: 0.88,
        reason: "Verified approval title.",
        issues: [],
      },
    ]);
    const classificationAgent = new ClassificationAgent({ llmClient: fakeClient });
    const verificationAgent = new VerificationAgent({ llmClient: fakeClient });
    const suggestion = await classificationAgent.classify({
      note: { id: "note-1", title: "20260513_scan" },
      ocrText: "HealthPlan ReviewCo approved Long Service Name (Short Service Name) for Alex Date: 5/13/2026",
      deterministicSuggestion: { title: "HealthPlan Long Service Name Approval May 13 2026", tags: ["Health"], notebook: "Health" },
      ruleEngineContext: {
        instructions: [
          "HealthPlan approval letters should be titled '<Person> HealthPlan <Service> Approval <Month Year>' and should use tags Health, HealthPlan, <Person>, Insurance.",
        ],
        classifierInstructions: [
          "For local approval subtype A, prefer Short Service Name rather than Long Service Name.",
        ],
      },
    });

    await verificationAgent.verify({
      note: { id: "note-1", title: "20260513_scan" },
      ocrText: "HealthPlan ReviewCo approved Long Service Name (Short Service Name) for Alex Date: 5/13/2026",
      suggestion,
      ruleEngineContext: {
        instructions: ["Use local medical approval title routing."],
        verifierInstructions: [
          "For local approval subtype A, require Short Service Name rather than Long Service Name.",
        ],
      },
    });

    assert.match(fakeClient.requests[0].system, /Person Insurer Service Approval Month Year/);
    assert.match(fakeClient.requests[0].system, /start the title with the patient\/customer first name/);
    assert.match(fakeClient.requests[0].system, /prefer Short Service Name rather than Long Service Name/);
    assert.match(fakeClient.requests[1].system, /Person Insurer Service Approval Month Year/);
    assert.match(fakeClient.requests[1].system, /title to start with the patient\/customer first name/);
    assert.match(fakeClient.requests[1].system, /require Short Service Name rather than Long Service Name/);
  });

  it("prompts classifier and verifier to use benefit notice conventions", async () => {
    const fakeClient = new FakeLlmClient([
      {
        title: "Alex BenefitIssuer Explanation of Benefits May 4, 2026",
        tags: ["Health", "BenefitIssuer", "Alex", "Insurance"],
        notebook: "Health Records",
        confidence: 0.9,
        reason: "OCR identifies a benefits explanation.",
      },
      {
        accepted: true,
        title: "Alex BenefitIssuer Explanation of Benefits May 4, 2026",
        tags: ["Health", "BenefitIssuer", "Alex", "Insurance"],
        notebook: "Health Records",
        confidence: 0.92,
        reason: "Verified EOB title and service date.",
        issues: [],
      },
    ]);
    const classificationAgent = new ClassificationAgent({ llmClient: fakeClient });
    const verificationAgent = new VerificationAgent({ llmClient: fakeClient });
    const suggestion = await classificationAgent.classify({
      note: { id: "note-1", title: "20260504_scan" },
      ocrText: "BenefitIssuer Explanation of Benefits THIS IS NOT A BILL Service date May 4, 2026 for ALEX",
      deterministicSuggestion: { title: "BenefitIssuer EOB May 2026", tags: ["Health"], notebook: "Health" },
      ruleEngineContext: {
        instructions: [
          "BenefitIssuer Explanation of Benefits documents should be titled '<Person> BenefitIssuer Explanation of Benefits <Service Date>' and should use tags Health, BenefitIssuer, <Person>, Insurance.",
        ],
        classifierInstructions: [
          "For BenefitIssuer Explanation of Benefits documents, write out Explanation of Benefits, start with the patient first name, and use the service date.",
        ],
      },
    });

    await verificationAgent.verify({
      note: { id: "note-1", title: "20260504_scan" },
      ocrText: "BenefitIssuer Explanation of Benefits THIS IS NOT A BILL Service date May 4, 2026 for ALEX",
      suggestion,
      ruleEngineContext: {
        instructions: ["Use local benefits routing."],
        verifierInstructions: [
          "For BenefitIssuer Explanation of Benefits documents, require Explanation of Benefits in the title, the patient first name at the beginning, and the service date.",
        ],
      },
    });

    assert.match(fakeClient.requests[0].system, /BenefitIssuer Explanation of Benefits documents/);
    assert.match(fakeClient.requests[0].system, /patient first name/);
    assert.match(fakeClient.requests[0].system, /service date/);
    assert.match(fakeClient.requests[1].system, /BenefitIssuer Explanation of Benefits documents/);
    assert.match(fakeClient.requests[1].system, /patient first name/);
    assert.match(fakeClient.requests[1].system, /service date/);
  });

  it("prompts classifier and verifier to use processed benefit statement conventions", async () => {
    const fakeClient = new FakeLlmClient([
      {
        title: "Alex BenefitIssuer Explanation of Benefits May 2026",
        tags: ["Health", "Insurance", "Alex", "Statements", "BenefitIssuer"],
        notebook: "Health Records",
        confidence: 0.9,
        reason: "OCR identifies a processed benefit statement.",
      },
      {
        accepted: true,
        title: "Alex BenefitIssuer Explanation of Benefits May 2026",
        tags: ["Health", "Insurance", "Alex", "Statements", "BenefitIssuer"],
        notebook: "Health Records",
        confidence: 0.92,
        reason: "Verified dental benefits title and processed date.",
        issues: [],
      },
    ]);
    const classificationAgent = new ClassificationAgent({ llmClient: fakeClient });
    const verificationAgent = new VerificationAgent({ llmClient: fakeClient });
    const suggestion = await classificationAgent.classify({
      note: { id: "note-1", title: "20260522_scan" },
      ocrText: "BenefitIssuer Explanation of Benefits Name/Relationship Alex/Member Date processed May 15, 2026",
      deterministicSuggestion: { title: "BenefitIssuer Benefits", tags: ["Health"], notebook: "Health" },
      ruleEngineContext: {
        instructions: [
          "BenefitIssuer benefit explanations should be titled '<Person> BenefitIssuer Explanation of Benefits <Month Year>' and should use tags Health, Insurance, <Person>, Statements, BenefitIssuer.",
        ],
        classifierInstructions: [
          "For BenefitIssuer Explanation of Benefits documents, start with the patient first name, use Month Year from the processed document date, and route Alex documents to Health Records.",
        ],
      },
    });

    await verificationAgent.verify({
      note: { id: "note-1", title: "20260522_scan" },
      ocrText: "BenefitIssuer Explanation of Benefits Name/Relationship Alex/Member Date processed May 15, 2026",
      suggestion,
      ruleEngineContext: {
        instructions: ["Use local benefit statement routing."],
        verifierInstructions: [
          "For BenefitIssuer Explanation of Benefits documents, require the patient first name at the beginning, Month Year from the processed document date, and Health Records for Alex documents.",
        ],
      },
    });

    assert.match(fakeClient.requests[0].system, /BenefitIssuer Explanation of Benefits documents/);
    assert.match(fakeClient.requests[0].system, /processed document date/);
    assert.match(fakeClient.requests[0].system, /Health Records/);
    assert.match(fakeClient.requests[1].system, /BenefitIssuer Explanation of Benefits documents/);
    assert.match(fakeClient.requests[1].system, /processed document date/);
    assert.match(fakeClient.requests[1].system, /Health Records/);
  });

  it("prompts classifier and verifier to use mail-order refill conventions", async () => {
    const fakeClient = new FakeLlmClient([
      {
        title: "Casey MailOrderRx MedicationA Refill May 2026",
        tags: ["Medication", "Health", "Casey", "MailOrderRx"],
        notebook: "Student Records",
        confidence: 0.9,
        reason: "OCR identifies a mail-order refill.",
      },
      {
        accepted: true,
        title: "Casey MailOrderRx MedicationA Refill May 2026",
        tags: ["Medication", "Health", "Casey", "MailOrderRx"],
        notebook: "Student Records",
        confidence: 0.92,
        reason: "Verified refill title and routing.",
        issues: [],
      },
    ]);
    const classificationAgent = new ClassificationAgent({ llmClient: fakeClient });
    const verificationAgent = new VerificationAgent({ llmClient: fakeClient });
    const suggestion = await classificationAgent.classify({
      note: { id: "note-1", title: "20260524_scan" },
      ocrText:
        "MailOrderRx Pharmacy Plan member CASEY EXAMPLE Order process date 05/14/2026 MEDICATIONA CAPS 0 refills remain",
      deterministicSuggestion: { title: "HealthPlan May 2026", tags: ["Health"], notebook: "Health" },
      ruleEngineContext: {
        instructions: [
          "MailOrderRx prescription refill documents should be titled '<Person> MailOrderRx <Medication> Refill <Month Year>' and should use tags Medication, Health, <Person>, MailOrderRx.",
        ],
        classifierInstructions: [
          "For MailOrderRx prescription refill documents, use the title format Person MailOrderRx Medication Refill Month Year, use the plan member or patient name, and route Casey documents to Student Records.",
        ],
      },
    });

    await verificationAgent.verify({
      note: { id: "note-1", title: "20260524_scan" },
      ocrText:
        "MailOrderRx Pharmacy Plan member CASEY EXAMPLE Order process date 05/14/2026 MEDICATIONA CAPS 0 refills remain",
      suggestion,
      ruleEngineContext: {
        instructions: ["Use local mail-order prescription routing."],
        verifierInstructions: [
          "For MailOrderRx prescription refill documents, require Person MailOrderRx Medication Refill Month Year titles, the plan member or patient first name, and Student Records for Casey documents.",
        ],
      },
    });

    assert.match(fakeClient.requests[0].system, /MailOrderRx prescription refill documents/);
    assert.match(fakeClient.requests[0].system, /Person MailOrderRx Medication Refill Month Year/);
    assert.match(fakeClient.requests[0].system, /Student Records/);
    assert.match(fakeClient.requests[1].system, /MailOrderRx prescription refill documents/);
    assert.match(fakeClient.requests[1].system, /Person MailOrderRx Medication Refill Month Year/);
    assert.match(fakeClient.requests[1].system, /Student Records/);
  });

  it("prompts classifier and verifier to use retail pharmacy prescription conventions", async () => {
    const fakeClient = new FakeLlmClient([
      {
        title: "Alex PharmacyCo MedicationB Prescription May 2026",
        tags: ["Medication", "Health", "Alex"],
        notebook: "Health Records",
        confidence: 0.9,
        reason: "OCR identifies a retail prescription.",
      },
      {
        accepted: true,
        title: "Alex PharmacyCo MedicationB Prescription May 2026",
        tags: ["Medication", "Health", "Alex"],
        notebook: "Health Records",
        confidence: 0.92,
        reason: "Verified prescription label date and routing.",
        issues: [],
      },
    ]);
    const classificationAgent = new ClassificationAgent({ llmClient: fakeClient });
    const verificationAgent = new VerificationAgent({ llmClient: fakeClient });
    const suggestion = await classificationAgent.classify({
      note: { id: "note-1", title: "20260522_scan" },
      ocrText:
        "PharmacyCo Retail Pharmacy PATIENT ALEX EXAMPLE BIRTH DATE 01/01/70 MEDICATION MEDICATIONB RX #0642631 DATE:05/20/26",
      deterministicSuggestion: { title: "Prescription January 2070", tags: ["Health"], notebook: "Health" },
      ruleEngineContext: {
        instructions: [
          "Retail pharmacy prescription documents from PharmacyCo should be titled '<Person> <Pharmacy> <Medication> Prescription <Month Year>' and should use tags Medication, Health, <Person>.",
        ],
        classifierInstructions: [
          "For retail pharmacy prescription documents from PharmacyCo, use the title format Person Pharmacy Medication Prescription Month Year, use the medication name from the MEDICATION or Rx label, use the prescription label date instead of the birth date, and route Alex documents to Health Records.",
        ],
      },
    });

    await verificationAgent.verify({
      note: { id: "note-1", title: "20260522_scan" },
      ocrText:
        "PharmacyCo Retail Pharmacy PATIENT ALEX EXAMPLE BIRTH DATE 01/01/70 MEDICATION MEDICATIONB RX #0642631 DATE:05/20/26",
      suggestion,
      ruleEngineContext: {
        instructions: ["Use local retail pharmacy prescription routing."],
        verifierInstructions: [
          "For retail pharmacy prescription documents from PharmacyCo, require Person Pharmacy Medication Prescription Month Year titles, the medication name from the MEDICATION or Rx label, the prescription label date rather than the birth date, and Health Records for Alex documents.",
        ],
      },
    });

    assert.match(fakeClient.requests[0].system, /retail pharmacy prescription documents/);
    assert.match(fakeClient.requests[0].system, /Person Pharmacy Medication Prescription Month Year/);
    assert.match(fakeClient.requests[0].system, /medication name from the MEDICATION or Rx label/);
    assert.match(fakeClient.requests[0].system, /prescription label date instead of the birth date/);
    assert.match(fakeClient.requests[1].system, /retail pharmacy prescription documents/);
    assert.match(fakeClient.requests[1].system, /Person Pharmacy Medication Prescription Month Year/);
    assert.match(fakeClient.requests[1].system, /medication name from the MEDICATION or Rx label/);
    assert.match(fakeClient.requests[1].system, /prescription label date rather than the birth date/);
  });
});

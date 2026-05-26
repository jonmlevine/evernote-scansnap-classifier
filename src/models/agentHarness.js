export class ClassificationAgentHarness {
  constructor({ classificationAgent, verificationAgent, minConfidence = 0.5 } = {}) {
    this.classificationAgent = classificationAgent;
    this.verificationAgent = verificationAgent;
    this.minConfidence = minConfidence;
  }

  async suggest(context) {
    const classification = await this.classificationAgent.classify(context);
    if (classification.confidence < this.minConfidence) {
      throw new Error(`LLM classification confidence was too low: ${classification.confidence}`);
    }

    const verified = this.verificationAgent
      ? await this.verificationAgent.verify({ ...context, suggestion: classification })
      : { ...classification, accepted: true, issues: [] };

    if (!verified.accepted) {
      throw new Error(`LLM verification rejected classification: ${(verified.issues || []).join("; ")}`);
    }

    return {
      title: verified.title,
      tags: verified.tags,
      notebook: verified.notebook,
      confidence: verified.confidence,
      reason: verified.reason || classification.reason,
      evidence: verified.evidence || classification.evidence || [],
      source: "llm",
    };
  }
}

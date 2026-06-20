import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getConfig } from "../src/config.js";

describe("config", () => {
  it("defaults the candidate list timeout and allows overriding it", () => {
    const defaults = getConfig({});
    assert.equal(defaults.listNotesTimeoutMs, 30000);

    const overridden = getConfig({ SCANSNAP_LIST_NOTES_TIMEOUT_MS: "45000" });
    assert.equal(overridden.listNotesTimeoutMs, 45000);
  });
});

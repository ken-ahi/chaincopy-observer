import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  parseAndValidateStage3AManifest,
  verifyCurrentRows,
} from "./issue26-stage3b-preflight-policy.js";

const manifestPath = new URL("../docs/issue26-stage3a-repair-manifest.json", import.meta.url);

describe("Issue 26 Stage 3B preflight policy", () => {
  it("validates the immutable Stage 3A artifact and exact counts", async () => {
    const manifest = parseAndValidateStage3AManifest(await readFile(manifestPath, "utf8"));
    expect(manifest.deleteRows).toHaveLength(161);
    expect(manifest.keepRows).toHaveLength(42);
    expect(manifest.jobs).toHaveLength(22);
  });

  it("accepts only complete exact identity matches", async () => {
    const manifest = parseAndValidateStage3AManifest(await readFile(manifestPath, "utf8"));
    const result = verifyCurrentRows({
      manifest,
      portfolioRows: manifest.deleteRows,
      rawRows: manifest.keepRows,
      syncJobs: manifest.jobs,
    });
    expect(result).toMatchObject({
      deleteExactMatches: 161,
      duplicateOrAmbiguousMatches: 0,
      identityMismatches: [],
      keepExactMatches: 42,
      keepRowsSelectedForMutation: 0,
      missingDeleteRows: [],
      outsideManifestRowsSelectedForMutation: 0,
      ready: true,
    });
  });

  it("fails closed on a missing row, changed identity, or ambiguous match", async () => {
    const manifest = parseAndValidateStage3AManifest(await readFile(manifestPath, "utf8"));
    const first = manifest.deleteRows[0]!;
    const result = verifyCurrentRows({
      manifest,
      portfolioRows: [
        ...manifest.deleteRows.slice(1),
        { ...first, fingerprint: "changed" },
        { ...first, fingerprint: "changed-again" },
      ],
      rawRows: manifest.keepRows.slice(1),
      syncJobs: manifest.jobs.slice(1),
    });
    expect(result.ready).toBe(false);
    expect(result.duplicateOrAmbiguousMatches).toBe(1);
    expect(result.missingKeepRows).toHaveLength(1);
    expect(result.missingOrMismatchedJobs).toHaveLength(1);
  });

  it("rejects an altered evidence artifact before parsing it", async () => {
    const text = await readFile(manifestPath, "utf8");
    expect(() => parseAndValidateStage3AManifest(`${text} `)).toThrow(/artifact SHA-256/);
  });
});

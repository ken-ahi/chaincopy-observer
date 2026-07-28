import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  applyCandidateExclusionState,
  exclusionAction,
  isManuallyExcluded,
} from "./discovery-candidate-actions";

describe("discovery candidate exclusion actions", () => {
  it("shows the exclude action for an ordinary candidate", () => {
    expect(exclusionAction({ exclusionReasons: ["INSUFFICIENT_HISTORY"] })).toEqual({
      label: "除外",
      method: "POST",
      successMessage: "候補を除外しました。",
    });
  });

  it("shows an enabled-compatible unexclude action for a manually excluded candidate", () => {
    const candidate = {
      exclusionReasons: ["INSUFFICIENT_HISTORY", "MANUALLY_EXCLUDED"],
    };

    expect(isManuallyExcluded(candidate)).toBe(true);
    expect(exclusionAction(candidate)).toEqual({
      label: "除外解除",
      method: "DELETE",
      successMessage: "候補の除外を解除し、再評価を登録しました。",
    });
  });

  it("uses the shared action in both list and detail while preserving other operations", () => {
    const list = readFileSync(new URL("./discovery-client.tsx", import.meta.url), "utf8");
    const detail = readFileSync(new URL("./discovery-detail-client.tsx", import.meta.url), "utf8");

    for (const source of [list, detail]) {
      expect(source).toContain("exclusionAction(candidate)");
      expect(source).toContain("除外解除後、候補の適格性を再評価します");
    }
    expect(list).toContain('action === "exclude"');
    expect(detail).toContain('kind === "exclude"');
    expect(list).toContain('"enrich" | "exclude" | "promote"');
    expect(detail).toContain('"enrich" | "exclude" | "promote"');
    expect(list).toContain("candidateActionInFlight.current");
    expect(detail).toContain("actionInFlight.current");
  });

  it("uses a generic safe fallback instead of rendering arbitrary thrown messages", () => {
    const list = readFileSync(new URL("./discovery-client.tsx", import.meta.url), "utf8");
    const detail = readFileSync(new URL("./discovery-detail-client.tsx", import.meta.url), "utf8");

    expect(list).not.toContain("cause instanceof Error ? cause.message");
    expect(detail).not.toContain("cause instanceof Error ? cause.message");
    expect(list).toContain('return "処理に失敗しました。"');
    expect(detail).toContain('return "処理に失敗しました。"');
  });

  it("switches to unexclude immediately from the successful POST candidate", () => {
    const updated = applyCandidateExclusionState(
      candidateState([]),
      candidateState(["AUTOMATIC_REASON", "MANUALLY_EXCLUDED"], "EXCLUDED"),
    );

    expect(updated.exclusionReasons).toEqual(["AUTOMATIC_REASON", "MANUALLY_EXCLUDED"]);
    expect(updated.filterStatus).toBe("EXCLUDED");
    expect(exclusionAction(updated).method).toBe("DELETE");
    expect(exclusionAction(updated).label).toBe("除外解除");
  });

  it("switches back to exclude immediately from the successful DELETE candidate", () => {
    const updated = applyCandidateExclusionState(
      candidateState(["AUTOMATIC_REASON", "MANUALLY_EXCLUDED"], "EXCLUDED"),
      candidateState(["AUTOMATIC_REASON"], "PENDING"),
    );

    expect(updated.exclusionReasons).toEqual(["AUTOMATIC_REASON"]);
    expect(updated.filterStatus).toBe("PENDING");
    expect(exclusionAction(updated).method).toBe("POST");
    expect(exclusionAction(updated).label).toBe("除外");
  });

  it("updates local state before reloading in both list and detail", () => {
    const list = readFileSync(new URL("./discovery-client.tsx", import.meta.url), "utf8");
    const detail = readFileSync(new URL("./discovery-detail-client.tsx", import.meta.url), "utf8");

    expect(list.indexOf("setCandidates((current)")).toBeLessThan(
      list.indexOf("await load();", list.indexOf("setCandidates((current)")),
    );
    expect(detail.indexOf("setCandidate((current)")).toBeLessThan(
      detail.indexOf("await load();", detail.indexOf("setCandidate((current)")),
    );
  });
});

function candidateState(
  exclusionReasons: ReadonlyArray<string>,
  filterStatus: "EXCLUDED" | "LIGHT_ELIGIBLE" | "PENDING" = "LIGHT_ELIGIBLE",
) {
  return {
    address: "0x1111111111111111111111111111111111111111",
    exclusionReasons,
    filterStatus,
  };
}

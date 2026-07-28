import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ApiRequestError } from "../lib/address-api";
import {
  type CandidateFilterStatus,
  type EnrichmentStatus,
} from "../lib/discovery-api";
import {
  applyCandidateActionState,
  candidateActionErrorMessage,
  type CandidateActionKind,
  type CandidateActionRequest,
  type CandidateExclusionResponse,
  exclusionAction,
  isCandidateExclusionDisabled,
  isCandidatePromotionDisabled,
  isManuallyExcluded,
  requestCandidateAction,
} from "./discovery-candidate-actions";

describe("discovery candidate actions", () => {
  it("shows the exclude action for an ordinary candidate", () => {
    expect(exclusionAction({ exclusionReasons: ["INSUFFICIENT_HISTORY"] })).toEqual({
      label: "除外",
      method: "POST",
      successMessage: "候補を除外しました。",
    });
  });

  it("shows the unexclude action for a manually excluded candidate", () => {
    const candidate = {
      exclusionReasons: ["INSUFFICIENT_HISTORY", "MANUALLY_EXCLUDED"],
    };

    expect(isManuallyExcluded(candidate)).toBe(true);
    expect(exclusionAction(candidate)).toEqual({
      label: "除外解除",
      method: "DELETE",
      successMessage: "候補の除外を解除しました。",
    });
  });

  it("switches to unexclude immediately after a successful exclusion", () => {
    const result = exclusionResult(
      candidateState(["AUTOMATIC_REASON", "MANUALLY_EXCLUDED"], "EXCLUDED"),
    );
    const updated = applyCandidateActionState(candidateState([]), result);

    expect(updated.exclusionReasons).toEqual(["AUTOMATIC_REASON", "MANUALLY_EXCLUDED"]);
    expect(updated.filterStatus).toBe("EXCLUDED");
    expect(exclusionAction(updated)).toMatchObject({ label: "除外解除", method: "DELETE" });
  });

  it("uses DELETE for the next action after exclusion", async () => {
    const { calls, request } = createSequenceRequest([
      exclusionResponse(
        candidateState(["AUTOMATIC_REASON", "MANUALLY_EXCLUDED"], "EXCLUDED"),
        "EXCLUDED",
      ),
      exclusionResponse(candidateState(["AUTOMATIC_REASON"], "PENDING"), "QUEUED"),
    ]);
    let candidate = candidateState([]);

    candidate = applyCandidateActionState(
      candidate,
      await requestCandidateAction(candidate, "exclude", request),
    );
    candidate = applyCandidateActionState(
      candidate,
      await requestCandidateAction(candidate, "exclude", request),
    );

    expect(calls.map((call) => call.method)).toEqual(["POST", "DELETE"]);
    expect(exclusionAction(candidate)).toMatchObject({ label: "除外", method: "POST" });
  });

  it("switches back to exclude immediately after a successful unexclude", () => {
    const result = exclusionResult(candidateState(["AUTOMATIC_REASON"], "PENDING"));
    const updated = applyCandidateActionState(
      candidateState(["AUTOMATIC_REASON", "MANUALLY_EXCLUDED"], "EXCLUDED"),
      result,
    );

    expect(updated.exclusionReasons).toEqual(["AUTOMATIC_REASON"]);
    expect(updated.filterStatus).toBe("PENDING");
    expect(exclusionAction(updated)).toMatchObject({ label: "除外", method: "POST" });
  });

  it("keeps exclusion enabled for a QUEUED candidate", () => {
    expect(
      isCandidateExclusionDisabled(
        candidateState([], "LIGHT_ELIGIBLE", "QUEUED"),
        false,
      ),
    ).toBe(false);
  });

  it("keeps exclusion enabled for a RUNNING candidate", () => {
    expect(
      isCandidateExclusionDisabled(
        candidateState([], "LIGHT_ELIGIBLE", "RUNNING"),
        false,
      ),
    ).toBe(false);
  });

  it.each<{
    readonly candidate: ReturnType<typeof candidateState>;
    readonly expectedMethod: "DELETE" | "POST";
    readonly kind: CandidateActionKind;
    readonly response: unknown;
    readonly title: string;
  }>([
    {
      candidate: candidateState([]),
      expectedMethod: "POST",
      kind: "exclude",
      response: exclusionResponse(
        candidateState(["MANUALLY_EXCLUDED"], "EXCLUDED"),
        "EXCLUDED",
      ),
      title: "exclusion",
    },
    {
      candidate: candidateState(["MANUALLY_EXCLUDED"], "EXCLUDED"),
      expectedMethod: "DELETE",
      kind: "exclude",
      response: exclusionResponse(candidateState([], "PENDING"), "QUEUED"),
      title: "unexclude",
    },
    {
      candidate: candidateState([]),
      expectedMethod: "POST",
      kind: "enrich",
      response: { jobId: "enrich-1", status: "QUEUED" },
      title: "enrichment",
    },
    {
      candidate: candidateState([], "ELIGIBLE"),
      expectedMethod: "POST",
      kind: "promote",
      response: { jobId: "promote-1", status: "QUEUED" },
      title: "promotion",
    },
  ])("does not fetch the candidate list after $title", async ({
    candidate,
    expectedMethod,
    kind,
    response,
  }) => {
    const { calls, request } = createSequenceRequest([response]);

    await requestCandidateAction(candidate, kind, request);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).not.toContain("/api/discovery/candidates?");
    expect(calls[0]?.method).toBe(expectedMethod);
  });

  it("sets only the enriched candidate to QUEUED", async () => {
    const target = candidateState([], "LIGHT_ELIGIBLE", "SUCCEEDED");
    const other = candidateState(
      [],
      "LIGHT_ELIGIBLE",
      "SUCCEEDED",
      "0x2222222222222222222222222222222222222222",
    );
    const { request } = createSequenceRequest([{ jobId: "enrich-1", status: "QUEUED" }]);
    const result = await requestCandidateAction(target, "enrich", request);
    const updated = [target, other].map((candidate) =>
      applyCandidateActionState(candidate, result),
    );

    expect(updated[0]?.enrichmentStatus).toBe("QUEUED");
    expect(updated[1]).toBe(other);
  });

  it("marks promotion as pending without faking PROMOTED", async () => {
    const candidate = candidateState([], "ELIGIBLE", "SUCCEEDED");
    const { request } = createSequenceRequest([{ jobId: "promote-1", status: "QUEUED" }]);
    const result = await requestCandidateAction(candidate, "promote", request);
    const updated = applyCandidateActionState(candidate, result);

    expect(updated).toBe(candidate);
    expect(updated.filterStatus).toBe("ELIGIBLE");
    expect(isCandidatePromotionDisabled(updated, false, true)).toBe(true);
  });

  it("does not change local state when an action fails", async () => {
    const candidate = candidateState([]);
    const before = structuredClone(candidate);
    const { request } = createSequenceRequest([new Error("request failed")]);

    await expect(requestCandidateAction(candidate, "exclude", request)).rejects.toThrow(
      "request failed",
    );
    expect(candidate).toEqual(before);
  });

  it("uses safe Japanese action errors", () => {
    expect(
      candidateActionErrorMessage(
        new ApiRequestError("conflict", "private upstream detail", 409),
      ),
    ).toBe(
      "候補はすでに監視対象へ追加されているため操作できません。再読み込みしてください。",
    );
    expect(candidateActionErrorMessage(new Error("private detail"))).toBe(
      "候補の操作に失敗しました。必要に応じて再読み込みしてください。",
    );
  });

  it("uses the shared row update behavior in list and detail", () => {
    const sources = clientSources();

    for (const source of sources) {
      expect(source).toContain("requestCandidateAction(candidate,");
      expect(source).toContain("applyCandidateActionState");
      expect(source).toContain("isCandidateExclusionDisabled");
      expect(source).toContain("isCandidatePromotionDisabled");
      expect(source).toContain('"追加待ち"');
    }
  });

  it("does not call load from candidate action handlers", () => {
    const [list, detail] = clientSources();
    const listAction = sourceSection(
      list ?? "",
      "async function candidateAction",
      "async function runAction",
    );
    const detailAction = sourceSection(
      detail ?? "",
      "async function action",
      "if (loading && !candidate)",
    );

    expect(listAction).not.toContain("load(");
    expect(detailAction).not.toContain("load(");
  });

  it("keeps full GET behind manual reload in both screens", () => {
    for (const source of clientSources()) {
      expect(source).toContain("onClick={() => void load()}");
      expect(source).toContain("void load();");
    }
  });
});

function candidateState(
  exclusionReasons: ReadonlyArray<string>,
  filterStatus: CandidateFilterStatus = "LIGHT_ELIGIBLE",
  enrichmentStatus: EnrichmentStatus = "SUCCEEDED",
  address = "0x1111111111111111111111111111111111111111",
) {
  return {
    address,
    enrichmentStatus,
    exclusionReasons,
    filterStatus,
  };
}

function exclusionResponse(
  candidate: ReturnType<typeof candidateState>,
  status: CandidateExclusionResponse["status"],
): CandidateExclusionResponse {
  return {
    candidate: {
      address: candidate.address,
      exclusionReasons: candidate.exclusionReasons,
      filterStatus: candidate.filterStatus,
    },
    status,
  };
}

function exclusionResult(
  candidate: ReturnType<typeof candidateState>,
): Awaited<ReturnType<typeof requestCandidateAction>> {
  return {
    address: candidate.address,
    candidate: {
      address: candidate.address,
      exclusionReasons: candidate.exclusionReasons,
      filterStatus: candidate.filterStatus,
    },
    kind: "exclude",
    message: isManuallyExcluded(candidate)
      ? "候補を除外しました。"
      : "候補の除外を解除しました。",
  };
}

function createSequenceRequest(responses: ReadonlyArray<unknown>): Readonly<{
  calls: Array<{ readonly input: string; readonly method: string | undefined }>;
  request: CandidateActionRequest;
}> {
  const calls: Array<{ readonly input: string; readonly method: string | undefined }> = [];
  let responseIndex = 0;
  const request: CandidateActionRequest = async <Response>(
    input: string,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ input, method: init?.method });
    const response = responses[responseIndex];
    responseIndex += 1;
    if (response instanceof Error) {
      throw response;
    }
    return response as Response;
  };
  return { calls, request };
}

function clientSources(): readonly [string, string] {
  return [
    readFileSync(new URL("./discovery-client.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("./discovery-detail-client.tsx", import.meta.url), "utf8"),
  ];
}

function sourceSection(source: string, start: string, end: string): string {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}

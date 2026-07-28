import { ApiRequestError, apiRequest } from "../lib/address-api";
import {
  type DiscoveryCandidate,
  type EnrichmentStatus,
} from "../lib/discovery-api";

export const manuallyExcludedReason = "MANUALLY_EXCLUDED";

export interface CandidateExclusionResponse {
  readonly candidate: Pick<DiscoveryCandidate, "address" | "exclusionReasons" | "filterStatus">;
  readonly jobId?: string;
  readonly status: "EXCLUDED" | "QUEUED";
}

export type CandidateActionKind = "enrich" | "exclude" | "promote";

export type CandidateActionResult =
  | Readonly<{
      address: string;
      candidate: CandidateExclusionResponse["candidate"];
      kind: "exclude";
      message: string;
    }>
  | Readonly<{
      address: string;
      kind: "enrich";
      message: "詳細分析を登録しました。";
    }>
  | Readonly<{
      address: string;
      kind: "promote";
      message: "監視対象への追加を登録しました。";
    }>;

export type CandidateActionRequest = <Response>(
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const exclusionEnabledStatuses: ReadonlySet<EnrichmentStatus> = new Set([
  "PENDING",
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "RATE_LIMITED",
]);

export function isManuallyExcluded(
  candidate: Pick<DiscoveryCandidate, "exclusionReasons">,
): boolean {
  return candidate.exclusionReasons.includes(manuallyExcludedReason);
}

export function exclusionAction(candidate: Pick<DiscoveryCandidate, "exclusionReasons">): Readonly<{
  label: "除外" | "除外解除";
  method: "DELETE" | "POST";
  successMessage: string;
}> {
  if (isManuallyExcluded(candidate)) {
    return {
      label: "除外解除",
      method: "DELETE",
      successMessage: "候補の除外を解除しました。",
    };
  }
  return {
    label: "除外",
    method: "POST",
    successMessage: "候補を除外しました。",
  };
}

export function isCandidateExclusionDisabled(
  candidate: Pick<DiscoveryCandidate, "enrichmentStatus">,
  actionInFlight: boolean,
): boolean {
  return actionInFlight || !exclusionEnabledStatuses.has(candidate.enrichmentStatus);
}

export function isCandidatePromotionDisabled(
  candidate: Pick<DiscoveryCandidate, "filterStatus">,
  actionInFlight: boolean,
  promotionPending: boolean,
): boolean {
  return actionInFlight || promotionPending || candidate.filterStatus !== "ELIGIBLE";
}

export async function requestCandidateAction(
  candidate: Pick<DiscoveryCandidate, "address" | "exclusionReasons">,
  kind: CandidateActionKind,
  request: CandidateActionRequest = apiRequest,
): Promise<CandidateActionResult> {
  if (kind === "exclude") {
    const action = exclusionAction(candidate);
    const response = await request<CandidateExclusionResponse>(
      `/api/discovery/candidates/${candidate.address}/exclude`,
      { method: action.method },
    );
    return {
      address: candidate.address,
      candidate: response.candidate,
      kind,
      message: action.successMessage,
    };
  }

  await request<{ readonly jobId?: string }>(
    `/api/discovery/candidates/${candidate.address}/${kind}`,
    { method: "POST" },
  );
  if (kind === "enrich") {
    return {
      address: candidate.address,
      kind,
      message: "詳細分析を登録しました。",
    };
  }
  return {
    address: candidate.address,
    kind,
    message: "監視対象への追加を登録しました。",
  };
}

export function applyCandidateActionState<
  Candidate extends Pick<
    DiscoveryCandidate,
    "address" | "enrichmentStatus" | "exclusionReasons" | "filterStatus"
  >,
>(current: Candidate, result: CandidateActionResult): Candidate {
  if (current.address !== result.address) {
    return current;
  }
  if (result.kind === "enrich") {
    return {
      ...current,
      enrichmentStatus: "QUEUED",
    };
  }
  if (result.kind === "promote" || current.address !== result.candidate.address) {
    return current;
  }
  return {
    ...current,
    exclusionReasons: [...result.candidate.exclusionReasons],
    filterStatus: result.candidate.filterStatus,
  };
}

export function candidateActionErrorMessage(cause: unknown): string {
  if (cause instanceof ApiRequestError && cause.status === 409) {
    return "候補はすでに監視対象へ追加されているため操作できません。再読み込みしてください。";
  }
  return "候補の操作に失敗しました。必要に応じて再読み込みしてください。";
}

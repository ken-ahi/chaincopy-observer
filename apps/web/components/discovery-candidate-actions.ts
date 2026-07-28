import { type DiscoveryCandidate } from "../lib/discovery-api";

export const manuallyExcludedReason = "MANUALLY_EXCLUDED";

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
      successMessage: "候補の除外を解除し、再評価を登録しました。",
    };
  }
  return {
    label: "除外",
    method: "POST",
    successMessage: "候補を除外しました。",
  };
}

export type ClaimsHistoryPresentation =
  | "HISTORY_DETECTED_DETAILS_NOT_REQUESTED"
  | "NO_HISTORY"
  | "CLAIM_DETAILS_AVAILABLE"
  | "UNAVAILABLE";

export function getClaimsHistoryPresentation({
  claimCount,
  claimCheckStatus,
  claimDetailsStatus,
}: {
  claimCount: number;
  claimCheckStatus?: string;
  claimDetailsStatus?: string;
}): ClaimsHistoryPresentation {
  if (claimCount > 0) {
    return "CLAIM_DETAILS_AVAILABLE";
  }

  if (claimCheckStatus === "SUCCEEDED" && !claimDetailsStatus) {
    return "HISTORY_DETECTED_DETAILS_NOT_REQUESTED";
  }

  if (claimCheckStatus === "NO_DATA") {
    return "NO_HISTORY";
  }

  return "UNAVAILABLE";
}

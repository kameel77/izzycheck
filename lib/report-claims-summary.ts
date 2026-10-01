export type ClaimsHistoryPresentation =
  | "HISTORY_DETECTED_DETAILS_NOT_REQUESTED"
  | "HISTORY_DETECTED_DETAILS_UNAVAILABLE"
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

  if (claimCheckStatus === "SUCCEEDED" && (!claimDetailsStatus || claimDetailsStatus === "NOT_REQUESTED")) {
    return "HISTORY_DETECTED_DETAILS_NOT_REQUESTED";
  }

  if (claimCheckStatus === "SUCCEEDED") {
    return "HISTORY_DETECTED_DETAILS_UNAVAILABLE";
  }

  if (claimCheckStatus === "NO_DATA") {
    return "NO_HISTORY";
  }

  return "UNAVAILABLE";
}

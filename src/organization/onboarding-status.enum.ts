/**
 * Where a self-registered business stands in the registration workflow.
 *
 * A business that signs itself up is not automatically allowed to trade. Its
 * registration is screened by a regulator (matching Rwanda's Digital Tax Stamp
 * flow: submit application -> government review -> credentials / licence).
 * Until a regulator approves it, the organization is PENDING and cannot hold
 * an operating licence.
 */
export enum OnboardingStatus {
  /** Submitted at onboarding, awaiting regulator screening. */
  PENDING = 'PENDING',
  /** Approved by a regulator; an operating licence was issued. */
  APPROVED = 'APPROVED',
  /** Rejected by a regulator; the applicant was told why. */
  REJECTED = 'REJECTED',
  /**
   * The regulator needs corrections before they can approve. The applicant
   * stays on the platform, sees the review note, uploads missing documents,
   * and resubmits — the application re-enters the PENDING queue.
   *
   * This is the typical outcome of an initial review: not rejection, just
   * "please supply your FDA premise certificate and resubmit."
   */
  CHANGES_REQUESTED = 'CHANGES_REQUESTED',
  /**
   * The primary reviewing authority has sent one or more consultation
   * requests to other regulatory authorities (e.g. RSB asking Rwanda FDA
   * for input on a food manufacturer's application). The application is
   * still open and the applicant can see this status with a message that
   * their application is being reviewed by multiple authorities.
   *
   * Returns to PENDING once all open consultations are resolved and the
   * primary regulator has acted, or directly to APPROVED/REJECTED if the
   * primary regulator overrides while consultations are outstanding.
   */
  UNDER_CONSULTATION = 'UNDER_CONSULTATION',
}

/**
 * Industry sectors an applicant can declare. Drives which regulator authority
 * the application is routed to for review.
 */
export enum IndustrySector {
  FOOD_AND_BEVERAGE = 'FOOD_AND_BEVERAGE',
  PHARMACEUTICALS = 'PHARMACEUTICALS',
  COSMETICS = 'COSMETICS',
  MINING_AND_MINERALS = 'MINING_AND_MINERALS',
  AGRICULTURE_AND_EXPORTS = 'AGRICULTURE_AND_EXPORTS',
  GENERAL_MANUFACTURING = 'GENERAL_MANUFACTURING',
  DISTRIBUTION = 'DISTRIBUTION',
  RETAIL = 'RETAIL',
  OTHER = 'OTHER',
}

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
}

/**
 * Payroll & HR vocabulary (technical proposal section 8): departments, job
 * positions, employees, attendance, leave, and the monthly payroll run that
 * turns basic salary plus allowances, overtime and deductions into a net pay.
 *
 * The guards and the computePay table are the payroll rules in one place, so
 * services state what they allow and the tests pin the arithmetic down.
 */

export enum EmployeeStatus {
  ACTIVE = 'ACTIVE',
  ON_LEAVE = 'ON_LEAVE',
  TERMINATED = 'TERMINATED',
}

export enum PayItemType {
  ALLOWANCE = 'ALLOWANCE',
  DEDUCTION = 'DEDUCTION',
}

export enum AttendanceStatus {
  PRESENT = 'PRESENT',
  ABSENT = 'ABSENT',
  LEAVE = 'LEAVE',
  HALF_DAY = 'HALF_DAY',
}

export enum LeaveType {
  ANNUAL = 'ANNUAL',
  SICK = 'SICK',
  UNPAID = 'UNPAID',
  OTHER = 'OTHER',
}

export enum LeaveStatus {
  REQUESTED = 'REQUESTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum PayrollStatus {
  DRAFT = 'DRAFT',
  PAID = 'PAID',
}

export function canApproveLeave(status: LeaveStatus): boolean {
  return status === LeaveStatus.REQUESTED;
}

export function canRejectLeave(status: LeaveStatus): boolean {
  return status === LeaveStatus.REQUESTED;
}

/** A draft payroll run can be paid once; a paid run is frozen. */
export function canPayPayroll(status: PayrollStatus): boolean {
  return status === PayrollStatus.DRAFT;
}

export interface PayInput {
  baseSalary: number;
  allowances: number;
  deductions: number;
  overtimeHours: number;
  overtimeRate: number;
}

export interface PayResult {
  baseSalary: number;
  allowances: number;
  deductions: number;
  overtimeHours: number;
  overtimeAmount: number;
  gross: number;
  net: number;
}

/**
 * The monthly run: gross is basic salary plus allowances plus overtime, net
 * is gross minus deductions. Every figure is rounded to two decimals so the
 * payslip and the report agree to the cent.
 */
export function computePay(input: PayInput): PayResult {
  const overtimeAmount = roundProduct(input.overtimeHours, input.overtimeRate);
  const baseSalary = round2(input.baseSalary);
  const allowances = round2(input.allowances);
  const deductions = round2(input.deductions);
  const gross = round2(baseSalary + allowances + overtimeAmount);
  const net = round2(gross - deductions);
  return {
    baseSalary,
    allowances,
    deductions,
    overtimeHours: round2(input.overtimeHours),
    overtimeAmount,
    gross,
    net,
  };
}

/**
 * Multiplies two money figures (at most two decimals each) in scaled integer
 * arithmetic. A float product like 2.5 x 33.33 lands on 83.32499... and would
 * round down; the scaled integers are exact, so 8332.5 rounds half-up to
 * 8333 cents.
 */
function roundProduct(a: number, b: number): number {
  const aCents = Math.round(a * 100);
  const bCents = Math.round(b * 100);
  return Math.round((aCents * bCents) / 100) / 100;
}

/** Rounds money to two decimals without ever passing through a float. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
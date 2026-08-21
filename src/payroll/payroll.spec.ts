import {
  LeaveStatus,
  canApproveLeave,
  canPayPayroll,
  canRejectLeave,
  computePay,
  PayrollStatus,
} from './payroll.enums';

describe('leave transitions (proposal section 8)', () => {
  it('approves and rejects only what was requested', () => {
    expect(canApproveLeave(LeaveStatus.REQUESTED)).toBe(true);
    expect(canApproveLeave(LeaveStatus.APPROVED)).toBe(false);
    expect(canRejectLeave(LeaveStatus.REQUESTED)).toBe(true);
    expect(canRejectLeave(LeaveStatus.REJECTED)).toBe(false);
  });
});

describe('payroll run transitions', () => {
  it('pays only a draft run', () => {
    expect(canPayPayroll(PayrollStatus.DRAFT)).toBe(true);
    expect(canPayPayroll(PayrollStatus.PAID)).toBe(false);
  });
});

describe('pay computation (proposal section 8 payroll processing)', () => {
  it('computes gross as basic plus allowances plus overtime', () => {
    const pay = computePay({
      baseSalary: 1000,
      allowances: 200,
      deductions: 150,
      overtimeHours: 10,
      overtimeRate: 50,
    });
    expect(pay.gross).toBe(1700);
    expect(pay.overtimeAmount).toBe(500);
    expect(pay.net).toBe(1550);
  });

  it('nets zero deductions and overtime to the basic salary', () => {
    const pay = computePay({
      baseSalary: 1000,
      allowances: 0,
      deductions: 0,
      overtimeHours: 0,
      overtimeRate: 50,
    });
    expect(pay.gross).toBe(1000);
    expect(pay.net).toBe(1000);
  });

  it('rounds every figure to two decimals', () => {
    const pay = computePay({
      baseSalary: 1000.555,
      allowances: 10.004,
      deductions: 5.005,
      overtimeHours: 2.5,
      overtimeRate: 33.33,
    });
    expect(pay.baseSalary).toBe(1000.56);
    expect(pay.allowances).toBe(10);
    expect(pay.deductions).toBe(5.01);
    expect(pay.overtimeAmount).toBe(83.33);
    expect(pay.gross).toBe(1093.89);
    expect(pay.net).toBe(1088.88);
  });
});
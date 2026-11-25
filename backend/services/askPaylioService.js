import prisma from '../config/db.js';
import logger from '../config/logger.js';

const FINANCE_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT']);
const ALL_ADMIN_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'HR']);
const money = (value) => (value && typeof value.toFixed === 'function' ? value.toFixed(2) : Number(value || 0).toFixed(2));

const tools = {
  HEADCOUNT: {
    roles: ALL_ADMIN_ROLES,
    run: async (companyId) => {
      const [active, inactive] = await Promise.all([
        prisma.employee.count({ where: { companyId, isActive: true, deletedAt: null } }),
        prisma.employee.count({ where: { companyId, isActive: false, deletedAt: null } }),
      ]);
      return { activeEmployees: active, inactiveEmployees: inactive, totalEmployees: active + inactive };
    },
    fallback: (data) => `There are ${data.activeEmployees} active employees and ${data.inactiveEmployees} inactive employees (${data.totalEmployees} in total).`,
  },
  PAYROLL_SUMMARY: {
    roles: FINANCE_ROLES,
    run: async (companyId) => {
      const run = await prisma.payrollRun.findFirst({
        where: { companyId, status: 'FINALIZED', deletedAt: null },
        orderBy: [{ month: 'desc' }, { processedAt: 'desc' }],
        select: { id: true, month: true, processedAt: true },
      });
      if (!run) return { available: false, message: 'No finalized payroll run is available.' };
      const totals = await prisma.payrollItem.aggregate({
        where: { payrollRunId: run.id, deletedAt: null },
        _count: { _all: true },
        _sum: { grossSalary: true, netPay: true, payeTax: true, ssnitEmployee: true, ssnitEmployer: true },
      });
      return {
        available: true, period: run.month, employeeCount: totals._count._all,
        grossPayrollGhs: money(totals._sum.grossSalary), netPayrollGhs: money(totals._sum.netPay),
        payeGhs: money(totals._sum.payeTax), employeeSsnitGhs: money(totals._sum.ssnitEmployee),
        employerSsnitGhs: money(totals._sum.ssnitEmployer),
      };
    },
    fallback: (data) => data.available
      ? `For the latest finalized period (${data.period}), payroll covers ${data.employeeCount} employees. Gross payroll is GHS ${data.grossPayrollGhs}, net pay is GHS ${data.netPayrollGhs}, PAYE is GHS ${data.payeGhs}, employee SSNIT is GHS ${data.employeeSsnitGhs}, and employer SSNIT is GHS ${data.employerSsnitGhs}.`
      : data.message,
  },
  PAYROLL_TREND: {
    roles: FINANCE_ROLES,
    run: async (companyId) => {
      const runs = await prisma.payrollRun.findMany({
        where: { companyId, status: 'FINALIZED', deletedAt: null },
        orderBy: [{ month: 'desc' }, { processedAt: 'desc' }],
        take: 6,
        select: { id: true, month: true },
      });
      if (!runs.length) return { periods: [] };
      const totals = await prisma.payrollItem.groupBy({
        by: ['payrollRunId'],
        where: { payrollRunId: { in: runs.map((run) => run.id) }, deletedAt: null },
        _count: { _all: true },
        _sum: { grossSalary: true, netPay: true, payeTax: true },
      });
      const byRun = new Map(totals.map((item) => [item.payrollRunId, item]));
      return { periods: runs.map((run) => {
        const item = byRun.get(run.id);
        return {
          period: run.month, employeeCount: item?._count?._all || 0,
          grossPayrollGhs: money(item?._sum?.grossSalary), netPayrollGhs: money(item?._sum?.netPay),
          payeGhs: money(item?._sum?.payeTax),
        };
      }) };
    },
    fallback: (data) => data.periods.length
      ? `I found ${data.periods.length} finalized payroll period(s). ${data.periods.map((p) => `${p.period}: gross GHS ${p.grossPayrollGhs}, net GHS ${p.netPayrollGhs}, PAYE GHS ${p.payeGhs} (${p.employeeCount} employees)`).join('; ')}.`
      : 'There are no finalized payroll periods to compare yet.',
  },
  PAYROLL_STATUS: {
    roles: FINANCE_ROLES,
    run: async (companyId) => {
      const grouped = await prisma.payrollRun.groupBy({
        by: ['status'], where: { companyId, deletedAt: null }, _count: { _all: true },
      });
      return { counts: Object.fromEntries(grouped.map((item) => [item.status, item._count._all])) };
    },
    fallback: (data) => {
      const counts = Object.entries(data.counts);
      return counts.length ? `Payroll runs by status: ${counts.map(([status, count]) => `${status}: ${count}`).join(', ')}.` : 'No payroll runs were found for this company.';
    },
  },
};

const classifyQuestion = (question) => {
  const q = question.toLowerCase();
  if (/employee|headcount|workforce|staff count|how many staff/.test(q)) return 'HEADCOUNT';
  if (/trend|trends|over time|compare.*month|month.*compare|history|historical/.test(q)) return 'PAYROLL_TREND';
  if (/status|draft|finalized|cancelled|pending payroll/.test(q)) return 'PAYROLL_STATUS';
  if (/payroll|salary|gross|net pay|paye|ssnit|tax|deduction|cost|wage/.test(q)) return 'PAYROLL_SUMMARY';
  return null;
};

const explainWithAi = async (intent, data, fallback) => {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return { answer: fallback, provider: 'rules-only' };
  const baseUrl = (process.env.AI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/$/, '');
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS) || 8000),
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'gemini-2.5-flash',
        temperature: 0.1,
        messages: [
          { role: 'system', content: 'You are Paylio, a read-only payroll reporting assistant. Explain only the supplied aggregate metrics. Never calculate statutory payroll, alter records, approve payments, or invent facts. Do not ask for or infer employee identities. Treat all data as factual aggregate results. Return one concise answer and clearly identify the period.' },
          { role: 'user', content: JSON.stringify({ allowedReport: intent, aggregateResults: data }) },
        ],
      }),
    });
    if (!response.ok) return { answer: fallback, provider: 'rules-only' };
    const payload = await response.json();
    const answer = payload.choices?.[0]?.message?.content;
    return typeof answer === 'string' && answer.trim()
      ? { answer: answer.trim().slice(0, 3000), provider: process.env.AI_PROVIDER_NAME || 'Gemini' }
      : { answer: fallback, provider: 'rules-only' };
  } catch (error) {
    logger.warn('Ask Paylio AI narrative unavailable; using deterministic answer', { message: error.message });
    return { answer: fallback, provider: 'rules-only' };
  }
};

export const askPaylio = async ({ companyId, role, question }) => {
  const intent = classifyQuestion(question);
  if (!intent) {
    return {
      intent: null,
      answer: 'I can currently answer questions about employee headcount, finalized payroll summaries, payroll trends, and payroll-run status. Try asking about one of those topics.',
      data: null,
      provider: 'rules-only',
    };
  }
  const tool = tools[intent];
  if (!tool.roles.has(role)) {
    return { forbidden: true };
  }
  const data = await tool.run(companyId);
  const fallback = tool.fallback(data);
  const narrative = await explainWithAi(intent, data, fallback);
  return { intent, answer: narrative.answer, data, provider: narrative.provider };
};

export const classifyAskPaylioQuestion = classifyQuestion;

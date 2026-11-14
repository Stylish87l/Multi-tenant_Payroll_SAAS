import { REST_BASE, TOKEN_KEY } from '../lib/apolloClient';

const authHeaders = (accept = 'application/json') => {
  const token = localStorage.getItem(TOKEN_KEY);
  return {
    Accept: accept,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

const readError = async (response, fallback) => {
  const body = await response.json().catch(() => ({}));
  return new Error(body?.error || fallback);
};

/** Fetch only the authenticated employee's finalized payslips. */
export const getMyPayslips = async ({ signal } = {}) => {
  const response = await fetch(`${REST_BASE}/api/payslips/mine`, {
    headers: authHeaders(),
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw await readError(response, 'Unable to load your payslips.');
  const body = await response.json();
  return Array.isArray(body.payslips) ? body.payslips : [];
};

/** Download a finalized payslip; the API enforces employee ownership server-side. */
export const downloadMyPayslipPdf = async (itemId) => {
  const response = await fetch(
    `${REST_BASE}/api/payslips/item/${encodeURIComponent(itemId)}/pdf`,
    { headers: authHeaders('application/pdf'), cache: 'no-store' },
  );
  if (!response.ok) throw await readError(response, 'Payslip download failed.');
  return response.blob();
};

import { REST_BASE } from '../lib/apolloClient';
import { authFetch } from '../lib/authFetch';

const readError = async (response, fallback) => {
  const body = await response.json().catch(() => ({}));
  return new Error(body?.error || fallback);
};

/** Fetch only the authenticated employee's finalized payslips. */
export const getMyPayslips = async ({ signal } = {}) => {
  const response = await authFetch(`${REST_BASE}/api/payslips/mine`, {
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw await readError(response, 'Unable to load your payslips.');
  const body = await response.json();
  return Array.isArray(body.payslips) ? body.payslips : [];
};

/** Download a finalized payslip; the API enforces employee ownership server-side. */
export const downloadMyPayslipPdf = async (itemId) => {
  const response = await authFetch(
    `${REST_BASE}/api/payslips/item/${encodeURIComponent(itemId)}/pdf`,
    { headers: { Accept: 'application/pdf' }, cache: 'no-store' },
  );
  if (!response.ok) throw await readError(response, 'Payslip download failed.');
  return response.blob();
};

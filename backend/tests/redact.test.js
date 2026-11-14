import { describe, test, expect } from '@jest/globals';
import { redact, REDACTED } from '../utils/redact.js';

describe('log metadata redaction', () => {
  test('redacts invitation links and contact details recursively', () => {
    expect(redact({ inviteLink: 'https://app.example.test/accept-invite?token=secret', to: 'person@example.test', nested: { email: 'person@example.test', phone: '+233200000000' } }))
      .toEqual({ inviteLink: REDACTED, to: REDACTED, nested: { email: REDACTED, phone: REDACTED } });
  });
  test('continues to redact authentication and payroll identifiers', () => {
    expect(redact({ refreshToken: 'secret', bankAccount: '123456789', ghanaCardPin: 'GHA-000000000-0' }))
      .toEqual({ refreshToken: REDACTED, bankAccount: REDACTED, ghanaCardPin: REDACTED });
  });
});

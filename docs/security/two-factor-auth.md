# Two-factor authentication

Paylio now supports opt-in authenticator-app TOTP for each user. The legacy notification-preference flag is not used for authentication; the security state is stored on the User record.

## User flow

1. In Settings, enter the current password and start authenticator setup.
2. Add the displayed Paylio setup key to an authenticator app. The API also returns an `otpauth://` URI.
3. Enter the current six-digit code to verify and enable TOTP.
4. Save the ten recovery codes shown once. Each recovery code can be used only once.
5. On subsequent sign-ins, enter the password and either the authenticator code or an unused recovery code.

Disabling 2FA requires the current password and a valid TOTP or recovery code. Regenerating recovery codes requires a valid TOTP or recovery code and invalidates all previous recovery codes.

2FA is currently user opt-in. Company-wide mandatory enforcement is not enabled by this release.

## Security controls

- TOTP follows RFC 6238: HMAC-SHA1, six digits, 30-second time steps, and a one-step clock-skew window.
- Accepted TOTP counters are stored and conditionally advanced so a time-step code cannot be replayed.
- Authenticator secrets are encrypted with AES-256-GCM using the configured data-encryption key. They are never returned by profile or user-management APIs.
- Recovery codes contain 96 bits of randomness and only SHA-256 hashes are stored. Consumption is atomic and one-time.
- Enrollment and disable require the current password. TOTP management endpoints are rate-limited.
- Invalid second-factor login attempts count toward the existing login lockout.
- Recovery-code use, enrollment, enablement, disablement and regeneration are audit logged. Codes and authenticator secrets are not included in audit details.
- Responses containing authenticator secrets or recovery codes use `Cache-Control: no-store`.

## API

- `GET /api/auth/2fa/status`
- `POST /api/auth/2fa/enroll` — `{ "password": "current password" }`
- `POST /api/auth/2fa/verify-enrollment` — `{ "code": "123456" }`
- `POST /api/auth/2fa/disable` — `{ "password": "current password", "code": "123456 or recovery code" }`
- `POST /api/auth/2fa/recovery-codes/regenerate` — `{ "code": "123456 or recovery code" }`

The GraphQL `login` mutation accepts an optional `twoFactorCode`. When a user has enabled 2FA, the password alone does not create a session.

## Key rotation and deployment

The TOTP secret uses the same AES data-encryption key as employee PII. The `employee-pii:rotate` command now also re-encrypts stored TOTP secrets before old keys are removed. Apply migration `20261125040000_two_factor_auth` before deploying the TOTP routes; production startup refuses to run if any stored TOTP secret is not encrypted.

No production migration or deployment has been performed by this change.

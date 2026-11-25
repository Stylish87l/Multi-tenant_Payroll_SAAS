# Password reset flow

The password reset flow is available at:

- `POST /api/auth/forgot-password` with `{ "email": "user@company.com" }`
- `POST /api/auth/reset-password` with `{ "token": "<one-time-token>", "password": "<new-password>" }`

The frontend provides `/forgot-password` and `/reset-password` pages.

## Security properties

- The request endpoint returns the same generic success message whether or not an active account exists.
- Requests are rate-limited to five per IP per 15 minutes and throttled to one active request per account per minute.
- Reset tokens are 32 cryptographically random bytes. Only their SHA-256 hashes are stored.
- Tokens expire after 30 minutes, are single-use, and earlier outstanding tokens are invalidated when a new link is issued.
- The reset link carries its token in the URL fragment, not the query string. The frontend removes the fragment from browser history after reading it.
- Passwords use the existing auth password policy and bcrypt cost 12.
- Completing a reset revokes every active refresh-token session and writes a `PASSWORD_RESET_COMPLETED` audit event.
- The raw reset token is never written to application logs or audit records.

Access JWTs are stateless and have a short configured lifetime (15 minutes by default); they naturally expire within that window after a reset. Refresh sessions are revoked immediately.

## Required delivery configuration

The existing `FRONTEND_URL` must point to the trusted frontend origin. The existing SMTP settings (`EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, and optional `EMAIL_FROM`) must be configured for email delivery. If SMTP is unavailable, the generic response is still returned and the unused token is invalidated; configure and test SMTP before enabling this flow in production.

No production deployment or database migration has been performed by this change.

# Backend production environment

## Required CSRF signing key

The backend requires a dedicated `CSRF_SECRET` at startup. It must contain at least 32 bytes and must be independent from both JWT signing secrets.

Generate a value locally:

```sh
openssl rand -hex 32
```

Set the resulting value as a backend environment variable in the deployment platform and in local `backend/.env` files. Do not commit the value, put it in a frontend `VITE_*` variable, or reuse `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`.

The server intentionally fails fast when this variable is missing or shorter than 32 bytes. This prevents the CSRF endpoint from accepting an absent or weak signing key at runtime.

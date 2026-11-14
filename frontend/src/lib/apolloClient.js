// src/lib/apolloClient.js
import { ApolloClient, InMemoryCache, split, from, Observable, createHttpLink } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { onError } from '@apollo/client/link/error';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';
import { getMainDefinition } from '@apollo/client/utilities';

const HTTP_URL = import.meta.env.VITE_GRAPHQL_API_URL;
const WS_URL = import.meta.env.VITE_GRAPHQL_WS_URL;

if (!HTTP_URL) throw new Error('VITE_GRAPHQL_API_URL is not defined');

/** REST base derived from the GraphQL URL (e.g. https://api.example.com). */
export const REST_BASE = HTTP_URL.replace(/\/graphql\/?$/, '');

export const TOKEN_KEY = 'token';
export const USER_KEY = 'user';

// --- CSRF bootstrap + refresh singleton ---
let refreshPromise = null;
let csrfTokenPromise = null;

const getCsrfToken = async () => {
  if (!csrfTokenPromise) {
    csrfTokenPromise = fetch(`${REST_BASE}/api/auth/csrf-token`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Unable to obtain CSRF token (${response.status})`);
      const payload = await response.json();
      if (!payload.csrfToken) throw new Error('CSRF token missing from server response');
      return payload.csrfToken;
    }).catch((error) => {
      csrfTokenPromise = null;
      throw error;
    });
  }
  return csrfTokenPromise;
};

export const doRefresh = async () => {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const csrfToken = await getCsrfToken();
      const res = await fetch(`${REST_BASE}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      });

      if (res.status === 401) throw new Error('EXPIRED');
      if (!res.ok) throw new Error(`Refresh failed with status ${res.status}`);

      const json = await res.json();
      const accessToken = json.accessToken || json.token;
      if (!accessToken) throw new Error('No access token returned from refresh');

      localStorage.setItem(TOKEN_KEY, accessToken);
      if (json.user) localStorage.setItem(USER_KEY, JSON.stringify(json.user));
      return accessToken;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
};

/**
 * Revokes the refresh token server-side and clears the cookie.
 */
export const doLogout = async () => {
  try {
    const csrfToken = await getCsrfToken();
    await fetch(`${REST_BASE}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-csrf-token': csrfToken },
    });
  } catch (err) {
    console.warn('Logout request failed', err);
  }
};

const httpLink = createHttpLink({ uri: HTTP_URL, credentials: 'include' });

const authLink = setContext((_, { headers }) => {
  const token = localStorage.getItem(TOKEN_KEY);
  return {
    headers: {
      ...headers,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'apollo-require-preflight': 'true',
    },
  };
});

let wsLink = null;
if (WS_URL) {
  try {
    wsLink = new GraphQLWsLink(
      createClient({
        url: WS_URL,
        lazy: true,
        retryAttempts: Infinity,
        retryWait: (retries) => {
          const ms = Math.min(30000, Math.round(300 * 2 ** retries * (0.8 + Math.random() * 0.4)));
          return new Promise((res) => setTimeout(res, ms));
        },
        // Tenant scope comes from the verified JWT server-side; nothing else is sent.
        connectionParams: () => {
          const token = localStorage.getItem(TOKEN_KEY);
          return { authorization: token ? `Bearer ${token}` : '' };
        },
      })
    );
  } catch (err) {
    console.warn('WebSocket link disabled:', err);
  }
}

// Refresh + retry once on UNAUTHENTICATED (resolvers now emit this code; they previously threw plain Errors).
const errorLink = onError(({ graphQLErrors, networkError, operation, forward }) => {
  const isAuthError =
    graphQLErrors?.some((e) => e.extensions?.code === 'UNAUTHENTICATED') ||
    networkError?.statusCode === 401 ||
    networkError?.status === 401;

  graphQLErrors?.forEach(({ message, extensions }) => {
    if (extensions?.code !== 'UNAUTHENTICATED') console.warn('[GraphQL Error]', message);
  });
  if (networkError) console.error('[Network Error]', networkError);

  if (!isAuthError) return undefined;

  return new Observable((observer) => {
    let subscriber;
    (async () => {
      try {
        const newToken = await doRefresh();
        const oldHeaders = operation.getContext().headers || {};
        operation.setContext({
          headers: { ...oldHeaders, authorization: `Bearer ${newToken}`, 'apollo-require-preflight': 'true' },
        });
        subscriber = forward(operation).subscribe({
          next: observer.next.bind(observer),
          error: observer.error.bind(observer),
          complete: observer.complete.bind(observer),
        });
      } catch (err) {
        observer.error(err);
      }
    })();
    return () => subscriber?.unsubscribe();
  });
});

const terminatingLink = wsLink
  ? split(
      ({ query }) => {
        const def = getMainDefinition(query);
        return def.kind === 'OperationDefinition' && def.operation === 'subscription';
      },
      wsLink,
      authLink.concat(httpLink)
    )
  : authLink.concat(httpLink);

const link = from([errorLink, terminatingLink]);

// Pagination merge: `page` is intentionally NOT in keyArgs, so every page of a list shares one cache entry.
// Callers must paginate with fetchMore ONLY (no manual updateQuery), or items duplicate.
const paginatedMerge = (existing, incoming, { args }) => {
  if (!existing || !args?.page || args.page === 1) return incoming;
  return { ...incoming, items: [...(existing.items || []), ...incoming.items] };
};

const cache = new InMemoryCache({
  typePolicies: {
    Query: {
      fields: {
        employees: { keyArgs: ['companyId', 'search'], merge: paginatedMerge },
        payrollRuns: { keyArgs: ['companyId'], merge: paginatedMerge },
        recentPayrollRuns: { merge: false },
      },
    },
    PayrollRun: { keyFields: ['id'] },
    Employee: { keyFields: ['id'] },
  },
});

export const client = new ApolloClient({
  link,
  cache,
  defaultOptions: {
    watchQuery: { fetchPolicy: 'cache-and-network', errorPolicy: 'all' },
    query: { fetchPolicy: 'network-only', errorPolicy: 'all' },
    // FIXED: was errorPolicy 'all', which makes a FAILED mutation resolve normally. Employees.jsx closed
    // the modal as if it had saved, Settings never rolled back, and Login always showed "Login failed".
    // 'none' makes failed mutations reject so every catch block actually runs.
    mutate: { errorPolicy: 'none' },
  },
  devtools: { enabled: import.meta.env.DEV },
});

export default client;

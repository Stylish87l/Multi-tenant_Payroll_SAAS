// src/lib/apolloClient.js
import {
  ApolloClient,
  InMemoryCache,
  split,
  from,
  Observable,
  createHttpLink,
} from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { onError } from '@apollo/client/link/error';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';
import { getMainDefinition } from '@apollo/client/utilities';

// --- Environment variables ---
const HTTP_URL = import.meta.env.VITE_GRAPHQL_API_URL; 
const WS_URL = import.meta.env.VITE_GRAPHQL_WS_URL;

if (!HTTP_URL) throw new Error('VITE_GRAPHQL_API_URL is not defined');

// --- Refresh singleton to avoid concurrent refreshes ---
let refreshPromise = null;

/**
 * Shared refresh function.
 * Maintains session stability without unprompted storage clearing.
 */
export const doRefresh = async () => {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${HTTP_URL.replace('/graphql', '')}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (res.status === 401) {
        throw new Error('EXPIRED');
      }

      if (!res.ok) {
        throw new Error(`Refresh failed with status ${res.status}`);
      }

      const json = await res.json();
      const accessToken = json.accessToken || json.token;
      const { companyId, user } = json;

      if (!accessToken) {
        throw new Error('No access token returned from refresh');
      }

      // Sync with localStorage
      localStorage.setItem('token', accessToken);
      if (companyId) localStorage.setItem('companyContext', companyId);
      if (user) localStorage.setItem('user', JSON.stringify(user));

      return accessToken;
    } catch (err) {
      throw err;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
};

// --- Standard HTTP link ---
const httpLink = createHttpLink({
  uri: HTTP_URL,
  credentials: 'include', // CRITICAL: Allows Mutation.login to set the cookie
});

// --- Auth link: injects token ---
const authLink = setContext((_, { headers }) => {
  const token = localStorage.getItem('token');

  return {
    headers: {
      ...headers,
      authorization: token ? `Bearer ${token}` : '',
      'apollo-require-preflight': 'true',
    },
  };
});

// --- WebSocket link (subscriptions) ---
let wsLink = null;
if (WS_URL) {
  try {
    wsLink = new GraphQLWsLink(
      createClient({
        url: WS_URL,
        lazy: true,
        retryAttempts: Infinity,
        retryWait: async (retries) => {
          const base = 300;
          const ms = Math.min(
            30000,
            Math.round(base * Math.pow(2, retries) * (0.8 + Math.random() * 0.4))
          );
          return new Promise((res) => setTimeout(res, ms));
        },
        connectionParams: () => {
          const token = localStorage.getItem('token');
          return {
            // FIXED: Avoids passing 'Bearer null' when token is missing
            authorization: token ? `Bearer ${token}` : '',
            companyId: localStorage.getItem('companyContext'),
          };
        },
      })
    );
  } catch (err) {
    console.warn('WebSocket link disabled:', err);
    wsLink = null;
  }
}

// --- Error link: refresh on UNAUTHENTICATED ---
const errorLink = onError(({ graphQLErrors, networkError, operation, forward }) => {
  const isAuthError =
    (graphQLErrors && graphQLErrors.some((e) => e.extensions?.code === 'UNAUTHENTICATED')) ||
    (networkError && (networkError.statusCode === 401 || networkError.status === 401));

  if (graphQLErrors) {
    graphQLErrors.forEach(({ message, extensions }) => {
      if (extensions?.code !== 'UNAUTHENTICATED') {
        console.warn('[GraphQL Error]', message);
      }
    });
  }

  if (networkError) {
    console.error('[Network Error]', networkError);
  }

  if (!isAuthError) return;

  return new Observable((observer) => {
    let subscriber;

    (async () => {
      try {
        const newToken = await doRefresh();
        if (!newToken) throw new Error('Refresh failed');

        const oldHeaders = operation.getContext().headers || {};
        operation.setContext({
          headers: {
            ...oldHeaders,
            authorization: `Bearer ${newToken}`,
            // FIXED: Removed misleading 'x-tenant-id' token injection. 
            // Multi-tenant scoping relies strictly on JWT contents.
            'apollo-require-preflight': 'true',
          },
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

    return () => {
      if (subscriber) {
        subscriber.unsubscribe();
      }
    };
  });
});

// --- Split link: subscriptions vs queries/mutations ---
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

// --- Cache setup (Maintained with Pagination & Search logic) ---
const cache = new InMemoryCache({
  typePolicies: {
    Query: {
      fields: {
        employees: {
          keyArgs: ['companyId', 'search'], 
          merge(existing, incoming, { args }) {
            if (!existing || !args?.page || args.page === 1) {
              return incoming;
            }
            return {
              ...incoming,
              items: [...(existing.items || []), ...incoming.items],
            };
          },
        },
        payrollRuns: {
          keyArgs: ['companyId'],
          merge(existing, incoming, { args }) {
            if (!existing || !args?.page || args.page === 1) {
              return incoming;
            }
            return {
              ...incoming,
              items: [...(existing.items || []), ...incoming.items],
            };
          },
        },
        recentPayrollRuns: {
          merge: false,
        },
      },
    },
    PayrollRun: { keyFields: ['id'] },
    Employee: { keyFields: ['id'] },
  },
});

// --- Apollo Client instance ---
export const client = new ApolloClient({
  link,
  cache,
  defaultOptions: {
    watchQuery: { fetchPolicy: 'cache-and-network', errorPolicy: 'all' },
    query: { fetchPolicy: 'network-only', errorPolicy: 'all' },
    mutate: { errorPolicy: 'all' },
  },
  devtools: { enabled: import.meta.env.DEV },
});

export default client;
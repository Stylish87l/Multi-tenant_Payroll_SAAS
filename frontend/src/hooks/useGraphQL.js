// src/hooks/useGraphQL.js
import { useCallback } from 'react';
import { useQuery, useMutation, useSubscription } from '@apollo/client';

/**
 * Default options applied to queries, mutations and subscriptions.
 * These are conservative defaults tuned for PWA UX and predictable cache behavior.
 */
const DEFAULT_QUERY_OPTIONS = {
  fetchPolicy: 'cache-and-network',
  nextFetchPolicy: 'cache-first',
  notifyOnNetworkStatusChange: true,
  errorPolicy: 'all',
};

const DEFAULT_SUBSCRIPTION_OPTIONS = {
  shouldResubscribe: true,
  onError: (err) => {
    // Minimal default logging; apps can override with their own handler
    // eslint-disable-next-line no-console
    console.warn('Subscription error', err);
  },
};

/**
 * useGraphQLQuery
 * - Merges sensible defaults with caller options
 * - Keeps the same return shape as Apollo's useQuery
 */
export const useGraphQLQuery = (query, options = {}) => {
  const merged = { ...DEFAULT_QUERY_OPTIONS, ...options };
  return useQuery(query, merged);
};

/**
 * useGraphQLMutation
 * - Returns the same tuple as useMutation but wraps the mutate function
 *   with an optional retry mechanism (exponential backoff).
 *
 * Options supported (in addition to Apollo options):
 *  - retry: number of retry attempts (default 0)
 *  - retryDelay: base delay in ms for exponential backoff (default 300)
 */
export const useGraphQLMutation = (mutation, options = {}) => {
  const { retry = 0, retryDelay = 300, ...apolloOptions } = options;
  const [mutateFn, result] = useMutation(mutation, apolloOptions);

  const mutateWithRetry = useCallback(
    async (mutationOptions = {}) => {
      let attempt = 0;
      let lastError;
      while (attempt <= retry) {
        try {
          return await mutateFn(mutationOptions);
        } catch (err) {
          lastError = err;
          attempt += 1;
          if (attempt > retry) break;
          // exponential backoff with jitter
          const backoff = Math.round(retryDelay * Math.pow(2, attempt - 1) * (0.8 + Math.random() * 0.4));
          // eslint-disable-next-line no-await-in-loop
          await new Promise((res) => setTimeout(res, backoff));
        }
      }
      // rethrow the last error so callers can handle it
      throw lastError;
    },
    [mutateFn, retry, retryDelay]
  );

  // Keep the same tuple shape but replace mutate function with wrapper
  return [mutateWithRetry, result];
};

/**
 * useGraphQLSubscription
 * - Merges defaults and returns Apollo's useSubscription result
 */
export const useGraphQLSubscription = (subscription, options = {}) => {
  const merged = { ...DEFAULT_SUBSCRIPTION_OPTIONS, ...options };
  return useSubscription(subscription, merged);
};

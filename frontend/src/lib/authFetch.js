import { doRefresh, TOKEN_KEY } from './apolloClient';

/**
 * Authenticated REST fetch. Uses the same refresh singleton as Apollo and retries
 * an expired access-token request exactly once.
 */
export const authFetch = async (input, init = {}) => {
  const headers = new Headers(init.headers || {});
  const accessToken = localStorage.getItem(TOKEN_KEY);
  if (accessToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const request = {
    ...init,
    headers,
    credentials: init.credentials || 'include',
  };
  let response = await fetch(input, request);
  if (response.status !== 401) return response;

  const refreshedToken = await doRefresh();
  headers.set('Authorization', `Bearer ${refreshedToken}`);
  response = await fetch(input, request);
  return response;
};

export default authFetch;

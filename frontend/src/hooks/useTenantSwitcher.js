// src/hooks/useTenantSwitcher.js
import { useState, useCallback } from 'react';

/**
 * Hook to manage tenant switching state
 * Later you can connect this to a GraphQL mutation or REST API.
 */
export const useTenantSwitcher = (initialTenantId = null) => {
  const [activeTenant, setActiveTenant] = useState(initialTenantId);

  // Switch tenant locally
  const switchTenant = useCallback((tenantId) => {
    setActiveTenant(tenantId);

    // Placeholder: later call GraphQL mutation here
    // Example:
    // await apolloClient.mutate({
    //   mutation: SWITCH_TENANT,
    //   variables: { companyId: tenantId },
    // });

    console.log(`Switched to tenant: ${tenantId}`);
  }, []);

  return {
    activeTenant,
    switchTenant,
  };
};

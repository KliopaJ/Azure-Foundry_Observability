import { Configuration, BrowserCacheLocation } from '@azure/msal-browser'

export function msalConfig(clientId: string, tenantId: string): Configuration {
  return {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri: window.location.origin,
      postLogoutRedirectUri: window.location.origin,
    },
    cache: {
      cacheLocation: BrowserCacheLocation.SessionStorage,
      storeAuthStateInCookie: false,
    },
  }
}

export const ARM_SCOPES = ['https://management.azure.com/user_impersonation']

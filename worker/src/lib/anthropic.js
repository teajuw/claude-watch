/**
 * Anthropic API client for fetching usage data
 */

const USAGE_API_URL = 'https://api.anthropic.com/api/oauth/usage';
const TOKEN_REFRESH_URL = 'https://console.anthropic.com/api/oauth/token';
const CLAUDE_CODE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

/**
 * Fetch current usage from Anthropic API
 */
export async function fetchUsage(accessToken) {
  const response = await fetch(USAGE_API_URL, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Usage fetch failed: ${response.status} - ${error}`);
  }

  return response.json();
}

/**
 * Check if token is expired (with 5 minute buffer)
 */
export function isTokenExpired(expiresAt) {
  const bufferMs = 5 * 60 * 1000; // 5 minutes
  return Date.now() > (expiresAt - bufferMs);
}

/**
 * Refresh the access token using refresh token
 * Uses the official Claude Code client_id for token refresh
 */
export async function refreshAccessToken(refreshToken) {
  const response = await fetch(TOKEN_REFRESH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLAUDE_CODE_CLIENT_ID,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${response.status} - ${error}`);
  }

  const result = await response.json();

  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token || refreshToken,
    expiresAt: Date.now() + (result.expires_in * 1000),
  };
}

/**
 * Get valid access token, refreshing if needed
 * Uses KV for token storage since tokens change frequently
 */
export async function getValidAccessToken(env) {
  // Try to get tokens from KV first
  let tokens = await env.KV.get('oauth_tokens', 'json');

  // Fall back to secrets if KV is empty (first run)
  if (!tokens) {
    tokens = {
      accessToken: env.CLAUDE_ACCESS_TOKEN,
      refreshToken: env.CLAUDE_REFRESH_TOKEN,
      expiresAt: parseInt(env.CLAUDE_TOKEN_EXPIRES_AT || '0'),
    };
  }

  // Check if token needs refresh
  if (isTokenExpired(tokens.expiresAt) && tokens.refreshToken) {
    console.log('Token expired, refreshing...');
    try {
      const newTokens = await refreshAccessToken(tokens.refreshToken);

      // Save new tokens to KV
      await env.KV.put('oauth_tokens', JSON.stringify(newTokens));
      console.log('Token refreshed and saved to KV');

      return newTokens.accessToken;
    } catch (error) {
      console.error('Token refresh failed:', error);
      // Try with existing token anyway
      return tokens.accessToken;
    }
  }

  return tokens.accessToken;
}

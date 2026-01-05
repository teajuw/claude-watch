/**
 * Token management API
 * Allows updating and fetching OAuth tokens (secured with API_SECRET)
 */

import { corsHeaders, errorResponse } from '../utils/cors';

/**
 * Verify API_SECRET authorization
 */
function verifyAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false, error: 'Missing authorization header', status: 401 };
  }

  const providedSecret = authHeader.slice(7);
  if (providedSecret !== env.API_SECRET) {
    return { valid: false, error: 'Invalid API secret', status: 403 };
  }

  return { valid: true };
}

/**
 * Get current OAuth tokens from KV storage
 * GET /api/tokens
 *
 * Headers: Authorization: Bearer <API_SECRET>
 * Returns: { accessToken, refreshToken, expiresAt }
 *
 * Use this to sync Worker tokens back to local Claude CLI
 */
export async function handleTokenGet(request, env) {
  const auth = verifyAuth(request, env);
  if (!auth.valid) {
    return new Response(JSON.stringify({
      success: false,
      error: auth.error,
    }), {
      status: auth.status,
      headers: corsHeaders,
    });
  }

  try {
    const tokens = await env.KV.get('oauth_tokens', 'json');

    if (!tokens) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No tokens in KV. Run sync-credentials first.',
      }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        expiresAtISO: new Date(tokens.expiresAt).toISOString(),
      },
    }), {
      headers: corsHeaders,
    });

  } catch (error) {
    return errorResponse(`Token fetch failed: ${error.message}`);
  }
}

/**
 * Update OAuth tokens in KV storage
 * POST /api/tokens/update
 *
 * Headers: Authorization: Bearer <API_SECRET>
 * Body: { accessToken, refreshToken, expiresAt }
 */
export async function handleTokenUpdate(request, env) {
  const auth = verifyAuth(request, env);
  if (!auth.valid) {
    return new Response(JSON.stringify({
      success: false,
      error: auth.error,
    }), {
      status: auth.status,
      headers: corsHeaders,
    });
  }

  try {
    const body = await request.json();
    const { accessToken, refreshToken, expiresAt } = body;

    if (!accessToken || !refreshToken || !expiresAt) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required fields: accessToken, refreshToken, expiresAt',
      }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Store in KV
    const tokens = {
      accessToken,
      refreshToken,
      expiresAt: parseInt(expiresAt),
    };

    await env.KV.put('oauth_tokens', JSON.stringify(tokens));

    return new Response(JSON.stringify({
      success: true,
      message: 'Tokens updated',
      expiresAt: new Date(tokens.expiresAt).toISOString(),
    }), {
      headers: corsHeaders,
    });

  } catch (error) {
    return errorResponse(`Token update failed: ${error.message}`);
  }
}

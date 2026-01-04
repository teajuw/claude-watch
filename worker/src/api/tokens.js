/**
 * Token management API
 * Allows updating OAuth tokens via HTTP POST (secured with API_SECRET)
 */

import { corsHeaders, errorResponse } from '../utils/cors';

/**
 * Update OAuth tokens in KV storage
 * POST /api/tokens/update
 *
 * Headers: Authorization: Bearer <API_SECRET>
 * Body: { accessToken, refreshToken, expiresAt }
 */
export async function handleTokenUpdate(request, env) {
  // Verify authorization
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Missing authorization header',
    }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  const providedSecret = authHeader.slice(7);
  if (providedSecret !== env.API_SECRET) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Invalid API secret',
    }), {
      status: 403,
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

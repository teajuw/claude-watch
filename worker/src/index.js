/**
 * Claude Watch - Cloudflare Worker
 *
 * Main router for API endpoints and cron handler
 */

import { handleUsage } from './api/usage';
import { handleHistory } from './api/history';
import { handleScheduleGet, handleSchedulePost } from './api/schedule';
import { handleSessionStart } from './api/session';
import { runCron } from './cron/poll';
import { handleCors, corsHeaders, errorResponse } from './utils/cors';

export default {
  /**
   * HTTP request handler
   */
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCors();
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // API Routes
      switch (path) {
        case '/api/usage':
          if (request.method === 'GET') {
            return handleUsage(env);
          }
          break;

        case '/api/history':
          if (request.method === 'GET') {
            return handleHistory(request, env);
          }
          break;

        case '/api/schedule':
          if (request.method === 'GET') {
            return handleScheduleGet(env);
          } else if (request.method === 'POST') {
            return handleSchedulePost(request, env);
          }
          break;

        case '/api/session/start':
          if (request.method === 'POST') {
            return handleSessionStart(env);
          }
          break;

        case '/':
          // Health check
          return new Response(JSON.stringify({
            status: 'ok',
            service: 'claude-watch',
            timestamp: new Date().toISOString(),
          }), {
            headers: corsHeaders,
          });
      }

      // 404 for unknown routes
      return new Response(JSON.stringify({
        success: false,
        error: 'Not found',
        path,
      }), {
        status: 404,
        headers: corsHeaders,
      });

    } catch (error) {
      console.error('Request error:', error);
      return errorResponse(error.message);
    }
  },

  /**
   * Cron trigger handler - runs every minute
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env));
  },
};

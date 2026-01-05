/**
 * Claude Watch - Cloudflare Worker
 *
 * Main router for API endpoints and cron handler
 */

import { handleUsage } from './api/usage';
import { handleHistory } from './api/history';
import { handleUsageLog, handleProjectsSummary, handleProjectsHistory, handleProjectsDetails, handleTokensSummary, handleCostsSummary } from './api/projects';
import { handleAgentHeartbeat, handleAgentsList, handleAgentDetails, handleAgentHistory, handleAgentsSummary } from './api/agents';
import { handleTokenUpdate } from './api/tokens';
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
      // Handle dynamic agent routes (but not /api/agents/summary which is a static route)
      const agentMatch = path.match(/^\/api\/agents\/([^\/]+)$/);
      const agentHistoryMatch = path.match(/^\/api\/agents\/([^\/]+)\/history$/);

      if (agentHistoryMatch && request.method === 'GET') {
        return handleAgentHistory(request, env, agentHistoryMatch[1]);
      }
      if (agentMatch && agentMatch[1] !== 'summary' && request.method === 'GET') {
        return handleAgentDetails(request, env, agentMatch[1]);
      }

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

        case '/api/usage/log':
          if (request.method === 'POST') {
            return handleUsageLog(request, env);
          }
          break;

        case '/api/projects/summary':
          if (request.method === 'GET') {
            return handleProjectsSummary(request, env);
          }
          break;

        case '/api/projects/history':
          if (request.method === 'GET') {
            return handleProjectsHistory(request, env);
          }
          break;

        case '/api/projects/details':
          if (request.method === 'GET') {
            return handleProjectsDetails(request, env);
          }
          break;

        case '/api/tokens/summary':
          if (request.method === 'GET') {
            return handleTokensSummary(request, env);
          }
          break;

        case '/api/costs/summary':
          if (request.method === 'GET') {
            return handleCostsSummary(request, env);
          }
          break;

        // Agent endpoints
        case '/api/agent/heartbeat':
          if (request.method === 'POST') {
            return handleAgentHeartbeat(request, env);
          }
          break;

        case '/api/agents':
          if (request.method === 'GET') {
            return handleAgentsList(request, env);
          }
          break;

        case '/api/agents/summary':
          if (request.method === 'GET') {
            return handleAgentsSummary(request, env);
          }
          break;

        case '/api/tokens/update':
          if (request.method === 'POST') {
            return handleTokenUpdate(request, env);
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

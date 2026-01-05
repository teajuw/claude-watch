/**
 * Agent tracking endpoints
 * Handles metrics from multiple Claude agents (containers/sessions)
 */

import { corsHeaders } from '../utils/cors';

/**
 * POST /api/agent/heartbeat
 * Receives per-message usage data from agent's Stop hook
 */
export async function handleAgentHeartbeat(request, env) {
  try {
    const body = await request.json();
    const {
      agent_id,
      project,
      session_id,
      input_tokens,
      output_tokens,
      model_id,
      duration_ms,
      lines_added,
      lines_removed,
      cache_write,
      cache_read,
      context_pct,
      cost_usd,
      timestamp
    } = body;

    // Validate required fields
    if (!agent_id || !timestamp) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required fields: agent_id, timestamp',
      }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Insert into agent_metrics table with all fields
    await env.DB.prepare(`
      INSERT INTO agent_metrics (
        agent_id, project, session_id, input_tokens, output_tokens,
        model_id, duration_ms, lines_added, lines_removed,
        cache_write, cache_read, context_pct, cost_usd, timestamp
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      agent_id,
      project || 'unknown',
      session_id || 'unknown',
      input_tokens || 0,
      output_tokens || 0,
      model_id || 'unknown',
      duration_ms || 0,
      lines_added || 0,
      lines_removed || 0,
      cache_write || 0,
      cache_read || 0,
      context_pct || 0,
      cost_usd || 0,
      timestamp
    ).run();

    // Update agent_status (upsert with composite key agent_id + project)
    await env.DB.prepare(`
      INSERT INTO agent_status (
        agent_id, project, last_seen, status,
        total_input_tokens, total_output_tokens,
        total_lines_added, total_lines_removed,
        total_duration_ms, session_count
      )
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, 1)
      ON CONFLICT(agent_id, project) DO UPDATE SET
        last_seen = excluded.last_seen,
        status = 'active',
        total_input_tokens = total_input_tokens + excluded.total_input_tokens,
        total_output_tokens = total_output_tokens + excluded.total_output_tokens,
        total_lines_added = total_lines_added + excluded.total_lines_added,
        total_lines_removed = total_lines_removed + excluded.total_lines_removed,
        total_duration_ms = total_duration_ms + excluded.total_duration_ms,
        session_count = session_count + 1
    `).bind(
      agent_id,
      project || 'unknown',
      timestamp,
      input_tokens || 0,
      output_tokens || 0,
      lines_added || 0,
      lines_removed || 0,
      duration_ms || 0
    ).run();

    return new Response(JSON.stringify({
      success: true,
      message: 'Heartbeat received',
      agent_id,
      project,
    }), {
      headers: corsHeaders,
    });

  } catch (error) {
    console.error('Error handling heartbeat:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}

/**
 * GET /api/agents
 * Returns list of all agents with their status (per agent:project)
 */
export async function handleAgentsList(request, env) {
  try {
    const result = await env.DB.prepare(`
      SELECT
        agent_id,
        project,
        last_seen,
        status,
        total_input_tokens,
        total_output_tokens,
        total_lines_added,
        total_lines_removed,
        total_duration_ms,
        session_count,
        CASE
          WHEN datetime(last_seen) > datetime('now', '-5 minutes') THEN 'active'
          WHEN datetime(last_seen) > datetime('now', '-30 minutes') THEN 'idle'
          ELSE 'inactive'
        END as computed_status
      FROM agent_status
      ORDER BY last_seen DESC
    `).all();

    return new Response(JSON.stringify({
      success: true,
      data: result.results || [],
      count: result.results?.length || 0,
    }), {
      headers: corsHeaders,
    });

  } catch (error) {
    console.error('Error listing agents:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}

/**
 * GET /api/agents/:id
 * Returns specific agent details and recent metrics
 */
export async function handleAgentDetails(request, env, agentId) {
  try {
    // Get agent status
    const status = await env.DB.prepare(`
      SELECT * FROM agent_status WHERE agent_id = ?
    `).bind(agentId).first();

    if (!status) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Agent not found',
      }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    // Get recent metrics (last 24 hours)
    const metrics = await env.DB.prepare(`
      SELECT
        timestamp,
        project,
        input_tokens,
        output_tokens
      FROM agent_metrics
      WHERE agent_id = ?
        AND datetime(timestamp) > datetime('now', '-24 hours')
      ORDER BY timestamp DESC
      LIMIT 100
    `).bind(agentId).all();

    return new Response(JSON.stringify({
      success: true,
      data: {
        status,
        metrics: metrics.results || [],
      },
    }), {
      headers: corsHeaders,
    });

  } catch (error) {
    console.error('Error getting agent details:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}

/**
 * GET /api/agents/:id/history
 * Returns agent usage over time
 */
export async function handleAgentHistory(request, env, agentId) {
  try {
    const url = new URL(request.url);
    const range = url.searchParams.get('range') || '7d';

    const days = range === '24h' ? 1 : range === '30d' ? 30 : 7;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const result = await env.DB.prepare(`
      SELECT
        DATE(timestamp) as date,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        COUNT(*) as message_count
      FROM agent_metrics
      WHERE agent_id = ?
        AND timestamp >= ?
      GROUP BY DATE(timestamp)
      ORDER BY date
    `).bind(agentId, cutoff).all();

    return new Response(JSON.stringify({
      success: true,
      data: result.results || [],
      agent_id: agentId,
      range,
    }), {
      headers: corsHeaders,
    });

  } catch (error) {
    console.error('Error getting agent history:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}

/**
 * GET /api/agents/details
 * Returns comprehensive agent data with projects breakdown
 */
export async function handleAgentsDetails(request, env) {
  try {
    const url = new URL(request.url);
    const range = url.searchParams.get('range') || '7d';

    const days = range === '24h' ? 1 : range === '30d' ? 30 : 7;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Get comprehensive agent stats
    const agentStats = await env.DB.prepare(`
      SELECT
        agent_id,
        SUM(input_tokens) as total_input,
        SUM(output_tokens) as total_output,
        SUM(input_tokens + output_tokens) as total_tokens,
        SUM(cost_usd) as total_cost,
        SUM(duration_ms) as total_duration_ms,
        SUM(lines_added) as total_lines_added,
        SUM(lines_removed) as total_lines_removed,
        COUNT(DISTINCT session_id) as session_count,
        COUNT(DISTINCT project) as project_count,
        COUNT(*) as message_count,
        MAX(timestamp) as last_seen,
        GROUP_CONCAT(DISTINCT project) as projects
      FROM agent_metrics
      WHERE timestamp >= ?
      GROUP BY agent_id
      ORDER BY last_seen DESC
    `).bind(cutoff).all();

    // Calculate totals
    const totals = {
      agent_count: agentStats.results?.length || 0,
      total_tokens: 0,
      total_cost: 0,
      total_duration_ms: 0,
      total_lines_added: 0,
      total_lines_removed: 0,
      session_count: 0,
    };

    const agents = (agentStats.results || []).map(a => {
      totals.total_tokens += a.total_tokens || 0;
      totals.total_cost += a.total_cost || 0;
      totals.total_duration_ms += a.total_duration_ms || 0;
      totals.total_lines_added += a.total_lines_added || 0;
      totals.total_lines_removed += a.total_lines_removed || 0;
      totals.session_count += a.session_count || 0;

      // Determine status based on last_seen
      const lastSeenDate = new Date(a.last_seen);
      const now = new Date();
      const diffMinutes = (now - lastSeenDate) / (1000 * 60);
      let status = 'inactive';
      if (diffMinutes < 5) status = 'active';
      else if (diffMinutes < 30) status = 'idle';

      return {
        id: a.agent_id,
        tokens: {
          input: a.total_input || 0,
          output: a.total_output || 0,
          total: a.total_tokens || 0,
        },
        cost: a.total_cost || 0,
        duration_ms: a.total_duration_ms || 0,
        duration_formatted: formatDuration(a.total_duration_ms || 0),
        lines: {
          added: a.total_lines_added || 0,
          removed: a.total_lines_removed || 0,
          net: (a.total_lines_added || 0) - (a.total_lines_removed || 0),
        },
        sessions: a.session_count || 0,
        messages: a.message_count || 0,
        projects: a.projects ? a.projects.split(',') : [],
        project_count: a.project_count || 0,
        last_seen: a.last_seen,
        status,
      };
    });

    return new Response(JSON.stringify({
      success: true,
      data: {
        agents,
        totals: {
          ...totals,
          duration_formatted: formatDuration(totals.total_duration_ms),
        },
      },
      range,
      cutoff,
    }), {
      headers: corsHeaders,
    });

  } catch (error) {
    console.error('Error getting agents details:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}

// Helper to format duration
function formatDuration(ms) {
  if (!ms || ms <= 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * GET /api/agents/summary
 * Returns fleet-wide summary
 */
export async function handleAgentsSummary(request, env) {
  try {
    const url = new URL(request.url);
    const range = url.searchParams.get('range') || '7d';

    const days = range === '24h' ? 1 : range === '30d' ? 30 : 7;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Get per-agent breakdown
    const agentBreakdown = await env.DB.prepare(`
      SELECT
        agent_id,
        project,
        SUM(input_tokens) as total_input,
        SUM(output_tokens) as total_output,
        COUNT(*) as message_count,
        MAX(timestamp) as last_seen
      FROM agent_metrics
      WHERE timestamp >= ?
      GROUP BY agent_id
      ORDER BY total_output DESC
    `).bind(cutoff).all();

    // Get totals
    const totals = await env.DB.prepare(`
      SELECT
        COUNT(DISTINCT agent_id) as agent_count,
        SUM(input_tokens) as total_input,
        SUM(output_tokens) as total_output,
        COUNT(*) as message_count
      FROM agent_metrics
      WHERE timestamp >= ?
    `).bind(cutoff).first();

    return new Response(JSON.stringify({
      success: true,
      data: {
        agents: agentBreakdown.results || [],
        totals: {
          agent_count: totals?.agent_count || 0,
          total_input: totals?.total_input || 0,
          total_output: totals?.total_output || 0,
          message_count: totals?.message_count || 0,
        },
      },
      range,
    }), {
      headers: corsHeaders,
    });

  } catch (error) {
    console.error('Error getting agents summary:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}

/**
 * Project usage tracking endpoints
 */

import { corsHeaders } from '../utils/cors';

/**
 * POST /api/usage/log
 * Receives per-message usage data from Stop hook
 */
export async function handleUsageLog(request, env) {
  try {
    const body = await request.json();
    const { session_id, project, input_tokens, output_tokens, timestamp } = body;

    // Validate required fields
    if (!project || !timestamp) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required fields: project, timestamp',
      }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Insert into project_usage table
    await env.DB.prepare(`
      INSERT INTO project_usage (session_id, project, input_tokens, output_tokens, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      session_id || 'unknown',
      project,
      input_tokens || 0,
      output_tokens || 0,
      timestamp
    ).run();

    return new Response(JSON.stringify({
      success: true,
      message: 'Usage logged',
    }), {
      headers: corsHeaders,
    });

  } catch (error) {
    console.error('Error logging usage:', error);
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
 * GET /api/projects/summary
 * Returns project breakdown for pie chart
 */
export async function handleProjectsSummary(request, env) {
  try {
    const url = new URL(request.url);
    const range = url.searchParams.get('range') || '7d';

    // Calculate cutoff based on range
    const days = range === '24h' ? 1 : range === '30d' ? 30 : 7;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const result = await env.DB.prepare(`
      SELECT
        project,
        SUM(input_tokens) as total_input,
        SUM(output_tokens) as total_output,
        SUM(input_tokens + output_tokens) as total_tokens,
        COUNT(*) as message_count
      FROM project_usage
      WHERE timestamp >= ?
      GROUP BY project
      ORDER BY total_tokens DESC
    `).bind(cutoff).all();

    return new Response(JSON.stringify({
      success: true,
      data: result.results || [],
      range,
      cutoff,
    }), {
      headers: corsHeaders,
    });

  } catch (error) {
    console.error('Error getting project summary:', error);
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
 * GET /api/projects/history
 * Returns project usage over time
 */
export async function handleProjectsHistory(request, env) {
  try {
    const url = new URL(request.url);
    const range = url.searchParams.get('range') || '7d';
    const project = url.searchParams.get('project'); // optional filter

    const days = range === '24h' ? 1 : range === '30d' ? 30 : 7;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    let query = `
      SELECT
        project,
        DATE(timestamp) as date,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        COUNT(*) as message_count
      FROM project_usage
      WHERE timestamp >= ?
    `;

    if (project) {
      query += ` AND project = ?`;
    }

    query += ` GROUP BY project, DATE(timestamp) ORDER BY date, project`;

    const stmt = project
      ? env.DB.prepare(query).bind(cutoff, project)
      : env.DB.prepare(query).bind(cutoff);

    const result = await stmt.all();

    return new Response(JSON.stringify({
      success: true,
      data: result.results || [],
      range,
    }), {
      headers: corsHeaders,
    });

  } catch (error) {
    console.error('Error getting project history:', error);
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
 * GET /api/tokens/summary
 * Returns total token counts for cost estimation
 */
export async function handleTokensSummary(request, env) {
  try {
    const url = new URL(request.url);
    const range = url.searchParams.get('range') || '7d';

    const days = range === '24h' ? 1 : range === '30d' ? 30 : 7;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const result = await env.DB.prepare(`
      SELECT
        SUM(input_tokens) as total_input,
        SUM(output_tokens) as total_output,
        SUM(input_tokens + output_tokens) as total_tokens,
        COUNT(*) as message_count
      FROM project_usage
      WHERE timestamp >= ?
    `).bind(cutoff).first();

    return new Response(JSON.stringify({
      success: true,
      data: {
        total_input: result?.total_input || 0,
        total_output: result?.total_output || 0,
        total_tokens: result?.total_tokens || 0,
        message_count: result?.message_count || 0,
      },
      range,
    }), {
      headers: corsHeaders,
    });

  } catch (error) {
    console.error('Error getting tokens summary:', error);
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
 * GET /api/projects/details
 * Returns comprehensive project data for Projects tab
 */
export async function handleProjectsDetails(request, env) {
  try {
    const url = new URL(request.url);
    const range = url.searchParams.get('range') || '7d';

    const days = range === '24h' ? 1 : range === '30d' ? 30 : 7;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Get comprehensive project stats from agent_metrics
    const projectStats = await env.DB.prepare(`
      SELECT
        project,
        SUM(input_tokens) as total_input,
        SUM(output_tokens) as total_output,
        SUM(input_tokens + output_tokens) as total_tokens,
        SUM(cost_usd) as total_cost,
        SUM(duration_ms) as total_duration_ms,
        SUM(lines_added) as total_lines_added,
        SUM(lines_removed) as total_lines_removed,
        COUNT(DISTINCT session_id) as session_count,
        COUNT(DISTINCT agent_id) as agent_count,
        COUNT(*) as message_count,
        MAX(timestamp) as last_activity,
        GROUP_CONCAT(DISTINCT agent_id) as agents
      FROM agent_metrics
      WHERE timestamp >= ?
      GROUP BY project
      ORDER BY total_tokens DESC
    `).bind(cutoff).all();

    // Calculate totals
    const totals = {
      total_tokens: 0,
      total_cost: 0,
      total_duration_ms: 0,
      total_lines_added: 0,
      total_lines_removed: 0,
      session_count: 0,
      project_count: projectStats.results?.length || 0,
    };

    const projects = (projectStats.results || []).map(p => {
      totals.total_tokens += p.total_tokens || 0;
      totals.total_cost += p.total_cost || 0;
      totals.total_duration_ms += p.total_duration_ms || 0;
      totals.total_lines_added += p.total_lines_added || 0;
      totals.total_lines_removed += p.total_lines_removed || 0;
      totals.session_count += p.session_count || 0;

      return {
        name: p.project,
        tokens: {
          input: p.total_input || 0,
          output: p.total_output || 0,
          total: p.total_tokens || 0,
        },
        cost: p.total_cost || 0,
        duration_ms: p.total_duration_ms || 0,
        duration_formatted: formatDuration(p.total_duration_ms || 0),
        lines: {
          added: p.total_lines_added || 0,
          removed: p.total_lines_removed || 0,
          net: (p.total_lines_added || 0) - (p.total_lines_removed || 0),
        },
        sessions: p.session_count || 0,
        messages: p.message_count || 0,
        agents: p.agents ? p.agents.split(',') : [],
        agent_count: p.agent_count || 0,
        last_activity: p.last_activity,
      };
    });

    return new Response(JSON.stringify({
      success: true,
      data: {
        projects,
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
    console.error('Error getting project details:', error);
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
 * GET /api/costs/summary
 * Returns actual cost data from agent_metrics (cost_usd field)
 */
export async function handleCostsSummary(request, env) {
  try {
    const url = new URL(request.url);
    const range = url.searchParams.get('range') || 'month';

    let cutoff;
    if (range === 'month') {
      // Start of current month
      const now = new Date();
      cutoff = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    } else {
      const days = range === '24h' ? 1 : range === '30d' ? 30 : 7;
      cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    }

    const result = await env.DB.prepare(`
      SELECT
        SUM(cost_usd) as total_cost,
        SUM(input_tokens) as total_input,
        SUM(output_tokens) as total_output,
        COUNT(*) as message_count,
        MIN(timestamp) as first_entry,
        MAX(timestamp) as last_entry
      FROM agent_metrics
      WHERE timestamp >= ?
    `).bind(cutoff).first();

    // Calculate days elapsed in period for projection
    const firstEntry = result?.first_entry ? new Date(result.first_entry) : new Date();
    const lastEntry = result?.last_entry ? new Date(result.last_entry) : new Date();
    const daysElapsed = Math.max(1, (lastEntry - firstEntry) / (1000 * 60 * 60 * 24));

    // Days remaining in month
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();
    const daysRemaining = daysInMonth - dayOfMonth;

    // Project to end of month
    const dailyRate = (result?.total_cost || 0) / daysElapsed;
    const projectedTotal = (result?.total_cost || 0) + (dailyRate * daysRemaining);

    return new Response(JSON.stringify({
      success: true,
      data: {
        total_cost: result?.total_cost || 0,
        total_input: result?.total_input || 0,
        total_output: result?.total_output || 0,
        message_count: result?.message_count || 0,
        days_elapsed: daysElapsed,
        daily_rate: dailyRate,
        projected_monthly: projectedTotal,
        days_remaining: daysRemaining,
      },
      range,
      cutoff,
    }), {
      headers: corsHeaders,
    });

  } catch (error) {
    console.error('Error getting costs summary:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}

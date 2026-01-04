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

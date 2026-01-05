/**
 * Logs API - Unified activity stream
 */

import { corsHeaders, errorResponse } from '../utils/cors';

/**
 * GET /api/logs - Fetch logs with filters and pagination
 */
export async function handleGetLogs(request, env) {
  const url = new URL(request.url);

  // Parse query params
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const project = url.searchParams.get('project');
  const agent = url.searchParams.get('agent');
  const eventType = url.searchParams.get('type');
  const sessionId = url.searchParams.get('session');
  const since = url.searchParams.get('since');
  const until = url.searchParams.get('until');
  const search = url.searchParams.get('search');
  const groupBy = url.searchParams.get('group'); // flat, session, project, hour

  // Build WHERE clause
  const conditions = [];
  const params = [];

  if (project) {
    conditions.push('project = ?');
    params.push(project);
  }

  if (agent) {
    conditions.push('agent_id = ?');
    params.push(agent);
  }

  if (eventType) {
    conditions.push('event_type = ?');
    params.push(eventType);
  }

  if (sessionId) {
    conditions.push('session_id = ?');
    params.push(sessionId);
  }

  if (since) {
    conditions.push('timestamp >= ?');
    params.push(since);
  }

  if (until) {
    conditions.push('timestamp <= ?');
    params.push(until);
  }

  if (search) {
    conditions.push('summary LIKE ?');
    params.push(`%${search}%`);
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  try {
    // Get total count for pagination
    const countResult = await env.DB.prepare(
      `SELECT COUNT(*) as total FROM logs ${whereClause}`
    ).bind(...params).first();

    // Get logs
    const logsResult = await env.DB.prepare(
      `SELECT * FROM logs ${whereClause}
       ORDER BY timestamp DESC
       LIMIT ? OFFSET ?`
    ).bind(...params, limit, offset).all();

    // Get aggregates for the filtered set
    const aggregatesResult = await env.DB.prepare(
      `SELECT
         SUM(input_tokens) as total_input,
         SUM(output_tokens) as total_output,
         COUNT(*) as total_events,
         COUNT(DISTINCT project) as project_count,
         COUNT(DISTINCT agent_id) as agent_count
       FROM logs ${whereClause}`
    ).bind(...params).first();

    // Get distinct projects and agents for filter dropdowns
    const projectsResult = await env.DB.prepare(
      `SELECT DISTINCT project FROM logs WHERE project IS NOT NULL ORDER BY project`
    ).all();

    const agentsResult = await env.DB.prepare(
      `SELECT DISTINCT agent_id FROM logs WHERE agent_id IS NOT NULL ORDER BY agent_id`
    ).all();

    return new Response(JSON.stringify({
      success: true,
      data: {
        logs: logsResult.results || [],
        pagination: {
          total: countResult?.total || 0,
          limit,
          offset,
          has_more: offset + limit < (countResult?.total || 0),
        },
        aggregates: {
          total_input_tokens: aggregatesResult?.total_input || 0,
          total_output_tokens: aggregatesResult?.total_output || 0,
          total_tokens: (aggregatesResult?.total_input || 0) + (aggregatesResult?.total_output || 0),
          total_events: aggregatesResult?.total_events || 0,
          project_count: aggregatesResult?.project_count || 0,
          agent_count: aggregatesResult?.agent_count || 0,
        },
        filters: {
          projects: (projectsResult.results || []).map(r => r.project),
          agents: (agentsResult.results || []).map(r => r.agent_id),
        },
      },
    }), { headers: corsHeaders });

  } catch (error) {
    console.error('Logs fetch error:', error);
    return errorResponse(error.message);
  }
}

/**
 * POST /api/logs - Add a log entry
 */
export async function handlePostLog(request, env) {
  try {
    const body = await request.json();

    const {
      event_type,
      agent_id,
      project,
      session_id,
      input_tokens = 0,
      output_tokens = 0,
      summary,
      model,
      duration_ms = 0,
      metadata,
      timestamp = new Date().toISOString(),
    } = body;

    if (!event_type) {
      return new Response(JSON.stringify({
        success: false,
        error: 'event_type is required',
      }), { status: 400, headers: corsHeaders });
    }

    // Truncate summary to 200 chars
    const truncatedSummary = summary ? summary.slice(0, 200) : null;

    // Stringify metadata if object
    const metadataStr = metadata ? JSON.stringify(metadata) : null;

    await env.DB.prepare(
      `INSERT INTO logs (timestamp, event_type, agent_id, project, session_id,
                         input_tokens, output_tokens, summary, model, duration_ms, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      timestamp,
      event_type,
      agent_id || null,
      project || null,
      session_id || null,
      input_tokens,
      output_tokens,
      truncatedSummary,
      model || null,
      duration_ms,
      metadataStr
    ).run();

    return new Response(JSON.stringify({
      success: true,
      message: 'Log entry created',
    }), { headers: corsHeaders });

  } catch (error) {
    console.error('Log create error:', error);
    return errorResponse(error.message);
  }
}

/**
 * Prune old logs (called by cron)
 */
export async function pruneLogs(env, daysToKeep = 7) {
  try {
    const result = await env.DB.prepare(
      `DELETE FROM logs WHERE timestamp < datetime('now', '-' || ? || ' days')`
    ).bind(daysToKeep).run();

    console.log(`Pruned ${result.changes || 0} old log entries`);
    return result.changes || 0;
  } catch (error) {
    console.error('Log prune error:', error);
    return 0;
  }
}

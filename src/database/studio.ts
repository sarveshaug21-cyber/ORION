/**
 * ORION Database Studio
 * Simple CLI for inspecting database contents
 */

import { db, stmt } from './client.js';

function printTable(headers: string[], rows: string[][]): void {
  const colWidths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]?.length || 0)));
  const separator = '+-' + colWidths.map((w) => '-'.repeat(w)).join('-+-') + '-+';
  const headerRow = '| ' + headers.map((h, i) => h.padEnd(colWidths[i])).join(' | ') + ' |';
  console.log(separator);
  console.log(headerRow);
  console.log(separator);
  for (const row of rows) {
    console.log('| ' + row.map((c, i) => c.padEnd(colWidths[i])).join(' | ') + ' |');
  }
  console.log(separator);
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + '...';
}

async function listSessions(): Promise<void> {
  const sessions = db.prepare(`SELECT * FROM sessions ORDER BY updated_at DESC`).all() as any[];
  if (sessions.length === 0) {
    console.log('No sessions found');
    return;
  }
  printTable(
    ['ID', 'User', 'Created', 'Updated', 'Working Dir', 'Active Conv'],
    sessions.map((s) => [
      truncate(s.id, 20),
      s.user_id,
      new Date(s.created_at).toLocaleString(),
      new Date(s.updated_at).toLocaleString(),
      truncate(s.working_directory, 30),
      s.active_conversation_id ? truncate(s.active_conversation_id, 20) : 'none',
    ])
  );
}

async function listConversations(sessionId?: string): Promise<void> {
  let query = `SELECT * FROM conversations`;
  const params: any[] = [];
  if (sessionId) {
    query += ` WHERE session_id = ?`;
    params.push(sessionId);
  }
  query += ` ORDER BY updated_at DESC`;
  const conversations = db.prepare(query).all(...params) as any[];
  if (conversations.length === 0) {
    console.log('No conversations found');
    return;
  }
  printTable(
    ['ID', 'Session', 'Title', 'Created', 'Updated', 'Messages'],
    conversations.map((c) => [
      truncate(c.id, 20),
      truncate(c.session_id, 20),
      truncate(c.title, 40),
      new Date(c.created_at).toLocaleString(),
      new Date(c.updated_at).toLocaleString(),
      c.message_count.toString(),
    ])
  );
}

async function listMessages(conversationId: string): Promise<void> {
  const messages = stmt.getMessages.all(conversationId, 100) as any[];
  if (messages.length === 0) {
    console.log('No messages found');
    return;
  }
  printTable(
    ['ID', 'Role', 'Content', 'Created'],
    messages.map((m) => [
      truncate(m.id, 20),
      m.role,
      truncate(m.content.replace(/\n/g, ' '), 80),
      new Date(m.created_at).toLocaleString(),
    ])
  );
}

async function listMemories(type: 'long' | 'short', sessionId?: string): Promise<void> {
  let memories: any[];
  if (type === 'long') {
    memories = stmt.getAllMemories.all() as any[];
  } else {
    if (!sessionId) {
      console.error('Session ID required for short-term memories');
      return;
    }
    memories = stmt.getShortTermMemories.all(sessionId, 100) as any[];
  }
  if (memories.length === 0) {
    console.log(`No ${type}-term memories found`);
    return;
  }
  printTable(
    ['ID', 'Category', 'Importance', 'Content', 'Tags', 'Created'],
    memories.map((m) => [
      truncate(m.id, 20),
      m.category,
      m.importance.toString(),
      truncate(m.content.replace(/\n/g, ' '), 60),
      JSON.parse(m.tags || '[]').join(', '),
      new Date(m.created_at).toLocaleString(),
    ])
  );
}

async function listSkills(): Promise<void> {
  const skills = stmt.getAllSkills.all() as any[];
  if (skills.length === 0) {
    console.log('No skills found');
    return;
  }
  printTable(
    ['Name', 'Version', 'Description', 'Enabled', 'Loaded'],
    skills.map((s) => [
      s.name,
      s.version,
      truncate(s.description, 50),
      s.enabled ? 'Yes' : 'No',
      s.loaded_at ? new Date(s.loaded_at).toLocaleString() : 'Never',
    ])
  );
}

async function listToolCalls(sessionId: string): Promise<void> {
  const calls = stmt.getToolCallsBySession.all(sessionId, 50) as any[];
  if (calls.length === 0) {
    console.log('No tool calls found');
    return;
  }
  printTable(
    ['ID', 'Tool', 'Status', 'Started', 'Completed', 'Permission'],
    calls.map((c) => [
      truncate(c.id, 20),
      c.tool_name,
      c.status,
      new Date(c.started_at).toLocaleString(),
      c.completed_at ? new Date(c.completed_at).toLocaleString() : 'pending',
      c.permission_requested ? 'Yes' : 'No',
    ])
  );
}

async function listActivities(sessionId: string): Promise<void> {
  const activities = stmt.getActivitiesBySession.all(sessionId, 50) as any[];
  if (activities.length === 0) {
    console.log('No activities found');
    return;
  }
  printTable(
    ['ID', 'Type', 'Message', 'Level', 'Time'],
    activities.map((a) => [
      truncate(a.id, 20),
      a.type,
      truncate(a.message, 60),
      a.level,
      new Date(a.timestamp).toLocaleString(),
    ])
  );
}

async function showSettings(): Promise<void> {
  const settings = stmt.getAllSettings.all() as any[];
  if (settings.length === 0) {
    console.log('No settings found');
    return;
  }
  printTable(
    ['Key', 'Value'],
    settings.map((s) => [s.key, truncate(s.value, 100)])
  );
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const arg = process.argv[3];

  console.log('ORION Database Studio\n');

  switch (command) {
    case 'sessions':
      await listSessions();
      break;
    case 'conversations':
      await listConversations(arg);
      break;
    case 'messages':
      if (!arg) {
        console.error('Conversation ID required');
        process.exit(1);
      }
      await listMessages(arg);
      break;
    case 'memories':
      await listMemories(arg as 'long' | 'short', process.argv[4]);
      break;
    case 'skills':
      await listSkills();
      break;
    case 'tools':
      if (!arg) {
        console.error('Session ID required');
        process.exit(1);
      }
      await listToolCalls(arg);
      break;
    case 'activities':
      if (!arg) {
        console.error('Session ID required');
        process.exit(1);
      }
      await listActivities(arg);
      break;
    case 'settings':
      await showSettings();
      break;
    default:
      console.log('Usage: npm run db:studio [command] [args...]');
      console.log('');
      console.log('Commands:');
      console.log('  sessions                    List all sessions');
      console.log('  conversations [sessionId]   List conversations (optionally filtered by session)');
      console.log('  messages <conversationId>   List messages in a conversation');
      console.log('  memories <long|short> [sessionId]  List memories (short-term needs sessionId)');
      console.log('  skills                      List all skills');
      console.log('  tools <sessionId>           List tool calls for a session');
      console.log('  activities <sessionId>      List activities for a session');
      console.log('  settings                    Show all settings');
      process.exit(1);
  }
}

main().catch(console.error);
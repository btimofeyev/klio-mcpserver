#!/usr/bin/env node

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import cors from 'cors';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PORT = process.env.PORT || 3000;

console.error('🚀 Starting MCP server with Claude.ai support...');

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

console.error('✅ Supabase client created');

const app = express();

// Sessions for SSE connections
const sseConnections = new Map<string, Response>();

// Basic middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control']
}));
app.use(express.json());

console.error('✅ Express middleware set up');

// Generate session ID
function generateSessionId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'ai-tutor-mcp-server',
    transport: 'HTTP/SSE MCP'
  });
});

// Homepage
app.get('/', (req: Request, res: Response) => {
  res.send(`
    <html>
      <head><title>AI Tutor MCP Server</title></head>
      <body>
        <h1>AI Tutor MCP Server</h1>
        <p>Status: Running with MCP Support</p>
        
        <h2>Endpoints:</h2>
        <ul>
          <li><a href="/health">GET /health</a> - Health check</li>
          <li><strong>GET /sse</strong> - MCP SSE connection</li>
          <li><strong>POST /messages</strong> - MCP JSON-RPC messages</li>
        </ul>

        <h2>For Claude.ai:</h2>
        <pre><code>{
  "mcp_servers": [{
    "type": "url",
    "url": "https://klio-mcpserver-production.up.railway.app/sse",
    "name": "ai-tutor"
  }]
}</code></pre>

        <h2>Tools Available:</h2>
        <ul>
          <li><strong>search_database</strong> - Search student educational data</li>
          <li><strong>get_material_content</strong> - Get material content</li>
        </ul>
      </body>
    </html>
  `);
});

// SSE endpoint for MCP
app.get('/sse', (req: Request, res: Response) => {
  console.error('🔌 SSE connection requested');
  
  const sessionId = generateSessionId();
  
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  // Store connection
  sseConnections.set(sessionId, res);

  // Send endpoint event (required by MCP spec)
  const messagesUrl = `/messages?sessionId=${sessionId}`;
  res.write(`event: endpoint\n`);
  res.write(`data: ${messagesUrl}\n\n`);

  console.error(`✅ SSE connection established: ${sessionId}`);

  // Handle disconnect
  req.on('close', () => {
    sseConnections.delete(sessionId);
    console.error(`❌ SSE connection closed: ${sessionId}`);
  });

  req.on('error', () => {
    sseConnections.delete(sessionId);
    console.error(`❌ SSE connection error: ${sessionId}`);
  });
});

// MCP Messages endpoint
app.post('/messages', async (req: Request, res: Response) => {
  try {
    const sessionId = req.query.sessionId as string;
    const message = req.body;

    console.error(`📨 Received message for session ${sessionId}:`, JSON.stringify(message, null, 2));

    if (!sessionId || !sseConnections.has(sessionId)) {
      console.error(`❌ Invalid session: ${sessionId}`);
      res.status(400).json({ error: 'Invalid session' });
      return;
    }

    // Handle MCP JSON-RPC message
    const response = await handleMCPMessage(message);
    
    if (response) {
      console.error(`📤 Sending response:`, JSON.stringify(response, null, 2));
      res.json(response);
    } else {
      res.status(204).end();
    }

  } catch (error: any) {
    console.error('❌ Error handling message:', error);
    res.status(500).json({
      jsonrpc: '2.0',
      id: req.body?.id || null,
      error: {
        code: -32603,
        message: 'Internal error',
        data: error.message
      }
    });
  }
});

// Handle MCP JSON-RPC messages
async function handleMCPMessage(message: any): Promise<any | null> {
  const { method, id, params } = message;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id: id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'ai-tutor-mcp-server',
            version: '1.0.0'
          }
        }
      };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id: id,
        result: {
          tools: [
            {
              name: 'search_database',
              description: 'Search for student educational data including assignments, grades, and progress',
              inputSchema: {
                type: 'object',
                properties: {
                  child_id: {
                    type: 'string',
                    description: 'UUID of the student'
                  },
                  query: {
                    type: 'string',
                    description: 'Search query (optional)'
                  },
                  search_type: {
                    type: 'string',
                    enum: ['assignments', 'grades', 'subjects', 'overdue', 'recent', 'all'],
                    description: 'Type of search to perform',
                    default: 'all'
                  }
                },
                required: ['child_id']
              }
            },
            {
              name: 'get_material_content',
              description: 'Get detailed content for a specific educational material',
              inputSchema: {
                type: 'object',
                properties: {
                  child_id: {
                    type: 'string',
                    description: 'UUID of the student'
                  },
                  material_identifier: {
                    type: 'string',
                    description: 'Material title, ID, or identifier'
                  }
                },
                required: ['child_id', 'material_identifier']
              }
            }
          ]
        }
      };

    case 'tools/call':
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};

      console.error(`🔧 Calling tool: ${toolName}`, toolArgs);

      if (toolName === 'search_database') {
        const result = await searchDatabase(
          toolArgs.child_id,
          toolArgs.query || '',
          toolArgs.search_type || 'all'
        );
        
        return {
          jsonrpc: '2.0',
          id: id,
          result: {
            content: [{
              type: 'text',
              text: result
            }]
          }
        };
      }

      if (toolName === 'get_material_content') {
        const result = await getMaterialContent(
          toolArgs.child_id,
          toolArgs.material_identifier
        );
        
        return {
          jsonrpc: '2.0',
          id: id,
          result: {
            content: [{
              type: 'text',
              text: result
            }]
          }
        };
      }

      return {
        jsonrpc: '2.0',
        id: id,
        error: {
          code: -32601,
          message: `Unknown tool: ${toolName}`
        }
      };

    case 'initialized':
      // Notification, no response needed
      console.error('✅ MCP client initialized');
      return null;

    default:
      return {
        jsonrpc: '2.0',
        id: id,
        error: {
          code: -32601,
          message: `Unknown method: ${method}`
        }
      };
  }
}

// Search database function
async function searchDatabase(childId: string, query: string, searchType: string): Promise<string> {
  try {
    console.error(`🔍 Searching database: childId=${childId}, query="${query}", type=${searchType}`);

    // Get child's subjects
    const { data: childSubjects, error: subjectsError } = await supabase
      .from('child_subjects')
      .select('id, subject:subject_id(name), custom_subject_name_override')
      .eq('child_id', childId);

    if (subjectsError) {
      return `Error: Failed to get child subjects: ${subjectsError.message}`;
    }

    if (!childSubjects || childSubjects.length === 0) {
      return 'No subjects assigned to this student. Please check the student ID.';
    }

    const childSubjectIds = childSubjects.map(cs => cs.id);
    let results = [];

    // Search based on type
    if (searchType === 'overdue' || searchType === 'all') {
      const overdue = await findOverdueMaterials(childSubjectIds);
      if (overdue.length > 0) {
        results.push(`🚨 **${overdue.length} Overdue Assignments:**`);
        overdue.forEach((item: any) => {
          results.push(`- ${item.title} - Due: ${item.due_date}`);
        });
      }
    }

    if (searchType === 'grades' || searchType === 'all') {
      const graded = await findGradedMaterials(childSubjectIds);
      if (graded.length > 0) {
        results.push(`\n📊 **Recent Grades:**`);
        graded.forEach((item: any) => {
          const percentage = Math.round((item.grade_value / item.grade_max_value) * 100);
          results.push(`- ${item.title} - ${item.grade_value}/${item.grade_max_value} (${percentage}%)`);
        });
      }
    }

    if (searchType === 'subjects' || searchType === 'all') {
      results.push(`\n🎓 **Enrolled Subjects:**`);
      childSubjects.forEach((subject: any) => {
        const name = subject.subject?.name || subject.custom_subject_name_override || 'Unknown Subject';
        results.push(`- ${name}`);
      });
    }

    return results.length > 0 ? results.join('\n') : 'No results found.';

  } catch (error: any) {
    return `Error searching database: ${error.message}`;
  }
}

// Find overdue materials
async function findOverdueMaterials(childSubjectIds: string[]) {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const { data, error } = await supabase
      .from('materials')
      .select('id, title, due_date, completed_at')
      .in('child_subject_id', childSubjectIds)
      .lt('due_date', today)
      .is('completed_at', null)
      .order('due_date', { ascending: true })
      .limit(10);

    return data || [];
  } catch (error) {
    return [];
  }
}

// Find graded materials
async function findGradedMaterials(childSubjectIds: string[]) {
  try {
    const { data, error } = await supabase
      .from('materials')
      .select('id, title, grade_value, grade_max_value, completed_at')
      .in('child_subject_id', childSubjectIds)
      .not('grade_value', 'is', null)
      .not('grade_max_value', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(10);

    return data || [];
  } catch (error) {
    return [];
  }
}

// Get material content
async function getMaterialContent(childId: string, materialIdentifier: string): Promise<string> {
  return `Material content for "${materialIdentifier}" is not yet implemented. This feature will provide detailed content for specific educational materials.`;
}

// Start server
app.listen(PORT, () => {
  console.error(`🌐 MCP server running on port ${PORT}`);
  console.error(`🔗 SSE endpoint: https://klio-mcpserver-production.up.railway.app/sse`);
  console.error(`✅ Ready for Claude.ai MCP connector!`);
}).on('error', (err) => {
  console.error('❌ Server error:', err);
  process.exit(1);
});

// Error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});
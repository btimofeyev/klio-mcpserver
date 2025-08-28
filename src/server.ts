/**
 * Educational Materials MCP Server for OpenAI ChatGPT Integration
 * 
 * This MCP server provides OpenAI-compliant 'search' and 'fetch' tools
 * for accessing educational materials from a PostgreSQL database.
 * Designed to work with ChatGPT connectors and deep research.
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import { randomUUID } from "node:crypto";
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { InMemoryEventStore } from '@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js';

dotenv.config();

// PostgreSQL Configuration
const DATABASE_URL = process.env.DATABASE_URL || (
  process.env.SUPABASE_URL 
    ? `postgresql://postgres:${process.env.SUPABASE_SERVICE_ROLE_KEY}@${process.env.SUPABASE_URL.split('//')[1]}/postgres`
    : undefined
);
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL is required');
  process.exit(1);
}

// Initialize PostgreSQL connection pool
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false } // For hosted databases
});

// ===============================
// HELPER FUNCTIONS
// ===============================

interface SearchResult {
  id: string;
  title: string;
  url: string;
}

interface FetchResult {
  id: string;
  title: string;
  text: string;
  url: string;
  metadata?: any;
}

/**
 * Parse query to extract child_id and search terms
 */
function parseQuery(query: string): { childId: string; searchTerm: string } {
  const defaultChildId = '058a3da2-0268-4d8c-995a-c732cd1b732a'; // Fallback
  
  if (query.startsWith('child_id:')) {
    const parts = query.split(' ');
    const childId = parts[0].replace('child_id:', '');
    const searchTerm = parts.slice(1).join(' ');
    return { childId, searchTerm };
  }
  
  return { childId: defaultChildId, searchTerm: query };
}

/**
 * Get child subject IDs for a given child
 */
async function getChildSubjects(childId: string): Promise<string[]> {
  console.log('🆔 getChildSubjects called with child_id:', childId);
  
  const result = await pool.query(
    'SELECT id FROM child_subjects WHERE child_id = $1',
    [childId]
  );
  
  const childSubjectIds = result.rows.map((row: any) => row.id);
  console.log('📊 Found', childSubjectIds.length, 'child_subjects for child_id:', childId);
  
  if (childSubjectIds.length === 0) {
    console.warn('⚠️ No child_subjects found for child_id:', childId);
  }
  
  return childSubjectIds;
}

/**
 * Format complete educational content for a material
 */
function formatEducationalContent(material: any): string {
  const sections: string[] = [];
  
  // Basic info
  sections.push(`📚 **${material.title}**`);
  sections.push(`Type: ${material.content_type}`);
  
  if (material.due_date) {
    sections.push(`Due Date: ${material.due_date}`);
  }
  
  if (material.completed_at) {
    const gradeInfo = material.grade_value && material.grade_max_value 
      ? ` (Grade: ${material.grade_value}/${material.grade_max_value})`
      : '';
    sections.push(`✅ Completed: ${material.completed_at}${gradeInfo}`);
  } else {
    sections.push('📋 Status: Incomplete');
  }
  
  sections.push('');
  
  // Parse lesson_json for educational content
  if (material.lesson_json) {
    try {
      const lessonData = typeof material.lesson_json === 'string' 
        ? JSON.parse(material.lesson_json) 
        : material.lesson_json;
      
      // Learning objectives
      if (lessonData.learning_objectives && lessonData.learning_objectives.length > 0) {
        sections.push('🎯 **LEARNING OBJECTIVES:**');
        lessonData.learning_objectives.forEach((obj: string) => sections.push(`• ${obj}`));
        sections.push('');
      }
      
      // Main content
      if (lessonData.main_content_summary_or_extract) {
        sections.push('📖 **CONTENT:**');
        sections.push(lessonData.main_content_summary_or_extract);
        sections.push('');
      }
      
      // Questions and tasks
      if (lessonData.tasks_or_questions && lessonData.tasks_or_questions.length > 0) {
        sections.push('❓ **QUESTIONS/TASKS:**');
        lessonData.tasks_or_questions.forEach((task: string, index: number) => {
          sections.push(`${index + 1}. ${task}`);
        });
        sections.push('');
      }
      
      // Worksheet questions
      if (lessonData.worksheet_questions && lessonData.worksheet_questions.length > 0) {
        sections.push('📝 **WORKSHEET QUESTIONS:**');
        lessonData.worksheet_questions.forEach((question: string, index: number) => {
          sections.push(`${index + 1}. ${question}`);
        });
        sections.push('');
      }
      
      // Answer key (if available)
      if (lessonData.answer_key) {
        sections.push('🔑 **ANSWER KEY:**');
        Object.entries(lessonData.answer_key).forEach(([key, value]) => {
          sections.push(`${key}: ${value}`);
        });
        sections.push('');
      }
      
      // Key topics
      if (lessonData.subject_keywords_or_subtopics && lessonData.subject_keywords_or_subtopics.length > 0) {
        sections.push(`🔑 **KEY TOPICS:** ${lessonData.subject_keywords_or_subtopics.slice(0, 5).join(', ')}`);
        sections.push('');
      }
      
    } catch (e) {
      console.warn('Failed to parse lesson_json for material:', material.id);
    }
  }
  
  // Teacher grading notes
  if (material.grading_notes) {
    sections.push(`📝 **TEACHER NOTES:** ${material.grading_notes}`);
    sections.push('');
  }
  
  return sections.join('\n');
}

// ===============================
// MCP SERVER WITH OPENAI-COMPLIANT TOOLS
// ===============================

function createMcpServer(): McpServer {
  const mcpServer = new McpServer({
    name: 'educational-materials-server',
    version: '1.0.0',
  }, {
    capabilities: {
      tools: {},
    },
    instructions: 'Educational Materials MCP Server providing search and retrieval of student assignments, lessons, and educational content for AI tutoring support.'
  });

  // ===============================
  // SEARCH TOOL (OpenAI Required)
  // ===============================
  mcpServer.tool(
    'search',
    'Search for educational materials including assignments, lessons, worksheets, quizzes, and tests',
    {
      query: z.string().describe('Search query - use format "child_id:UUID search terms" or just search terms')
    },
    async ({ query }) => {
      try {
        console.log('🔍 Search tool called with query:', query);
        
        const { childId, searchTerm } = parseQuery(query);
        console.log('🆔 Parsed child_id:', childId, 'search_term:', searchTerm);
        
        const childSubjectIds = await getChildSubjects(childId);
        
        if (childSubjectIds.length === 0) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ results: [] })
            }]
          };
        }
        
        // Build the SQL query using direct PostgreSQL
        let sqlQuery = `
          SELECT id, title, content_type, due_date, completed_at, grade_value, grade_max_value
          FROM materials 
          WHERE child_subject_id = ANY($1::uuid[])
          AND content_type IN ('assignment', 'worksheet', 'quiz', 'test', 'review', 'lesson', 'reading', 'chapter')
        `;
        
        const params: any[] = [childSubjectIds];
        
        // Add search term filter if provided
        if (searchTerm.trim()) {
          sqlQuery += ` AND title ILIKE $2`;
          params.push(`%${searchTerm}%`);
        }
        
        sqlQuery += ` ORDER BY 
          CASE WHEN completed_at IS NULL THEN 0 ELSE 1 END,
          due_date ASC NULLS LAST,
          title ASC
          LIMIT 20
        `;
        
        console.log('📊 Executing SQL query with', childSubjectIds.length, 'child_subject_ids');
        const result = await pool.query(sqlQuery, params);
        
        console.log('✅ Query returned', result.rows.length, 'materials');
        
        // Format results exactly as OpenAI expects
        const results: SearchResult[] = result.rows.map((row: any) => ({
          id: row.id,
          title: row.title,
          url: `internal://materials/${row.id}`
        }));
        
        // Return in exact OpenAI format
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ results })
          }]
        };
        
      } catch (error: any) {
        console.error('❌ Search error:', error);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ 
              results: [],
              error: error.message 
            })
          }]
        };
      }
    }
  );

  // ===============================
  // FETCH TOOL (OpenAI Required)
  // ===============================
  mcpServer.tool(
    'fetch',
    'Retrieve complete details and content for a specific educational material',
    {
      id: z.string().describe('Material ID to fetch complete content for')
    },
    async ({ id }) => {
      try {
        console.log('📚 Fetch tool called with id:', id);
        
        // Handle child_id prefix if present
        let materialId = id;
        let childId = '058a3da2-0268-4d8c-995a-c732cd1b732a'; // default
        
        if (id.startsWith('child_id:')) {
          const parts = id.split('|');
          childId = parts[0].replace('child_id:', '');
          materialId = parts[1] || id;
        }
        
        const childSubjectIds = await getChildSubjects(childId);
        
        // Get complete material details
        const sqlQuery = `
          SELECT 
            id, title, content_type, due_date, completed_at,
            grade_value, grade_max_value, grading_notes, lesson_json,
            parent_material_id, is_primary_lesson
          FROM materials
          WHERE id = $1 AND child_subject_id = ANY($2::uuid[])
          LIMIT 1
        `;
        
        const result = await pool.query(sqlQuery, [materialId, childSubjectIds]);
        
        if (result.rows.length === 0) {
          console.warn('⚠️ Material not found:', materialId);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                id: materialId,
                title: 'Not Found',
                text: `Educational material with ID "${materialId}" not found.`,
                url: `internal://materials/${materialId}`,
                metadata: { error: 'Material not found' }
              })
            }]
          };
        }
        
        const material = result.rows[0];
        console.log('✅ Found material:', material.title);
        
        // Format complete educational content
        const fullContent = formatEducationalContent(material);
        
        // Create metadata
        const metadata: any = {
          content_type: material.content_type,
          due_date: material.due_date,
          completed: !!material.completed_at,
          grade_available: !!(material.grade_value && material.grade_max_value)
        };
        
        if (material.completed_at) {
          metadata.completed_date = material.completed_at;
          if (material.grade_value && material.grade_max_value) {
            metadata.grade_percentage = Math.round((parseFloat(material.grade_value) / parseFloat(material.grade_max_value)) * 100);
          }
        }
        
        // Return in exact OpenAI format
        const fetchResult: FetchResult = {
          id: material.id,
          title: material.title,
          text: fullContent,
          url: `internal://materials/${material.id}`,
          metadata
        };
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(fetchResult)
          }]
        };
        
      } catch (error: any) {
        console.error('❌ Fetch error:', error);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              id: id,
              title: 'Error',
              text: `Error retrieving material: ${error.message}`,
              url: `internal://materials/${id}`,
              metadata: { error: error.message }
            })
          }]
        };
      }
    }
  );

  return mcpServer;
}

// ===============================
// EXPRESS SERVER WITH DUAL TRANSPORT
// ===============================

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'mcp-session-id']
}));

app.use(express.json());

// Store transports by session ID
const transports: { [sessionId: string]: StreamableHTTPServerTransport | SSEServerTransport } = {};

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'educational-materials-mcp-server',
    protocol: 'MCP compliant'
  });
});

//=============================================================================
// STREAMABLE HTTP TRANSPORT (PROTOCOL VERSION 2025-03-26)
//=============================================================================

app.all('/mcp', async (req: Request, res: Response) => {
  console.log(`Received ${req.method} request to /mcp`);
  try {
    const sessionId = req.headers['mcp-session-id'] as string;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      const existingTransport = transports[sessionId];
      if (existingTransport instanceof StreamableHTTPServerTransport) {
        transport = existingTransport;
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: Session exists but uses a different transport protocol',
          },
          id: null,
        });
        return;
      }
    } else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
      const eventStore = new InMemoryEventStore();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        eventStore,
        onsessioninitialized: (sessionId: string) => {
          console.log(`StreamableHTTP session initialized with ID: ${sessionId}`);
          transports[sessionId] = transport;
        }
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          console.log(`Transport closed for session ${sid}`);
          delete transports[sid];
        }
      };

      const mcpServer = createMcpServer();
      await mcpServer.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

//=============================================================================
// HTTP+SSE TRANSPORT (PROTOCOL VERSION 2024-11-05) - DEPRECATED BUT SUPPORTED
//=============================================================================

app.get('/sse', async (req: Request, res: Response) => {
  console.log('Received GET request to /sse (deprecated SSE transport)');
  const transport = new SSEServerTransport('/messages', res);
  transports[transport.sessionId] = transport;

  res.on("close", () => {
    delete transports[transport.sessionId];
  });

  const mcpServer = createMcpServer();
  await mcpServer.connect(transport);
});

app.post("/messages", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  
  const existingTransport = transports[sessionId];
  if (existingTransport instanceof SSEServerTransport) {
    await existingTransport.handlePostMessage(req, res, req.body);
  } else if (existingTransport) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Bad Request: Session exists but uses a different transport protocol',
      },
      id: null,
    });
    return;
  } else {
    res.status(400).send('No transport found for sessionId');
  }
});

// Start the server with database connection test
async function startServer() {
  try {
    console.log('🔄 Starting Educational Materials MCP Server...');
    console.log('📊 Testing database connection...');
    
    // Test PostgreSQL connection
    const testResult = await pool.query('SELECT 1 as test');
    console.log('✅ PostgreSQL connection successful');
    
    // Test materials table access
    const materialsTest = await pool.query('SELECT COUNT(*) as count FROM materials LIMIT 1');
    console.log('✅ Materials table accessible, total count available');
    
    console.log('🔧 Database URL configured');
    
    // Start the Express server
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Educational Materials MCP server running on port ${PORT}`);
      console.log(`📡 OpenAI ChatGPT compatible MCP server`);
      console.log(`🔍 Implements search and fetch tools as required by OpenAI`);
      console.log(`
==============================================
OPENAI CHATGPT INTEGRATION:

1. Streamable HTTP (Recommended for OpenAI)
   Endpoint: /mcp
   Methods: GET, POST, DELETE
   
2. Server-Sent Events (Legacy)
   Endpoint: /sse
   
3. Health Check: GET /health

Tools Available:
- search: Find educational materials
- fetch: Get complete material details
==============================================
      `);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Handle server shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  
  for (const sessionId in transports) {
    try {
      console.log(`Closing transport for session ${sessionId}`);
      await transports[sessionId].close();
      delete transports[sessionId];
    } catch (error) {
      console.error(`Error closing transport for session ${sessionId}:`, error);
    }
  }
  
  await pool.end();
  console.log('Server shutdown complete');
  process.exit(0);
});

// Start the server
startServer();
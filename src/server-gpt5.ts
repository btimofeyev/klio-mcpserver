/**
 * Enhanced Educational Materials MCP Server for GPT-5 Integration
 * 
 * Optimized MCP server with intelligent query parsing, enhanced search,
 * and improved educational content formatting for AI tutoring support.
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

// Import our enhanced services
import { SearchService } from './services/searchService.js';
import { QueryParser } from './utils/queryParser.js';
import { ContentFormatter } from './utils/formatter.js';

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
  ssl: { rejectUnauthorized: false }
});

// Initialize enhanced search service
const searchService = new SearchService(pool);

// ===============================
// ENHANCED MCP SERVER
// ===============================

function createEnhancedMcpServer(): McpServer {
  const mcpServer = new McpServer({
    name: 'klio-ai-tutor-gpt5',
    version: '2.0.0',
  }, {
    capabilities: {
      tools: {},
    },
    instructions: `
Enhanced AI Tutor MCP Server with intelligent educational material search and retrieval.

CAPABILITIES:
- Natural language query understanding for educational intent
- Smart search across lessons, assignments, worksheets, quizzes, and tests  
- Urgency detection and prioritization (overdue, due soon)
- Comprehensive educational content formatting
- Grade-based filtering and low-score identification
- Subject-specific material organization

QUERY EXAMPLES:
- "what's my homework" → finds incomplete assignments
- "overdue math worksheets" → finds overdue math materials
- "help with colonial america lesson" → finds relevant lesson content
- "review my low grades" → finds completed work with scores < 75%
- "due tomorrow" → finds materials due in next 24 hours

The server intelligently routes queries to appropriate content types and applies educational prioritization for optimal AI tutoring support.
    `.trim()
  });

  // ===============================
  // ENHANCED SEARCH TOOL
  // ===============================
  mcpServer.tool(
    'search',
    'Intelligent search for educational materials with natural language understanding and educational prioritization',
    {
      query: z.string().describe(`
        Search query with natural language support. Examples:
        - "what's my homework" (finds incomplete assignments)
        - "overdue math" (finds overdue math materials)
        - "colonial america lesson" (finds specific lesson content)  
        - "review low scores" (finds completed work with grades < 75%)
        - "due tomorrow" (finds materials due soon)
        
        Format: "child_id:UUID search terms" or just "search terms"
        The system will intelligently parse intent and apply appropriate filters.
      `)
    },
    async ({ query }) => {
      try {
        console.log('🔍 Enhanced search called with query:', query);
        
        // Parse query with intelligent extraction
        const parsed = QueryParser.parseQuery(query);
        const { childId, searchTerm } = parsed;
        
        console.log(`🆔 Child ID: ${childId}`);
        console.log(`🧠 Intent: ${QueryParser.describeIntent(parsed.intent)}`);
        
        // Execute intelligent search
        const results = await searchService.intelligentSearch(childId, searchTerm);
        
        console.log(`✅ Returning ${results.length} intelligent search results`);
        
        // Return in exact GPT-5 format
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ results })
          }]
        };
        
      } catch (error: any) {
        console.error('❌ Enhanced search error:', error);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ 
              results: [],
              error: `Search failed: ${error.message}`,
              debug_info: {
                query,
                timestamp: new Date().toISOString()
              }
            })
          }]
        };
      }
    }
  );

  // ===============================
  // ENHANCED FETCH TOOL  
  // ===============================
  mcpServer.tool(
    'fetch',
    'Retrieve complete educational material with enhanced formatting and tutoring context',
    {
      id: z.string().describe(`
        Material ID to fetch complete educational content.
        
        Returns structured content optimized for AI tutoring including:
        - Learning objectives and key topics
        - Complete questions and answers
        - Grade information and teacher feedback
        - Urgency indicators and due dates
        - Related material suggestions
        
        Format: material UUID or "child_id:UUID|material_id"
      `)
    },
    async ({ id }) => {
      try {
        console.log('📚 Enhanced fetch called with id:', id);
        
        // Parse ID to extract child_id if present
        let materialId = id;
        let childId = '058a3da2-0268-4d8c-995a-c732cd1b732a'; // Default fallback
        
        if (id.startsWith('child_id:')) {
          const parts = id.split('|');
          childId = parts[0].replace('child_id:', '');
          materialId = parts[1] || id.replace(/^child_id:[^|]*\|?/, '');
        }
        
        console.log(`🆔 Fetching material ${materialId} for child ${childId}`);
        
        // Get material with enhanced service
        const material = await searchService.getMaterialById(childId, materialId);
        
        if (!material) {
          console.warn('⚠️ Material not found:', materialId);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                id: materialId,
                title: 'Educational Material Not Found',
                text: `The requested educational material with ID "${materialId}" could not be found or is not accessible for this student.`,
                url: ContentFormatter.generateMaterialUrl(materialId),
                metadata: { 
                  error: 'Material not found',
                  child_id: childId,
                  material_id: materialId
                }
              })
            }]
          };
        }
        
        console.log('✅ Found material:', material.title);
        
        // Format with enhanced educational content
        const formattedResult = ContentFormatter.formatEducationalContent(material);
        
        // Get related materials for additional context
        const relatedMaterials = await searchService.getRelatedMaterials(material);
        if (relatedMaterials.length > 0) {
          const relatedTitles = relatedMaterials.map(m => m.title).join(', ');
          formattedResult.metadata = {
            ...formattedResult.metadata,
            related_materials: relatedTitles,
            related_count: relatedMaterials.length
          };
        }
        
        console.log('📝 Enhanced content formatted successfully');
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(formattedResult)
          }]
        };
        
      } catch (error: any) {
        console.error('❌ Enhanced fetch error:', error);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              id: id,
              title: 'Content Retrieval Error',
              text: `Error retrieving educational material: ${error.message}\n\nPlease try again or contact support if the issue persists.`,
              url: ContentFormatter.generateMaterialUrl(id),
              metadata: { 
                error: error.message,
                error_type: error.constructor.name,
                timestamp: new Date().toISOString()
              }
            })
          }]
        };
      }
    }
  );

  return mcpServer;
}

// ===============================
// EXPRESS SERVER WITH ENHANCED TRANSPORT
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

// Enhanced health check endpoint
app.get('/health', async (req: Request, res: Response) => {
  let dbStatus = 'unknown';
  try {
    await pool.query('SELECT 1');
    dbStatus = 'connected';
  } catch (error) {
    dbStatus = 'disconnected';
  }

  res.json({ 
    status: 'healthy',
    version: '2.0.0-gpt5-enhanced',
    service: 'klio-ai-tutor-mcp-server',
    protocol: 'MCP compatible',
    database: dbStatus,
    features: [
      'intelligent-query-parsing',
      'educational-prioritization', 
      'enhanced-content-formatting',
      'natural-language-understanding'
    ],
    timestamp: new Date().toISOString()
  });
});

// Enhanced info endpoint
app.get('/info', (req: Request, res: Response) => {
  res.json({
    name: 'Klio AI Tutor MCP Server',
    version: '2.0.0',
    description: 'Enhanced MCP server with intelligent educational material search and AI tutoring optimization',
    capabilities: {
      tools: ['search', 'fetch'],
      features: {
        'intelligent-search': 'Natural language query understanding with educational intent detection',
        'smart-prioritization': 'Automated urgency detection and educational relevance ranking',
        'enhanced-formatting': 'Structured educational content with learning objectives and context',
        'grade-awareness': 'Grade-based filtering and low-score identification for targeted tutoring'
      }
    },
    transport: {
      protocols: ['streamable-http', 'sse'],
      endpoints: {
        'streamable-http': '/mcp',
        'sse': '/sse'
      }
    }
  });
});

//=============================================================================
// STREAMABLE HTTP TRANSPORT (PRIMARY FOR GPT-5)
//=============================================================================

app.all('/mcp', async (req: Request, res: Response) => {
  console.log(`📡 ${req.method} request to /mcp (Enhanced GPT-5 Transport)`);
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
            message: 'Session exists but uses different transport protocol',
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
          console.log(`🔗 Enhanced MCP session initialized: ${sessionId}`);
          transports[sessionId] = transport;
        }
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          console.log(`🔚 Enhanced session closed: ${sid}`);
          delete transports[sid];
        }
      };

      const mcpServer = createEnhancedMcpServer();
      await mcpServer.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'No valid session ID provided',
        },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('❌ Enhanced MCP request error:', error);
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
// SERVER-SENT EVENTS TRANSPORT (OPTIMIZED FOR GPT-5)
//=============================================================================

app.get('/sse', async (req: Request, res: Response) => {
  console.log('📡 SSE connection established (Enhanced GPT-5 Optimized)');
  const transport = new SSEServerTransport('/messages', res);
  transports[transport.sessionId] = transport;

  res.on("close", () => {
    console.log(`🔚 SSE connection closed: ${transport.sessionId}`);
    delete transports[transport.sessionId];
  });

  const mcpServer = createEnhancedMcpServer();
  await mcpServer.connect(transport);
});

app.post("/messages", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  console.log(`📨 Message received for session: ${sessionId}`);
  
  const existingTransport = transports[sessionId];
  if (existingTransport instanceof SSEServerTransport) {
    await existingTransport.handlePostMessage(req, res, req.body);
  } else if (existingTransport) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Session uses different transport protocol',
      },
      id: null,
    });
  } else {
    res.status(400).send('No transport found for session');
  }
});

// Start the enhanced server
async function startEnhancedServer() {
  try {
    console.log('🚀 Starting Enhanced Klio AI Tutor MCP Server for GPT-5...');
    
    // Start Express server first (non-blocking)
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`
🎓 KLIO AI TUTOR MCP SERVER v2.0 (GPT-5 ENHANCED)
════════════════════════════════════════════════

🌐 Server: http://0.0.0.0:${PORT}
🔗 Railway: https://klio-mcpserver-production.up.railway.app
📡 GPT-5 Endpoint: /sse/

🧠 ENHANCED FEATURES:
   • Natural language query understanding
   • Educational intent detection & prioritization  
   • Smart urgency filtering (overdue, due soon)
   • Enhanced content formatting for AI tutoring
   • Grade-based analysis and low-score identification

🛠️  ENDPOINTS:
   • GET  /health - Server health & feature status
   • GET  /info   - Detailed server information
   • GET  /sse    - GPT-5 optimized SSE transport
   • POST /messages - Message handling
   • ALL  /mcp    - Streamable HTTP transport

🎯 QUERY EXAMPLES:
   • "what's my homework" → incomplete assignments
   • "overdue math" → overdue math materials
   • "colonial america lesson" → specific lessons
   • "review low scores" → materials needing work

Ready for GPT-5 integration! 🚀
════════════════════════════════════════════════
      `);
    });

    // Test database connection in background (non-blocking)
    console.log('📊 Testing database connection in background...');
    setTimeout(async () => {
      try {
        const testResult = await pool.query('SELECT NOW() as current_time');
        console.log('✅ PostgreSQL connected:', testResult.rows[0].current_time);
        
        const materialsTest = await pool.query(`
          SELECT 
            COUNT(*) as total_materials,
            COUNT(CASE WHEN completed_at IS NULL THEN 1 END) as incomplete_materials,
            COUNT(CASE WHEN due_date < NOW() AND completed_at IS NULL THEN 1 END) as overdue_materials
          FROM materials 
          LIMIT 1
        `);
        
        const stats = materialsTest.rows[0];
        console.log('📊 Database stats:', {
          total: stats.total_materials,
          incomplete: stats.incomplete_materials, 
          overdue: stats.overdue_materials
        });
        console.log('🗄️  Database connection fully operational!');
      } catch (dbError: any) {
        console.error('⚠️  Database connection issue:', dbError.message);
        console.log('🔄 Server will continue running - database operations will be retried');
      }
    }, 2000); // Wait 2 seconds before testing DB
    
  } catch (error) {
    console.error('❌ Enhanced server startup failed:', error);
    process.exit(1);
  }
}

// Enhanced shutdown handling
process.on('SIGINT', async () => {
  console.log('🔄 Shutting down Enhanced Klio AI Tutor Server...');
  
  // Close all active transports
  for (const sessionId in transports) {
    try {
      console.log(`🔚 Closing session: ${sessionId}`);
      await transports[sessionId].close();
      delete transports[sessionId];
    } catch (error) {
      console.error(`❌ Error closing session ${sessionId}:`, error);
    }
  }
  
  // Close database connection
  await pool.end();
  console.log('✅ Enhanced server shutdown complete');
  process.exit(0);
});

// Start the enhanced server
startEnhancedServer();
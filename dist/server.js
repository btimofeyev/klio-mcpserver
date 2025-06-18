#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
dotenv.config();
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PORT = process.env.PORT || 3000;
console.error('🚀 Starting minimal MCP server...');
if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing environment variables');
    process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});
console.error('✅ Supabase client created');
const app = express();
// Basic middleware
app.use(cors());
app.use(express.json());
console.error('✅ Express middleware set up');
// Simple health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'ai-tutor-mcp-server-minimal'
    });
});
// Homepage
app.get('/', (req, res) => {
    res.send(`
    <html>
      <head><title>AI Tutor MCP Server</title></head>
      <body>
        <h1>AI Tutor MCP Server - Minimal Version</h1>
        <p>Status: Running</p>
        <p><a href="/health">Health Check</a></p>
        <p><a href="/sse">SSE Test</a></p>
      </body>
    </html>
  `);
});
// Simple SSE endpoint
app.get('/sse', (req, res) => {
    console.error('SSE endpoint hit');
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });
    // Send test event
    res.write('event: test\n');
    res.write('data: {"message": "SSE working"}\n\n');
    // Handle cleanup
    req.on('close', () => {
        console.error('SSE connection closed');
    });
});
// Basic MCP tools endpoint
app.get('/mcp/tools', (req, res) => {
    res.json({
        tools: [
            {
                name: 'search_database',
                description: 'Search student data',
                inputSchema: {
                    type: 'object',
                    properties: {
                        child_id: { type: 'string' },
                        query: { type: 'string' }
                    },
                    required: ['child_id']
                }
            }
        ]
    });
});
// Start server
app.listen(PORT, () => {
    console.error(`🌐 Server running on port ${PORT}`);
    console.error(`✅ Ready at https://klio-mcpserver-production.up.railway.app`);
}).on('error', (err) => {
    console.error('❌ Server error:', err);
    process.exit(1);
});
// Handle process errors
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});
//# sourceMappingURL=server.js.map
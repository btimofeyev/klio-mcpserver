#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
dotenv.config();
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PORT = process.env.PORT || 3000;
if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
}
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});
console.error('🔧 HTTP MCP Server initialized for Claude.ai integration');
class HTTPMCPServer {
    server;
    app;
    constructor() {
        this.server = new Server({
            name: 'ai-tutor-mcp-server',
            version: '1.3.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.app = express();
        this.setupExpress();
        this.setupMCPHandlers();
    }
    setupExpress() {
        this.app.use(cors());
        this.app.use(express.json());
        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                service: 'ai-tutor-mcp-server',
                transport: 'HTTP/SSE'
            });
        });
        // Homepage
        this.app.get('/', (req, res) => {
            res.send(`
        <html>
          <head><title>AI Tutor MCP Server</title></head>
          <body>
            <h1>AI Tutor MCP Server</h1>
            <p>Status: Running on Railway with HTTP MCP Transport</p>
            <p>This server supports Claude.ai's MCP connector feature.</p>
            <h2>Endpoints:</h2>
            <ul>
              <li><a href="/health">GET /health</a> - Health check</li>
              <li><strong>POST /api/search</strong> - Search database (HTTP API)</li>
              <li><strong>POST /api/material</strong> - Get material content (HTTP API)</li>
              <li><strong>MCP Tools</strong> - search_database, get_material_content (via MCP protocol)</li>
            </ul>
            <h2>Usage:</h2>
            <p><strong>MCP Integration:</strong> Use existing MCP client connections</p>
            <p><strong>HTTP API:</strong> POST to /api/search with JSON body</p>
          </body>
        </html>
      `);
        });
    }
    setupMCPHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: 'search_database',
                        description: 'Search for student educational data including assignments, grades, subjects, overdue items, and recent activity',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                child_id: {
                                    type: 'string',
                                    description: 'UUID of the student/child',
                                },
                                query: {
                                    type: 'string',
                                    description: 'Search query (optional for some search types)',
                                },
                                search_type: {
                                    type: 'string',
                                    enum: ['assignments', 'grades', 'subjects', 'overdue', 'recent', 'all'],
                                    description: 'Type of search to perform',
                                    default: 'all'
                                }
                            },
                            required: ['child_id'],
                        },
                    },
                    {
                        name: 'get_material_content',
                        description: 'Get complete content for a specific educational material',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                child_id: {
                                    type: 'string',
                                    description: 'UUID of the student/child',
                                },
                                material_identifier: {
                                    type: 'string',
                                    description: 'Material title, ID, or identifier',
                                }
                            },
                            required: ['child_id', 'material_identifier'],
                        },
                    }
                ],
            };
        });
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            if (!args) {
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify({ error: 'No arguments provided' }, null, 2)
                        }]
                };
            }
            if (name === 'search_database') {
                return await this.searchDatabase(args.child_id, args.query || '', args.search_type || 'all');
            }
            if (name === 'get_material_content') {
                return await this.getMaterialContent(args.child_id, args.material_identifier);
            }
            throw new Error(`Unknown tool: ${name}`);
        });
    }
    async searchDatabase(childId, query, searchType = 'all') {
        try {
            console.error(`🔍 MCP SEARCH: "${query}" (type: ${searchType}) for child: ${childId}`);
            // Get child's subjects
            const { data: childSubjects, error: subjectsError } = await supabase
                .from('child_subjects')
                .select('id, subject:subject_id(name), custom_subject_name_override')
                .eq('child_id', childId);
            if (subjectsError) {
                console.error('❌ Error getting child subjects:', subjectsError);
                return {
                    content: [{
                            type: 'text',
                            text: `Error: Failed to get child subjects: ${subjectsError.message}`
                        }]
                };
            }
            if (!childSubjects || childSubjects.length === 0) {
                return {
                    content: [{
                            type: 'text',
                            text: 'No subjects assigned to this student. Please check the student ID or contact an administrator.'
                        }]
                };
            }
            const childSubjectIds = childSubjects.map(cs => cs.id);
            let searchResults = {};
            // Perform searches based on type
            if (searchType === 'assignments' || searchType === 'all') {
                searchResults.assignments = await this.findAllMaterials(childSubjectIds, query);
            }
            if (searchType === 'overdue' || searchType === 'all') {
                searchResults.overdue = await this.findOverdueMaterials(childSubjectIds);
            }
            if (searchType === 'grades' || searchType === 'all') {
                searchResults.grades = await this.findGradedMaterials(childSubjectIds, query);
            }
            if (searchType === 'recent' || searchType === 'all') {
                searchResults.recent = await this.findRecentMaterials(childSubjectIds);
            }
            if (searchType === 'subjects') {
                searchResults.subjects = childSubjects;
            }
            // Format results for Claude
            const summary = this.generateSummary(searchResults, query);
            const detailedResults = this.formatResultsForClaude(searchResults, searchType);
            return {
                content: [{
                        type: 'text',
                        text: `${summary}\n\n${detailedResults}`
                    }]
            };
        }
        catch (error) {
            console.error(`❌ SEARCH ERROR:`, error);
            return {
                content: [{
                        type: 'text',
                        text: `Search failed: ${error.message}`
                    }]
            };
        }
    }
    async findAllMaterials(childSubjectIds, query) {
        try {
            let queryBuilder = supabase
                .from('materials')
                .select(`
          id, title, due_date, completed_at, grade_value, grade_max_value, content_type, status,
          lesson:lesson_id(
            id, title,
            unit:unit_id(
              id, name,
              child_subject:child_subject_id(
                id,
                subject:subject_id(name),
                custom_subject_name_override
              )
            )
          )
        `)
                .in('child_subject_id', childSubjectIds);
            if (query && query.trim() !== '') {
                queryBuilder = queryBuilder.or(`title.ilike.%${query}%,content_type.ilike.%${query}%`);
            }
            const { data, error } = await queryBuilder
                .order('created_at', { ascending: false })
                .limit(20);
            if (error) {
                console.error('❌ Error in findAllMaterials:', error);
                return [];
            }
            return data || [];
        }
        catch (error) {
            console.error('❌ Exception in findAllMaterials:', error);
            return [];
        }
    }
    async findOverdueMaterials(childSubjectIds) {
        try {
            const today = new Date().toISOString().split('T')[0];
            const { data, error } = await supabase
                .from('materials')
                .select(`
          id, title, due_date, completed_at, content_type, status,
          lesson:lesson_id(
            title,
            unit:unit_id(
              name,
              child_subject:child_subject_id(
                subject:subject_id(name),
                custom_subject_name_override
              )
            )
          )
        `)
                .in('child_subject_id', childSubjectIds)
                .lt('due_date', today)
                .is('completed_at', null)
                .order('due_date', { ascending: true });
            return data || [];
        }
        catch (error) {
            console.error('❌ Exception in findOverdueMaterials:', error);
            return [];
        }
    }
    async findGradedMaterials(childSubjectIds, query) {
        try {
            const { data, error } = await supabase
                .from('materials')
                .select(`
          id, title, grade_value, grade_max_value, completed_at, content_type,
          lesson:lesson_id(
            title,
            unit:unit_id(
              child_subject:child_subject_id(
                subject:subject_id(name),
                custom_subject_name_override
              )
            )
          )
        `)
                .in('child_subject_id', childSubjectIds)
                .not('grade_value', 'is', null)
                .not('grade_max_value', 'is', null)
                .order('completed_at', { ascending: false })
                .limit(15);
            return data || [];
        }
        catch (error) {
            console.error('❌ Exception in findGradedMaterials:', error);
            return [];
        }
    }
    async findRecentMaterials(childSubjectIds) {
        try {
            const threeDaysAgo = new Date();
            threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
            const threeDaysAgoString = threeDaysAgo.toISOString();
            const { data, error } = await supabase
                .from('materials')
                .select(`
          id, title, completed_at, grade_value, grade_max_value, content_type,
          lesson:lesson_id(
            title,
            unit:unit_id(
              child_subject:child_subject_id(
                subject:subject_id(name),
                custom_subject_name_override
              )
            )
          )
        `)
                .in('child_subject_id', childSubjectIds)
                .not('completed_at', 'is', null)
                .gte('completed_at', threeDaysAgoString)
                .order('completed_at', { ascending: false })
                .limit(10);
            return data || [];
        }
        catch (error) {
            console.error('❌ Exception in findRecentMaterials:', error);
            return [];
        }
    }
    async getMaterialContent(childId, materialIdentifier) {
        return {
            content: [{
                    type: 'text',
                    text: `Material content retrieval for "${materialIdentifier}" is not yet implemented. This feature will provide detailed content for specific educational materials.`
                }]
        };
    }
    generateSummary(searchResults, query) {
        const parts = [];
        if (searchResults.overdue?.length > 0) {
            parts.push(`🚨 ${searchResults.overdue.length} overdue assignments`);
        }
        if (searchResults.grades?.length > 0) {
            parts.push(`📊 ${searchResults.grades.length} graded assignments`);
        }
        if (searchResults.assignments?.length > 0) {
            parts.push(`📚 ${searchResults.assignments.length} assignments`);
        }
        if (searchResults.recent?.length > 0) {
            parts.push(`📅 ${searchResults.recent.length} recently completed items`);
        }
        if (searchResults.subjects?.length > 0) {
            parts.push(`🎓 ${searchResults.subjects.length} subjects`);
        }
        const summary = parts.length > 0 ? parts.join(', ') : `No results found for "${query}"`;
        return `**Search Results Summary:** ${summary}`;
    }
    formatResultsForClaude(searchResults, searchType) {
        let formatted = '';
        if (searchResults.overdue?.length > 0) {
            formatted += '\n## 🚨 Overdue Assignments\n';
            searchResults.overdue.forEach((item) => {
                const subject = item.lesson?.unit?.child_subject?.subject?.name ||
                    item.lesson?.unit?.child_subject?.custom_subject_name_override || 'Unknown Subject';
                formatted += `- **${item.title}** (${subject}) - Due: ${item.due_date}\n`;
            });
        }
        if (searchResults.grades?.length > 0) {
            formatted += '\n## 📊 Recent Grades\n';
            searchResults.grades.forEach((item) => {
                const subject = item.lesson?.unit?.child_subject?.subject?.name ||
                    item.lesson?.unit?.child_subject?.custom_subject_name_override || 'Unknown Subject';
                const score = `${item.grade_value}/${item.grade_max_value}`;
                const percentage = Math.round((item.grade_value / item.grade_max_value) * 100);
                formatted += `- **${item.title}** (${subject}) - Score: ${score} (${percentage}%)\n`;
            });
        }
        if (searchResults.assignments?.length > 0) {
            formatted += '\n## 📚 Assignments\n';
            searchResults.assignments.slice(0, 10).forEach((item) => {
                const subject = item.lesson?.unit?.child_subject?.subject?.name ||
                    item.lesson?.unit?.child_subject?.custom_subject_name_override || 'Unknown Subject';
                const status = item.completed_at ? '✅ Completed' : (item.due_date ? `📅 Due: ${item.due_date}` : '📝 In Progress');
                formatted += `- **${item.title}** (${subject}) - ${status}\n`;
            });
        }
        if (searchResults.recent?.length > 0) {
            formatted += '\n## 📅 Recently Completed\n';
            searchResults.recent.forEach((item) => {
                const subject = item.lesson?.unit?.child_subject?.subject?.name ||
                    item.lesson?.unit?.child_subject?.custom_subject_name_override || 'Unknown Subject';
                formatted += `- **${item.title}** (${subject}) - Completed: ${item.completed_at}\n`;
            });
        }
        if (searchResults.subjects?.length > 0) {
            formatted += '\n## 🎓 Enrolled Subjects\n';
            searchResults.subjects.forEach((subject) => {
                const name = subject.subject?.name || subject.custom_subject_name_override || 'Unknown Subject';
                formatted += `- ${name}\n`;
            });
        }
        return formatted || 'No detailed results to display.';
    }
    async run() {
        // Start HTTP server for health checks and basic functionality
        this.app.listen(PORT, () => {
            console.error(`🌐 HTTP server running on port ${PORT}`);
            console.error(`🔗 Server URL: https://klio-mcpserver-production.up.railway.app`);
            console.error(`✅ Ready for integration!`);
        });
        // For Railway deployment, we keep the MCP server ready but don't start stdio transport
        // The MCP functionality is preserved and ready for local connections
        console.error('🔧 MCP Server initialized and ready');
    }
}
const server = new HTTPMCPServer();
server.run().catch(console.error);
//# sourceMappingURL=server.js.map
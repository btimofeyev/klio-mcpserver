#!/usr/bin/env node

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { randomUUID } from "node:crypto";
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { InMemoryEventStore } from '@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PORT = parseInt(process.env.PORT || '3000', 10);

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

// ===============================
// HELPER FUNCTIONS (PRESERVED)
// ===============================

async function getChildSubjects(childId: string) {
  const { data, error } = await supabase
    .from('child_subjects')
    .select('id')
    .eq('child_id', childId);
  
  if (error) throw error;
  return (data || []).map(cs => cs.id);
}

function formatGrade(gradeValue: number | null, gradeMaxValue: number | null): string {
  if (!gradeValue || !gradeMaxValue) return '';
  
  const percentage = Math.round((gradeValue / gradeMaxValue) * 100);
  let gradeEmoji = '';
  
  if (percentage >= 90) gradeEmoji = '🅰️';
  else if (percentage >= 80) gradeEmoji = '🅱️';
  else if (percentage >= 70) gradeEmoji = '🆔';
  else if (percentage >= 60) gradeEmoji = '🆘';
  else gradeEmoji = '❌';
  
  return ` ${gradeEmoji} ${percentage}%`;
}

// ===============================
// TOOL HANDLERS (PRESERVED LOGIC)
// ===============================

async function handleSearchLessons(childId: string, query: string = ''): Promise<string> {
  try {
    const childSubjectIds = await getChildSubjects(childId);
    
    let dbQuery = supabase
      .from('materials')
      .select(`
        id, title, content_type, lesson_json, due_date,
        child_subject:child_subject_id(
          subject:subject_id(name),
          custom_subject_name_override
        )
      `)
      .in('child_subject_id', childSubjectIds)
      .or('content_type.in.(lesson,reading,chapter),is_primary_lesson.eq.true');

    // Add text search if query provided
    if (query.trim()) {
      dbQuery = dbQuery.ilike('title', `%${query}%`);
    }

    dbQuery = dbQuery.order('title', { ascending: true }).limit(20);

    const { data, error } = await dbQuery;
    if (error) throw error;

    if (!data || data.length === 0) {
      return query ? 
        `No lessons found matching "${query}". Try searching for a topic, unit name, or lesson number.` :
        'No lesson content found.';
    }

    const results = ['📚 **Teaching Materials Found:**', ''];
    
    data.forEach(item => {
      const subjectName = (item.child_subject as any)?.custom_subject_name_override || 
                         (item.child_subject as any)?.subject?.name || 'General';
      
      results.push(`**${item.title}** (${subjectName})`);
      
      // Parse lesson content for key information
      if (item.lesson_json) {
        try {
          const lessonData = typeof item.lesson_json === 'string' ? 
            JSON.parse(item.lesson_json) : item.lesson_json;
          
          if (lessonData.learning_objectives && lessonData.learning_objectives.length > 0) {
            results.push('**Learning Objectives:**');
            lessonData.learning_objectives.slice(0, 3).forEach((obj: string) => {
              results.push(`• ${obj}`);
            });
          }
          
          if (lessonData.subject_keywords_or_subtopics && lessonData.subject_keywords_or_subtopics.length > 0) {
            results.push(`**Key Topics:** ${lessonData.subject_keywords_or_subtopics.slice(0, 5).join(', ')}`);
          }
          
          if (lessonData.main_content_summary_or_extract) {
            results.push(`**Summary:** ${lessonData.main_content_summary_or_extract.slice(0, 200)}...`);
          }
          
          if (lessonData.tasks_or_questions && lessonData.tasks_or_questions.length > 0) {
            results.push(`**Sample Questions:**`);
            lessonData.tasks_or_questions.slice(0, 3).forEach((question: string) => {
              results.push(`• ${question}`);
            });
          }
        } catch (e) {
          // Skip parsing errors
        }
      }
      
      results.push('---');
    });

    return results.join('\n');

  } catch (error: any) {
    console.error('❌ Search lessons error:', error);
    return `Error searching lessons: ${error.message}`;
  }
}

async function handleSearchStudentWork(childId: string, query: string = '', filters: {
  status?: 'incomplete' | 'completed' | 'overdue' | 'due_soon';
  subject?: string;
  content_type?: string;
  low_scores?: boolean;
} = {}): Promise<string> {
  try {
    const childSubjectIds = await getChildSubjects(childId);
    
    let dbQuery = supabase
      .from('materials')
      .select(`
        id, title, content_type, due_date, completed_at, 
        grade_value, grade_max_value, grading_notes, lesson_json,
        child_subject:child_subject_id(
          subject:subject_id(name),
          custom_subject_name_override
        )
      `)
      .in('child_subject_id', childSubjectIds)
      .in('content_type', ['assignment', 'worksheet', 'quiz', 'test']);

    // Apply text search
    if (query.trim()) {
      dbQuery = dbQuery.ilike('title', `%${query}%`);
    }

    // Apply status filters
    if (filters.status === 'incomplete') {
      dbQuery = dbQuery.is('completed_at', null);
    } else if (filters.status === 'completed') {
      dbQuery = dbQuery.not('completed_at', 'is', null);
    } else if (filters.status === 'overdue') {
      const today = new Date().toISOString().split('T')[0];
      dbQuery = dbQuery.is('completed_at', null).lt('due_date', today);
    } else if (filters.status === 'due_soon') {
      const today = new Date();
      const threeDaysOut = new Date();
      threeDaysOut.setDate(today.getDate() + 3);
      dbQuery = dbQuery.is('completed_at', null)
        .gte('due_date', today.toISOString().split('T')[0])
        .lte('due_date', threeDaysOut.toISOString().split('T')[0]);
    }

    // Apply subject filter
    if (filters.subject) {
      const { data: subjectIds } = await supabase
        .from('child_subjects')
        .select('id, subject:subject_id(name), custom_subject_name_override')
        .eq('child_id', childId)
        .or(`subject.name.ilike.%${filters.subject}%,custom_subject_name_override.ilike.%${filters.subject}%`);
      
      if (subjectIds && subjectIds.length > 0) {
        dbQuery = dbQuery.in('child_subject_id', subjectIds.map(s => s.id));
      }
    }

    // Apply content type filter
    if (filters.content_type) {
      dbQuery = dbQuery.eq('content_type', filters.content_type);
    }

    dbQuery = dbQuery.order('due_date', { ascending: true, nullsFirst: false }).limit(25);

    const { data, error } = await dbQuery;
    if (error) throw error;

    let materials = data || [];

    // Apply low scores filter after fetching
    if (filters.low_scores) {
      materials = materials.filter(m => {
        if (!m.grade_value || !m.grade_max_value) return false;
        const percentage = (m.grade_value / m.grade_max_value) * 100;
        return percentage < 75; // Less than 75% is considered low
      });
    }

    if (materials.length === 0) {
      return query ? 
        `No student work found matching "${query}" with the specified filters.` :
        'No student work found with the specified filters.';
    }

    const results = ['📝 **Student Work Found:**', ''];
    
    // Group by status for better organization
    const incomplete = materials.filter(m => !m.completed_at);
    const completed = materials.filter(m => m.completed_at);

    if (incomplete.length > 0) {
      results.push(`**📋 Incomplete Work (${incomplete.length}):**`);
      incomplete.forEach(item => {
        const subjectName = (item.child_subject as any)?.custom_subject_name_override || 
                           (item.child_subject as any)?.subject?.name || 'General';
        
        results.push(`• **${item.title}** [${item.content_type}] (${subjectName})`);
      });
      results.push('');
    }

    if (completed.length > 0) {
      results.push(`**✅ Completed Work (${completed.length}):**`);
      completed.forEach(item => {
        const subjectName = (item.child_subject as any)?.custom_subject_name_override || 
                           (item.child_subject as any)?.subject?.name || 'General';
        const gradeInfo = formatGrade(item.grade_value, item.grade_max_value);
        
        results.push(`• **${item.title}** [${item.content_type}] (${subjectName})${gradeInfo}`);
      });
    }

    return results.join('\n');

  } catch (error: any) {
    console.error('❌ Search student work error:', error);
    return `Error searching student work: ${error.message}`;
  }
}

async function handleGetMaterialDetails(childId: string, materialIdentifier: string): Promise<string> {
  try {
    const childSubjectIds = await getChildSubjects(childId);
    
    let dbQuery = supabase
      .from('materials')
      .select(`
        id, title, content_type, due_date, completed_at,
        grade_value, grade_max_value, grading_notes, lesson_json,
        parent_material_id, is_primary_lesson,
        child_subject:child_subject_id(
          subject:subject_id(name),
          custom_subject_name_override
        ),
        parent_material:parent_material_id(
          title, content_type, lesson_json
        )
      `)
      .in('child_subject_id', childSubjectIds);

    // Search by ID first, then by title with fuzzy matching
    if (materialIdentifier.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      dbQuery = dbQuery.eq('id', materialIdentifier);
    } else {
      // More flexible title matching
      dbQuery = dbQuery.ilike('title', `%${materialIdentifier}%`);
    }

    const { data, error } = await dbQuery.limit(1).single();
    
    if (error || !data) {
      return `Material "${materialIdentifier}" not found. Please check the title or ID.`;
    }

    const subjectName = (data.child_subject as any)?.custom_subject_name_override || 
                       (data.child_subject as any)?.subject?.name || 'General';

    const results = [];
    results.push(`📚 **${data.title}**`);
    results.push(`Subject: ${subjectName} | Type: ${data.content_type}`);
    
    if (data.completed_at) {
      const gradeInfo = formatGrade(data.grade_value, data.grade_max_value);
      results.push(`✅ Completed: ${new Date(data.completed_at).toLocaleDateString()}${gradeInfo}`);
    }
    
    results.push('');

    // Parse and display lesson content
    if (data.lesson_json) {
      const lessonData = typeof data.lesson_json === 'string' ? 
        JSON.parse(data.lesson_json) : data.lesson_json;
      
      if (lessonData.learning_objectives && lessonData.learning_objectives.length > 0) {
        results.push(`**Learning Objectives:**`);
        lessonData.learning_objectives.forEach((obj: string) => {
          results.push(`• ${obj}`);
        });
        results.push('');
      }

      if (lessonData.main_content_summary_or_extract) {
        results.push(`**Content Summary:**`);
        results.push(lessonData.main_content_summary_or_extract);
        results.push('');
      }

      if (lessonData.subject_keywords_or_subtopics && lessonData.subject_keywords_or_subtopics.length > 0) {
        results.push(`**Key Concepts:**`);
        results.push(lessonData.subject_keywords_or_subtopics.join(', '));
        results.push('');
      }

      // Show ALL questions for assignments/worksheets
      if (lessonData.worksheet_questions && lessonData.worksheet_questions.length > 0) {
        results.push(`**All Questions:**`);
        lessonData.worksheet_questions.forEach((q: any) => {
          results.push(`${q.question_number}. ${q.question_text}`);
        });
        results.push('');
      } else if (lessonData.tasks_or_questions && lessonData.tasks_or_questions.length > 0) {
        results.push(`**All Questions/Tasks:**`);
        lessonData.tasks_or_questions.forEach((question: string, index: number) => {
          results.push(`${index + 1}. ${question}`);
        });
        results.push('');
      }

      // Include answer key for completed work or lesson materials
      if (lessonData.answer_key && (data.completed_at || data.content_type === 'lesson')) {
        results.push(`**Answer Key:**`);
        Object.entries(lessonData.answer_key).forEach(([key, value]) => {
          results.push(`${key}: ${value}`);
        });
        results.push('');
      }

      if (lessonData.teaching_methodology) {
        results.push(`**Teaching Notes:** ${lessonData.teaching_methodology}`);
        results.push('');
      }
    }

    // Include parent lesson if this is an assignment/worksheet
    if (data.parent_material && (data.parent_material as any).lesson_json) {
      results.push(`**Related Lesson:** ${(data.parent_material as any).title}`);
      
      try {
        const parentLessonData = typeof (data.parent_material as any).lesson_json === 'string' ? 
          JSON.parse((data.parent_material as any).lesson_json) : (data.parent_material as any).lesson_json;
        
        if (parentLessonData.main_content_summary_or_extract) {
          results.push(`**Lesson Context:** ${parentLessonData.main_content_summary_or_extract.slice(0, 300)}...`);
        }
      } catch (e) {
        // Skip parsing errors
      }
    }

    if (data.grading_notes) {
      results.push(`**Teacher Notes:** ${data.grading_notes}`);
    }

    // Return structured JSON if this has worksheet questions for better AI parsing
    if (data.lesson_json) {
      try {
        const lessonData = typeof data.lesson_json === 'string' ? 
          JSON.parse(data.lesson_json) : data.lesson_json;
        
        if (lessonData.worksheet_questions && lessonData.worksheet_questions.length > 0) {
          // Return structured data for worksheets/tests
          return JSON.stringify({
            title: data.title,
            content_type: data.content_type,
            subject: subjectName,
            completed_at: data.completed_at,
            grade_value: data.grade_value,
            grade_max_value: data.grade_max_value,
            worksheet_questions: lessonData.worksheet_questions,
            learning_objectives: lessonData.learning_objectives || [],
            assignment_metadata: lessonData.assignment_metadata || {}
          });
        }
      } catch (e) {
        // Fall back to text format if JSON parsing fails
      }
    }

    return results.join('\n');

  } catch (error: any) {
    console.error('❌ Error getting material details:', error);
    return `Error retrieving material details: ${error.message}`;
  }
}

// ===============================
// MCP SERVER INITIALIZATION
// ===============================

function createMcpServer(): McpServer {
  const mcpServer = new McpServer({
    name: 'ai-tutor-mcp-server',
    version: '1.0.0',
  }, {
    capabilities: {
      tools: {},
    },
    instructions: 'AI Tutor MCP Server providing intelligent access to student educational data for personalized tutoring experiences.'
  });

  // CRITICAL: OpenAI expects these exact tool names for MCP integration
  
  // Register search tool (OpenAI standard - required for GPT-5 integration)
  mcpServer.tool(
    'search',
    'Search for educational content including assignments, lessons, and materials',
    {
      query: z.string().describe('Search query for educational content')
    },
    async ({ query }) => {
      // Extract child_id from the query if it starts with it
      // Format: "child_id:UUID query text" or fallback to default
      let childId = '058a3da2-0268-4d8c-995a-c732cd1b732a'; // Default child for testing
      let searchQuery = query;
      
      if (query.startsWith('child_id:')) {
        const parts = query.split(' ');
        childId = parts[0].replace('child_id:', '');
        searchQuery = parts.slice(1).join(' ');
      }
      
      // Search both assignments and lessons
      const workResult = await handleSearchStudentWork(childId, searchQuery);
      const lessonResult = await handleSearchLessons(childId, searchQuery);
      
      // Combine results
      const combinedResults = `**Student Assignments & Work:**\n${workResult}\n\n**Lessons & Teaching Materials:**\n${lessonResult}`;
      
      return {
        content: [{
          type: 'text',
          text: combinedResults
        }]
      };
    }
  );

  // Register fetch tool (OpenAI standard - required for GPT-5 integration)
  mcpServer.tool(
    'fetch',
    'Fetch complete details for a specific educational material by ID or title',
    {
      id: z.string().describe('Material ID or title to fetch complete content for')
    },
    async ({ id }) => {
      // Extract child_id from the id if it starts with it
      let childId = '058a3da2-0268-4d8c-995a-c732cd1b732a'; // Default child for testing
      let materialId = id;
      
      if (id.startsWith('child_id:')) {
        const parts = id.split('|');
        childId = parts[0].replace('child_id:', '');
        materialId = parts[1] || id;
      }
      
      const result = await handleGetMaterialDetails(childId, materialId);
      
      return {
        content: [{
          type: 'text',
          text: result
        }]
      };
    }
  );

  // Register search_lessons tool
  mcpServer.tool(
    'search_lessons',
    'Search for educational lessons and teaching materials',
    {
      child_id: z.string().describe('Student UUID for context'),
      query: z.string().optional().describe('Search query for lesson topics (e.g., "Other New England Colonies Are Founded", "History Section 3.2")')
    },
    async ({ child_id, query }) => {
      const result = await handleSearchLessons(child_id, query || '');
      return {
        content: [{
          type: 'text',
          text: result
        }]
      };
    }
  );

  // Register search_student_work tool
  mcpServer.tool(
    'search_student_work',
    'Search for student assignments, worksheets, quizzes, and tests',
    {
      child_id: z.string().describe('Student UUID for context'),
      query: z.string().optional().describe('Search query for specific assignments'),
      status: z.enum(['incomplete', 'completed', 'overdue', 'due_soon']).optional().describe('Filter by completion status'),
      subject: z.string().optional().describe('Filter by subject name'),
      content_type: z.enum(['assignment', 'worksheet', 'quiz', 'test']).optional().describe('Filter by content type'),
      low_scores: z.boolean().optional().describe('Show only work with grades < 75%')
    },
    async ({ child_id, query, status, subject, content_type, low_scores }) => {
      const result = await handleSearchStudentWork(child_id, query || '', {
        status,
        subject,
        content_type,
        low_scores
      });
      return {
        content: [{
          type: 'text',
          text: result
        }]
      };
    }
  );

  // Register get_material_details tool
  mcpServer.tool(
    'get_material_details',
    'Get complete content for a specific educational material, including all questions and answers',
    {
      child_id: z.string().describe('Student UUID for context'),
      material_identifier: z.string().describe('Material title or UUID (e.g., "After Reading: The Friend Inside - Think & Discuss")')
    },
    async ({ child_id, material_identifier }) => {
      const result = await handleGetMaterialDetails(child_id, material_identifier);
      return {
        content: [{
          type: 'text',
          text: result
        }]
      };
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
    service: 'ai-tutor-mcp-server',
    protocol: 'MCP compliant'
  });
});

//=============================================================================
// STREAMABLE HTTP TRANSPORT (PROTOCOL VERSION 2025-03-26)
//=============================================================================

app.all('/mcp', async (req: Request, res: Response) => {
  console.log(`Received ${req.method} request to /mcp`);
  try {
    // Check for existing session ID
    const sessionId = req.headers['mcp-session-id'] as string;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      // Check if the transport is of the correct type
      const existingTransport = transports[sessionId];
      if (existingTransport instanceof StreamableHTTPServerTransport) {
        // Reuse existing transport
        transport = existingTransport;
      } else {
        // Transport exists but is not a StreamableHTTPServerTransport (could be SSEServerTransport)
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
        eventStore, // Enable resumability
        onsessioninitialized: (sessionId: string) => {
          // Store the transport by session ID when session is initialized
          console.log(`StreamableHTTP session initialized with ID: ${sessionId}`);
          transports[sessionId] = transport;
        }
      });

      // Set up onclose handler to clean up transport when closed
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          console.log(`Transport closed for session ${sid}, removing from transports map`);
          delete transports[sid];
        }
      };

      // Connect the transport to the MCP server
      const mcpServer = createMcpServer();
      await mcpServer.connect(transport);
    } else {
      // Invalid request - no session ID or not initialization request
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

    // Handle the request with the transport
    await transport.handleRequest(req, res, req.body);
  } catch (error: any) {
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
// DEPRECATED HTTP+SSE TRANSPORT (PROTOCOL VERSION 2024-11-05)
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
    // Reuse existing transport
    await existingTransport.handlePostMessage(req, res, req.body);
  } else if (existingTransport) {
    // Transport exists but is not a SSEServerTransport (could be StreamableHTTPServerTransport)
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

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 AI Tutor MCP server running on port ${PORT}`);
  console.log(`📡 MCP Protocol compliant server with dual transport support`);
  console.log(`
==============================================
SUPPORTED TRANSPORT OPTIONS:

1. Streamable HTTP (Protocol version: 2025-03-26) - RECOMMENDED
   Endpoint: /mcp
   Methods: GET, POST, DELETE
   Usage: 
     - Initialize with POST to /mcp
     - Establish SSE stream with GET to /mcp
     - Send requests with POST to /mcp
     - Resume with session ID header

2. HTTP+SSE (Protocol version: 2024-11-05) - DEPRECATED
   Endpoints: /sse (GET) and /messages (POST)
   Usage:
     - Establish SSE with GET to /sse
     - Send messages with POST to /messages?sessionId=<id>

3. Health Check: GET /health
==============================================
  `);
});
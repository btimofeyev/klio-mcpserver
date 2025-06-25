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
          <li><strong>POST /messages</strong> - MCPs JSON-RPC messages</li>
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
              description: 'Search for student educational data including lessons, assignments, tests, quizzes, worksheets, grades, and progress',
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
                    enum: ['assignments', 'incomplete_assignments', 'completed_assignments', 'grades', 'subjects', 'overdue', 'recent', 'lessons', 'tests', 'quizzes', 'worksheets', 'study_materials', 'debug_completion_status', 'all'],
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

    console.error('👤 Child subjects query:', { childId, data: childSubjects, error: subjectsError });

    if (subjectsError) {
      return `Error: Failed to get child subjects: ${subjectsError.message}`;
    }

    if (!childSubjects || childSubjects.length === 0) {
      return 'No subjects assigned to this student. Please check the student ID.';
    }

    const childSubjectIds = childSubjects.map(cs => cs.id);
    console.error('🎯 Child subject IDs:', childSubjectIds);
    
    let results = [];

    // Handle specific search types
    if (searchType === 'assignments' || searchType === 'incomplete_assignments' || searchType === 'all') {
      const incompleteAssignments = await findIncompleteAssignments(childSubjectIds);
      if (incompleteAssignments.length > 0) {
        results.push(`📝 **Current Assignments (${incompleteAssignments.length}):**`);
        incompleteAssignments.forEach((material: any) => {
          const subjectName = material.child_subject?.subject?.name || 
                             material.child_subject?.custom_subject_name_override || 'General';
          const dueInfo = material.due_date ? ` - Due: ${material.due_date}` : '';
          const contentType = material.content_type ? ` [${material.content_type}]` : '';
          
          // Add status indicators
          let statusIcon = '📝';
          let statusText = '';
          if (material.due_date) {
            const dueDate = new Date(material.due_date);
            const today = new Date();
            const timeDiff = dueDate.getTime() - today.getTime();
            const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));
            
            if (daysDiff < 0) {
              statusIcon = '🚨';
              statusText = ' (OVERDUE)';
            } else if (daysDiff === 0) {
              statusIcon = '⚠️';
              statusText = ' (DUE TODAY)';
            } else if (daysDiff === 1) {
              statusIcon = '⏰';
              statusText = ' (DUE TOMORROW)';
            }
          }
          
          results.push(`- ${statusIcon} **${material.title}**${contentType} (${subjectName})${dueInfo}${statusText}`);
        });
        results.push('');
      }
    }

    if (searchType === 'completed_assignments' || searchType === 'all') {
      const completedAssignments = await findCompletedAssignments(childSubjectIds);
      if (completedAssignments.length > 0) {
        results.push(`✅ **Completed Assignments (Recent ${Math.min(completedAssignments.length, 10)}):**`);
        completedAssignments.slice(0, 10).forEach((material: any) => {
          const subjectName = material.child_subject?.subject?.name || 
                             material.child_subject?.custom_subject_name_override || 'General';
          const contentType = material.content_type ? ` [${material.content_type}]` : '';
          
          // Add grade information if available
          let gradeInfo = '';
          if (material.grade_value !== null && material.grade_max_value !== null) {
            const percentage = Math.round((material.grade_value / material.grade_max_value) * 100);
            const gradeEmoji = percentage >= 90 ? '🅰️' : percentage >= 80 ? '🅱️' : percentage >= 70 ? '🅲️' : percentage >= 60 ? '🅳️' : '❌';
            gradeInfo = ` - ${gradeEmoji} ${material.grade_value}/${material.grade_max_value} (${percentage}%)`;
          }
          
          const completedDate = new Date(material.completed_at).toLocaleDateString();
          results.push(`- ✅ **${material.title}**${contentType} (${subjectName}) - Completed: ${completedDate}${gradeInfo}`);
        });
        results.push('');
      }
    }

    if (searchType === 'lessons' || searchType === 'all') {
      const allLessons = await findLessonsAndStudyMaterials(childSubjectIds);
      if (allLessons.length > 0) {
        results.push(`📚 **Lessons & Study Materials (${allLessons.length}):**`);
        allLessons.forEach((material: any) => {
          const subjectName = material.child_subject?.subject?.name || 
                             material.child_subject?.custom_subject_name_override || 'General';
          
          // Add content type icon
          let icon = '📚';
          switch(material.content_type) {
            case 'lesson': icon = '📚'; break;
            case 'notes': icon = '📝'; break;
            case 'reading_material': icon = '📖'; break;
            default: icon = '📋'; break;
          }
          
          const typeLabel = material.content_type ? ` [${material.content_type}]` : '';
          results.push(`- ${icon} **${material.title}**${typeLabel} (${subjectName})`);
          
          // Add parsed content if available (mainly for lessons)
          if (material.parsed_content) {
            const content = material.parsed_content;
            
            // Add learning objectives
            if (content.learning_objectives && content.learning_objectives.length > 0) {
              results.push(`  📋 Objectives: ${content.learning_objectives.join(', ')}`);
            }
            
            // Add content summary
            if (content.content_summary) {
              results.push(`  📖 Focus: ${content.content_summary}`);
            }
            
            // Add keywords
            if (content.keywords && content.keywords.length > 0) {
              results.push(`  🔑 Key concepts: ${content.keywords.join(', ')}`);
            }
            
            // Add difficulty level for confidence
            if (content.difficulty_level) {
              results.push(`  📊 Level: ${content.difficulty_level}`);
            }
            
            // Add formatted questions (the key enhancement!)
            if (content.formatted_questions && content.formatted_questions.length > 0) {
              results.push(`  ❓ Questions to practice:`);
              content.formatted_questions.forEach((question: string) => {
                results.push(`     ${question}`);
              });
            }
          }
        });
        results.push('');
      }
    }

    if (searchType === 'overdue' || searchType === 'all') {
      const overdue = await findOverdueMaterials(childSubjectIds);
      if (overdue.length > 0) {
        results.push(`🚨 **Overdue Assignments (${overdue.length}):**`);
        overdue.forEach((item: any) => {
          const subjectName = item.child_subject?.subject?.name || 
                             item.child_subject?.custom_subject_name_override || 'Unknown';
          const contentType = item.content_type ? ` [${item.content_type}]` : '';
          results.push(`- **${item.title}**${contentType} (${subjectName}) - Due: ${item.due_date}`);
          if (item.lesson?.title) {
            results.push(`  Related to: ${item.lesson.title}`);
          }
        });
        results.push('');
      }
    }

    if (searchType === 'tests' || searchType === 'quizzes' || searchType === 'all') {
      const testsQuizzes = await findTestsAndQuizzes(childSubjectIds);
      if (testsQuizzes.length > 0) {
        const upcoming = testsQuizzes.filter((t: any) => !t.completed_at);
        const completed = testsQuizzes.filter((t: any) => t.completed_at);
        
        if (upcoming.length > 0) {
          results.push(`📝 **Upcoming Tests & Quizzes (${upcoming.length}):**`);
          upcoming.forEach((item: any) => {
            const subjectName = item.child_subject?.subject?.name || 
                               item.child_subject?.custom_subject_name_override || 'Unknown';
            const type = item.content_type === 'test' ? '📋 Test' : '❓ Quiz';
            const dueInfo = item.due_date ? ` - Due: ${item.due_date}` : '';
            results.push(`- ${type}: **${item.title}** (${subjectName})${dueInfo}`);
          });
          results.push('');
        }
        
        if (completed.length > 0) {
          results.push(`✅ **Completed Tests & Quizzes (Recent):**`);
          completed.slice(0, 5).forEach((item: any) => {
            const subjectName = item.child_subject?.subject?.name || 
                               item.child_subject?.custom_subject_name_override || 'Unknown';
            const type = item.content_type === 'test' ? 'Test' : 'Quiz';
            let gradeInfo = '';
            if (item.grade_value && item.grade_max_value) {
              const percentage = Math.round((item.grade_value / item.grade_max_value) * 100);
              gradeInfo = ` - Score: ${percentage}%`;
            }
            results.push(`- ${type}: ${item.title} (${subjectName})${gradeInfo}`);
          });
          results.push('');
        }
      }
    }

    if (searchType === 'worksheets' || searchType === 'all') {
      const worksheets = await findWorksheets(childSubjectIds);
      if (worksheets.length > 0) {
        const incomplete = worksheets.filter((w: any) => !w.completed_at);
        if (incomplete.length > 0) {
          results.push(`📄 **Worksheets to Complete (${incomplete.length}):**`);
          incomplete.slice(0, 5).forEach((item: any) => {
            const subjectName = item.child_subject?.subject?.name || 
                               item.child_subject?.custom_subject_name_override || 'Unknown';
            const dueInfo = item.due_date ? ` - Due: ${item.due_date}` : '';
            results.push(`- **${item.title}** (${subjectName})${dueInfo}`);
            if (item.lesson?.title) {
              results.push(`  From lesson: ${item.lesson.title}`);
            }
          });
          results.push('');
        }
      }
    }

    if (searchType === 'study_materials' || searchType === 'all') {
      const studyMaterials = await findStudyMaterials(childSubjectIds);
      if (studyMaterials.length > 0) {
        results.push(`📖 **Study Materials Available:**`);
        studyMaterials.slice(0, 5).forEach((item: any) => {
          const subjectName = item.child_subject?.subject?.name || 
                             item.child_subject?.custom_subject_name_override || 'Unknown';
          const type = item.content_type === 'notes' ? '📝 Notes' : '📖 Reading';
          results.push(`- ${type}: **${item.title}** (${subjectName})`);
        });
        results.push('');
      }
    }

    if (searchType === 'grades' || searchType === 'all') {
      const graded = await findGradedMaterials(childSubjectIds);
      if (graded.length > 0) {
        results.push(`📊 **Recent Grades (${graded.length}):**`);
        
        // Calculate overall statistics
        let totalEarned = 0;
        let totalPossible = 0;
        const gradesBySubject: { [key: string]: { earned: number, possible: number, count: number, grades: any[] } } = {};
        
        graded.forEach((item: any) => {
          const subjectName = item.child_subject?.subject?.name || 
                             item.child_subject?.custom_subject_name_override || 'General';
          const percentage = Math.round((item.grade_value / item.grade_max_value) * 100);
          const contentType = item.content_type ? ` [${item.content_type}]` : '';
          
          // Grade emoji based on percentage
          const gradeEmoji = percentage >= 90 ? '🅰️' : percentage >= 80 ? '🅱️' : percentage >= 70 ? '🆔' : percentage >= 60 ? '🆘' : '❌';
          
          results.push(`- ${gradeEmoji} **${item.title}**${contentType} (${subjectName}) - ${item.grade_value}/${item.grade_max_value} (${percentage}%)`);
          
          // Track for statistics
          totalEarned += parseFloat(item.grade_value);
          totalPossible += parseFloat(item.grade_max_value);
          
          if (!gradesBySubject[subjectName]) {
            gradesBySubject[subjectName] = { earned: 0, possible: 0, count: 0, grades: [] };
          }
          gradesBySubject[subjectName].earned += parseFloat(item.grade_value);
          gradesBySubject[subjectName].possible += parseFloat(item.grade_max_value);
          gradesBySubject[subjectName].count++;
          gradesBySubject[subjectName].grades.push(percentage);
        });
        
        // Show overall average
        if (totalPossible > 0) {
          const overallAverage = Math.round((totalEarned / totalPossible) * 100);
          const overallEmoji = overallAverage >= 90 ? '🅰️' : overallAverage >= 80 ? '🅱️' : overallAverage >= 70 ? '🆔' : overallAverage >= 60 ? '🆘' : '❌';
          results.push(`\n📈 **Overall Average**: ${overallEmoji} ${overallAverage}% (${totalEarned.toFixed(1)}/${totalPossible.toFixed(1)} points)`);
        }
        
        // Show subject averages if multiple subjects
        if (Object.keys(gradesBySubject).length > 1) {
          results.push(`\n📚 **By Subject:**`);
          for (const [subject, data] of Object.entries(gradesBySubject)) {
            const subjectAverage = Math.round((data.earned / data.possible) * 100);
            const subjectEmoji = subjectAverage >= 90 ? '🅰️' : subjectAverage >= 80 ? '🅱️' : subjectAverage >= 70 ? '🆔' : subjectAverage >= 60 ? '🆘' : '❌';
            results.push(`- ${subjectEmoji} **${subject}**: ${subjectAverage}% (${data.count} assignments)`);
          }
        }
        
        results.push('');
      }
    }

    if (searchType === 'subjects') {
      results.push(`🎓 **Enrolled Subjects:**`);
      childSubjects.forEach((subject: any) => {
        const name = subject.subject?.name || subject.custom_subject_name_override || 'Unknown Subject';
        results.push(`- ${name}`);
      });
    }

    if (searchType === 'debug_completion_status') {
      const debugInfo = await debugCompletionStatus(childSubjectIds);
      results.push(`🔍 **Assignment Completion Status Debug:**`);
      debugInfo.forEach((item: any) => {
        const status = item.completed_at ? `✅ COMPLETED (${new Date(item.completed_at).toLocaleDateString()})` : `📝 INCOMPLETE`;
        const gradeInfo = item.grade_value ? ` - Grade: ${item.grade_value}/${item.grade_max_value}` : ' - No grade';
        results.push(`- **${item.title}** ${status}${gradeInfo}`);
      });
    }

    // Add summary at the end for 'all' searches
    if (searchType === 'all' && results.length > 0) {
      results.push('\n📊 **Summary:** The AI tutor now has access to your complete curriculum. ✅ Completed assignments show grades and are separated from current work. 📝 Current assignments show due dates and urgency status. 📚 Study materials and lessons are available for review.');
    }

    return results.length > 0 ? results.join('\n') : 'No results found.';

  } catch (error: any) {
    return `Error searching database: ${error.message}`;
  }
}

// Find overdue materials (only incomplete assignments)
async function findOverdueMaterials(childSubjectIds: string[]) {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const { data, error } = await supabase
      .from('materials')
      .select(`
        id, title, due_date, completed_at, content_type,
        lesson:lesson_id(id, title, description),
        child_subject:child_subject_id(
          subject:subject_id(name),
          custom_subject_name_override
        )
      `)
      .in('child_subject_id', childSubjectIds)
      .in('content_type', ['assignment', 'worksheet', 'quiz', 'test']) // Only graded materials
      .lt('due_date', today)
      .is('completed_at', null) // Only incomplete assignments
      .order('due_date', { ascending: true })
      .limit(10);

    console.error('🚨 Overdue materials query result:', { data, error, count: data?.length });
    return data || [];
  } catch (error) {
    console.error('❌ Error finding overdue materials:', error);
    return [];
  }
}

// Find graded materials
async function findGradedMaterials(childSubjectIds: string[]) {
  try {
    const { data, error } = await supabase
      .from('materials')
      .select(`
        id, title, grade_value, grade_max_value, completed_at, content_type,
        lesson:lesson_id(id, title),
        child_subject:child_subject_id(
          subject:subject_id(name),
          custom_subject_name_override
        )
      `)
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

// Find incomplete assignments (current work)
async function findIncompleteAssignments(childSubjectIds: string[]) {
  try {
    console.error('📝 Finding incomplete assignments for child_subject_ids:', childSubjectIds);
    
    const { data, error } = await supabase
      .from('materials')
      .select(`
        id, title, due_date, created_at, content_type, completed_at,
        child_subject:child_subject_id(
          subject:subject_id(name),
          custom_subject_name_override
        )
      `)
      .in('child_subject_id', childSubjectIds)
      .in('content_type', ['assignment', 'worksheet', 'quiz', 'test'])
      .is('completed_at', null)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(20);

    console.error('📝 Incomplete assignments query result:', { data, error, count: data?.length });

    return data || [];
  } catch (error) {
    console.error('❌ Error finding incomplete assignments:', error);
    return [];
  }
}

// Find completed assignments with grades
async function findCompletedAssignments(childSubjectIds: string[]) {
  try {
    console.error('✅ Finding completed assignments for child_subject_ids:', childSubjectIds);
    
    const { data, error } = await supabase
      .from('materials')
      .select(`
        id, title, due_date, completed_at, content_type, grade_value, grade_max_value,
        child_subject:child_subject_id(
          subject:subject_id(name),
          custom_subject_name_override
        )
      `)
      .in('child_subject_id', childSubjectIds)
      .in('content_type', ['assignment', 'worksheet', 'quiz', 'test'])
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(15);

    console.error('✅ Completed assignments query result:', { data, error, count: data?.length });

    return data || [];
  } catch (error) {
    console.error('❌ Error finding completed assignments:', error);
    return [];
  }
}

// Find lessons and study materials (non-graded content)
async function findLessonsAndStudyMaterials(childSubjectIds: string[]) {
  try {
    console.error('📚 Finding lessons and study materials for child_subject_ids:', childSubjectIds);
    
    const { data, error } = await supabase
      .from('materials')
      .select(`
        id, title, due_date, created_at, content_type, lesson_json,
        child_subject:child_subject_id(
          subject:subject_id(name),
          custom_subject_name_override
        )
      `)
      .in('child_subject_id', childSubjectIds)
      .in('content_type', ['lesson', 'notes', 'reading_material', 'other'])
      .order('created_at', { ascending: true })
      .limit(25);

    console.error('📚 Lessons query result:', { data, error, count: data?.length });

    if (error) {
      console.error('❌ Error in lessons query:', error);
      return [];
    }

    // Process material data to include parsed content (primarily for lessons)
    if (data && data.length > 0) {
      return data.map(material => ({
        ...material,
        parsed_content: parseLessonContent(material.lesson_json)
      }));
    }

    return data || [];
  } catch (error) {
    console.error('❌ Error finding lessons and study materials:', error);
    return [];
  }
}

// Parse lesson JSON content and extract student-appropriate information
function parseLessonContent(lessonJson: any) {
  // Handle cases where lessonJson might be null or not an object
  if (!lessonJson || typeof lessonJson !== 'object') {
    return null;
  }

  try {
    const parsed: {
      learning_objectives: string[] | null,
      content_summary: string | null,
      keywords: string[] | null,
      difficulty_level: string | null,
      formatted_questions: string[] | null
    } = {
      learning_objectives: null,
      content_summary: null,
      keywords: null,
      difficulty_level: null,
      formatted_questions: null
    };

    // Extract learning objectives
    if (lessonJson.learning_objectives && Array.isArray(lessonJson.learning_objectives)) {
      parsed.learning_objectives = lessonJson.learning_objectives;
    }

    // Extract content summary
    if (lessonJson.main_content_summary_or_extract) {
      parsed.content_summary = lessonJson.main_content_summary_or_extract;
    }

    // Extract keywords/subtopics
    if (lessonJson.subject_keywords_or_subtopics && Array.isArray(lessonJson.subject_keywords_or_subtopics)) {
      parsed.keywords = lessonJson.subject_keywords_or_subtopics;
    }

    // Extract difficulty level (for student confidence building)
    if (lessonJson.difficulty_level_suggestion) {
      parsed.difficulty_level = lessonJson.difficulty_level_suggestion;
    }

    // Extract and format questions from lesson_json.tasks_or_questions
    if (lessonJson.tasks_or_questions && Array.isArray(lessonJson.tasks_or_questions) && lessonJson.tasks_or_questions.length > 0) {
      const formattedQuestions = formatQuestions(lessonJson.tasks_or_questions);
      if (formattedQuestions.length > 0) {
        parsed.formatted_questions = formattedQuestions;
      }
    }

    return parsed;
  } catch (error) {
    console.error('❌ Error parsing lesson content:', error);
    return null;
  }
}

// Format questions for AI tutor consumption
function formatQuestions(tasksOrQuestions: string[]): string[] {
  if (!Array.isArray(tasksOrQuestions) || tasksOrQuestions.length === 0) {
    return [];
  }

  const formattedQuestions: string[] = [];
  let questionNumber = 1;

  // Take first 5 questions to avoid overwhelming AI context
  const questionsToProcess = tasksOrQuestions.slice(0, 5);
  
  for (const item of questionsToProcess) {
    // Skip non-string items or empty items
    if (typeof item !== 'string' || !item.trim()) {
      continue;
    }
    
    const cleanItem = item.trim();
    
    // Skip generic instructions like "Solve each problem."
    if (cleanItem.toLowerCase().includes('solve') && 
        cleanItem.toLowerCase().includes('problem') && 
        cleanItem.length < 30) {
      continue;
    }
    
    // Skip empty or very short items that aren't meaningful
    if (cleanItem.length < 3) {
      continue;
    }
    
    // Look for numbered questions (e.g., "1. 793 × 27 = ____")
    const numberedMatch = cleanItem.match(/^(\d+)\.\s*(.+)/);
    if (numberedMatch) {
      const questionContent = numberedMatch[2]
        .replace(/=\s*_{4,}/g, '= ?')  // Replace multiple underscores with ?
        .replace(/=\s*_+\s*$/g, '= ?') // Replace trailing underscores with ?
        .trim();
      
      if (questionContent.length > 0) {
        formattedQuestions.push(`Question ${numberedMatch[1]}: ${questionContent}`);
      }
    } else {
      // For non-numbered items, add our own numbering
      const processedItem = cleanItem
        .replace(/=\s*_{4,}/g, '= ?')
        .replace(/=\s*_+\s*$/g, '= ?');
      
      formattedQuestions.push(`Question ${questionNumber}: ${processedItem}`);
      questionNumber++;
    }
  }

  return formattedQuestions;
}

// Find tests and quizzes
async function findTestsAndQuizzes(childSubjectIds: string[]) {
  try {
    const { data, error } = await supabase
      .from('materials')
      .select(`
        id, title, due_date, completed_at, content_type, grade_value, grade_max_value,
        lesson:lesson_id(id, title),
        child_subject:child_subject_id(
          subject:subject_id(name),
          custom_subject_name_override
        )
      `)
      .in('child_subject_id', childSubjectIds)
      .in('content_type', ['test', 'quiz'])
      .order('due_date', { ascending: false, nullsFirst: false })
      .limit(15);

    return data || [];
  } catch (error) {
    console.error('Error finding tests/quizzes:', error);
    return [];
  }
}

// Find worksheets
async function findWorksheets(childSubjectIds: string[]) {
  try {
    const { data, error } = await supabase
      .from('materials')
      .select(`
        id, title, due_date, completed_at, content_type, grade_value, grade_max_value,
        lesson:lesson_id(id, title),
        child_subject:child_subject_id(
          subject:subject_id(name),
          custom_subject_name_override
        )
      `)
      .in('child_subject_id', childSubjectIds)
      .eq('content_type', 'worksheet')
      .order('created_at', { ascending: false })
      .limit(15);

    return data || [];
  } catch (error) {
    console.error('Error finding worksheets:', error);
    return [];
  }
}

// Find study materials (notes and reading materials)
async function findStudyMaterials(childSubjectIds: string[]) {
  try {
    const { data, error } = await supabase
      .from('materials')
      .select(`
        id, title, content_type, created_at,
        lesson:lesson_id(id, title),
        child_subject:child_subject_id(
          subject:subject_id(name),
          custom_subject_name_override
        )
      `)
      .in('child_subject_id', childSubjectIds)
      .in('content_type', ['notes', 'reading_material'])
      .order('created_at', { ascending: false })
      .limit(15);

    return data || [];
  } catch (error) {
    console.error('Error finding study materials:', error);
    return [];
  }
}

// Debug completion status for all assignments
async function debugCompletionStatus(childSubjectIds: string[]) {
  try {
    console.error('🔍 Debug: Finding all assignments for completion status check');
    
    const { data, error } = await supabase
      .from('materials')
      .select(`
        id, title, completed_at, grade_value, grade_max_value, due_date, content_type,
        child_subject:child_subject_id(
          subject:subject_id(name),
          custom_subject_name_override
        )
      `)
      .in('child_subject_id', childSubjectIds)
      .in('content_type', ['assignment', 'worksheet', 'quiz', 'test'])
      .order('created_at', { ascending: true })
      .limit(50);

    console.error('🔍 Debug query result:', { data, error, count: data?.length });

    return data || [];
  } catch (error) {
    console.error('❌ Error in debug completion status:', error);
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
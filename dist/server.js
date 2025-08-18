#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import express from 'express';
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
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});
console.error('✅ Supabase client created');
const app = express();
// Sessions for SSE connections
const sseConnections = new Map();
// Basic middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control']
}));
app.use(express.json());
console.error('✅ Express middleware set up');
// Generate session ID
function generateSessionId() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
}
// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'ai-tutor-mcp-server',
        transport: 'HTTP/SSE MCP'
    });
});
// Homepage
app.get('/', (req, res) => {
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
          <li><strong>search_database</strong> - Search student educational data with natural language types</li>
          <li><strong>get_material_content</strong> - Get detailed content for specific materials</li>
          <li><strong>get_next_homework</strong> - Get next assignment that needs to be done</li>
          <li><strong>get_subject_context</strong> - Get comprehensive subject overview</li>
          <li><strong>get_student_profile</strong> - Get learning preferences and performance</li>
        </ul>
        
        <h2>Natural Search Types:</h2>
        <ul>
          <li><strong>homework</strong> - \"What's my homework?\"</li>
          <li><strong>help_with_subject</strong> - \"I need help with math\"</li>
          <li><strong>review</strong> - \"Let's review something\"</li>
          <li><strong>upcoming_tests</strong> - \"What tests do I have?\"</li>
          <li><strong>current_lesson</strong> - \"What am I learning now?\"</li>
        </ul>
      </body>
    </html>
  `);
});
// SSE endpoint for MCP
app.get('/sse', (req, res) => {
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
app.post('/messages', async (req, res) => {
    try {
        const sessionId = req.query.sessionId;
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
        }
        else {
            res.status(204).end();
        }
    }
    catch (error) {
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
async function handleMCPMessage(message) {
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
                                        enum: ['homework', 'help_with_subject', 'review', 'upcoming_tests', 'current_lesson', 'assignments', 'incomplete_assignments', 'completed_assignments', 'grades', 'subjects', 'overdue', 'recent', 'lessons', 'tests', 'quizzes', 'worksheets', 'study_materials', 'all'],
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
                        },
                        {
                            name: 'get_next_homework',
                            description: 'Get the next incomplete assignment that needs to be done, with full context',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    child_id: {
                                        type: 'string',
                                        description: 'UUID of the student'
                                    },
                                    subject: {
                                        type: 'string',
                                        description: 'Optional: specific subject to filter by'
                                    }
                                },
                                required: ['child_id']
                            }
                        },
                        {
                            name: 'get_subject_context',
                            description: 'Get comprehensive context for a specific subject including current lesson, recent work, and performance',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    child_id: {
                                        type: 'string',
                                        description: 'UUID of the student'
                                    },
                                    subject_name: {
                                        type: 'string',
                                        description: 'Name of the subject (e.g., "Math", "History", "English")'
                                    }
                                },
                                required: ['child_id', 'subject_name']
                            }
                        },
                        {
                            name: 'get_student_profile',
                            description: 'Get student learning profile including preferences, strengths, and areas for improvement',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    child_id: {
                                        type: 'string',
                                        description: 'UUID of the student'
                                    }
                                },
                                required: ['child_id']
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
                const result = await searchDatabase(toolArgs.child_id, toolArgs.query || '', toolArgs.search_type || 'all');
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
                const result = await getMaterialContent(toolArgs.child_id, toolArgs.material_identifier);
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
            if (toolName === 'get_next_homework') {
                const result = await getNextHomework(toolArgs.child_id, toolArgs.subject);
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
            if (toolName === 'get_subject_context') {
                const result = await getSubjectContext(toolArgs.child_id, toolArgs.subject_name);
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
            if (toolName === 'get_student_profile') {
                const result = await getStudentProfile(toolArgs.child_id);
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
async function searchDatabase(childId, query, searchType) {
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
        // Handle new natural language search types
        if (searchType === 'homework') {
            // Get next homework assignment with full context
            const homework = await getNextHomeworkDetails(childSubjectIds);
            if (homework) {
                results.push(`📚 **Next Homework Assignment:**`);
                results.push(homework);
            }
            else {
                results.push('✅ No homework assignments pending!');
            }
            return results.join('\n');
        }
        if (searchType === 'help_with_subject') {
            // Extract subject from query if provided
            const subjectContext = await getSubjectMaterials(childSubjectIds, query);
            results.push(subjectContext);
            return results.join('\n');
        }
        if (searchType === 'review') {
            // Get materials that need review based on grades
            const reviewMaterials = await getReviewMaterials(childSubjectIds);
            if (reviewMaterials.length > 0) {
                results.push(`📖 **Materials to Review:**`);
                reviewMaterials.forEach((material) => {
                    const subjectName = material.child_subject?.subject?.name ||
                        material.child_subject?.custom_subject_name_override || 'General';
                    const gradePercentage = material.grade_max_value ?
                        Math.round((material.grade_value / material.grade_max_value) * 100) : 0;
                    results.push(`- **${material.title}** (${subjectName}) - Score: ${gradePercentage}% - Needs review`);
                });
            }
            else {
                results.push('Great job! No materials need review right now.');
            }
            return results.join('\n');
        }
        if (searchType === 'upcoming_tests') {
            const tests = await findUpcomingAssessments(childSubjectIds);
            if (tests.length > 0) {
                results.push(`📝 **Upcoming Tests & Quizzes:**`);
                tests.forEach((test) => {
                    const subjectName = test.child_subject?.subject?.name ||
                        test.child_subject?.custom_subject_name_override || 'Unknown';
                    const type = test.content_type === 'test' ? '📋 Test' : '❓ Quiz';
                    const dueInfo = test.due_date ? ` - Due: ${test.due_date}` : '';
                    results.push(`- ${type}: **${test.title}** (${subjectName})${dueInfo}`);
                });
            }
            else {
                results.push('No upcoming tests or quizzes scheduled.');
            }
            return results.join('\n');
        }
        if (searchType === 'current_lesson') {
            const currentLessons = await getCurrentLessons(childSubjectIds);
            if (currentLessons.length > 0) {
                results.push(`📚 **Current Lessons:**`);
                currentLessons.forEach((lesson) => {
                    const subjectName = lesson.child_subject?.subject?.name ||
                        lesson.child_subject?.custom_subject_name_override || 'General';
                    results.push(`- **${lesson.title}** (${subjectName})`);
                    if (lesson.parsed_content?.learning_objectives) {
                        results.push(`  📋 Learning: ${lesson.parsed_content.learning_objectives.join(', ')}`);
                    }
                });
            }
            return results.join('\n');
        }
        // Handle specific search types
        if (searchType === 'assignments' || searchType === 'incomplete_assignments' || searchType === 'all') {
            const incompleteAssignments = await findIncompleteAssignments(childSubjectIds);
            if (incompleteAssignments.length > 0) {
                results.push(`📝 **Current Assignments (${incompleteAssignments.length}):**`);
                incompleteAssignments.forEach((material) => {
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
                        }
                        else if (daysDiff === 0) {
                            statusIcon = '⚠️';
                            statusText = ' (DUE TODAY)';
                        }
                        else if (daysDiff === 1) {
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
                completedAssignments.slice(0, 10).forEach((material) => {
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
                allLessons.forEach((material) => {
                    const subjectName = material.child_subject?.subject?.name ||
                        material.child_subject?.custom_subject_name_override || 'General';
                    // Add content type icon
                    let icon = '📚';
                    switch (material.content_type) {
                        case 'lesson':
                            icon = '📚';
                            break;
                        case 'notes':
                            icon = '📝';
                            break;
                        case 'reading_material':
                            icon = '📖';
                            break;
                        default:
                            icon = '📋';
                            break;
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
                            content.formatted_questions.forEach((question) => {
                                results.push(`     ${question}`);
                            });
                        }
                    }
                });
                results.push('');
            }
        }
        if (searchType === 'next_up' || searchType === 'all') {
            const nextUpItems = await findNextUpMaterials(childSubjectIds);
            if (nextUpItems.length > 0) {
                results.push(`📝 **Next Up - Ready to Work On (${nextUpItems.length}):**`);
                nextUpItems.forEach((item) => {
                    const subjectName = item.child_subject?.subject?.name ||
                        item.child_subject?.custom_subject_name_override || 'Unknown';
                    const contentType = item.content_type ? ` [${item.content_type}]` : '';
                    results.push(`- **${item.title}**${contentType} (${subjectName}) - Scheduled: ${item.due_date}`);
                    if (item.lesson?.title) {
                        results.push(`  Related to: ${item.lesson.title}`);
                    }
                });
                results.push('');
            }
        }
        if (searchType === 'performance_review' || searchType === 'all') {
            const lowScoreItems = await findLowPerformanceItems(childSubjectIds);
            if (lowScoreItems.length > 0) {
                results.push(`📈 **Items Worth Reviewing (Low Scores):**`);
                lowScoreItems.forEach((item) => {
                    const subjectName = item.child_subject?.subject?.name ||
                        item.child_subject?.custom_subject_name_override || 'Unknown';
                    const contentType = item.content_type ? ` [${item.content_type}]` : '';
                    const percentage = item.grade_value && item.grade_max_value ?
                        Math.round((item.grade_value / item.grade_max_value) * 100) : 0;
                    let suggestion = '';
                    if (percentage < 50)
                        suggestion = ' - Needs significant review';
                    else if (percentage < 70)
                        suggestion = ' - Could use more practice';
                    else
                        suggestion = ' - Room for improvement';
                    results.push(`- **${item.title}**${contentType} (${subjectName}) - ${percentage}%${suggestion}`);
                });
                results.push('');
            }
        }
        if (searchType === 'tests' || searchType === 'quizzes' || searchType === 'all') {
            const testsQuizzes = await findTestsAndQuizzes(childSubjectIds);
            if (testsQuizzes.length > 0) {
                const upcoming = testsQuizzes.filter((t) => !t.completed_at);
                const completed = testsQuizzes.filter((t) => t.completed_at);
                if (upcoming.length > 0) {
                    results.push(`📝 **Upcoming Tests & Quizzes (${upcoming.length}):**`);
                    upcoming.forEach((item) => {
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
                    completed.slice(0, 5).forEach((item) => {
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
                const incomplete = worksheets.filter((w) => !w.completed_at);
                if (incomplete.length > 0) {
                    results.push(`📄 **Worksheets to Complete (${incomplete.length}):**`);
                    incomplete.slice(0, 5).forEach((item) => {
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
                studyMaterials.slice(0, 5).forEach((item) => {
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
                const gradesBySubject = {};
                graded.forEach((item) => {
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
            childSubjects.forEach((subject) => {
                const name = subject.subject?.name || subject.custom_subject_name_override || 'Unknown Subject';
                results.push(`- ${name}`);
            });
        }
        if (searchType === 'debug_completion_status') {
            const debugInfo = await debugCompletionStatus(childSubjectIds);
            results.push(`🔍 **Assignment Completion Status Debug:**`);
            debugInfo.forEach((item) => {
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
    }
    catch (error) {
        return `Error searching database: ${error.message}`;
    }
}
// Find next materials to work on (incomplete assignments in order)
async function findNextUpMaterials(childSubjectIds) {
    try {
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
            .is('completed_at', null) // Only incomplete assignments
            .order('due_date', { ascending: true, nullsFirst: false })
            .limit(10);
        console.error('📝 Next up materials query result:', { data, error, count: data?.length });
        return data || [];
    }
    catch (error) {
        console.error('❌ Error finding next up materials:', error);
        return [];
    }
}
// Find materials with low performance scores for review
async function findLowPerformanceItems(childSubjectIds) {
    try {
        const { data, error } = await supabase
            .from('materials')
            .select(`
        id, title, grade_value, grade_max_value, completed_at, content_type,
        child_subject:child_subject_id(
          subject:subject_id(name),
          custom_subject_name_override
        )
      `)
            .in('child_subject_id', childSubjectIds)
            .in('content_type', ['assignment', 'worksheet', 'quiz', 'test'])
            .not('grade_value', 'is', null)
            .not('grade_max_value', 'is', null)
            .not('completed_at', 'is', null) // Only completed items with grades
            .order('completed_at', { ascending: false })
            .limit(20);
        if (error)
            throw error;
        // Filter for low performance (less than 85%)
        const lowPerformanceItems = (data || []).filter((item) => {
            if (!item.grade_value || !item.grade_max_value)
                return false;
            const percentage = (item.grade_value / item.grade_max_value) * 100;
            return percentage < 85;
        }).slice(0, 10);
        console.error('📈 Low performance items query result:', { count: lowPerformanceItems.length });
        return lowPerformanceItems;
    }
    catch (error) {
        console.error('❌ Error finding low performance items:', error);
        return [];
    }
}
// Find graded materials
async function findGradedMaterials(childSubjectIds) {
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
    }
    catch (error) {
        return [];
    }
}
// Find incomplete assignments (current work)
async function findIncompleteAssignments(childSubjectIds) {
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
    }
    catch (error) {
        console.error('❌ Error finding incomplete assignments:', error);
        return [];
    }
}
// Find completed assignments with grades
async function findCompletedAssignments(childSubjectIds) {
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
    }
    catch (error) {
        console.error('❌ Error finding completed assignments:', error);
        return [];
    }
}
// Find lessons and study materials (non-graded content)
async function findLessonsAndStudyMaterials(childSubjectIds) {
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
    }
    catch (error) {
        console.error('❌ Error finding lessons and study materials:', error);
        return [];
    }
}
// Parse lesson JSON content and extract student-appropriate information
function parseLessonContent(lessonJson) {
    // Handle cases where lessonJson might be null or not an object
    if (!lessonJson || typeof lessonJson !== 'object') {
        return null;
    }
    try {
        const parsed = {
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
    }
    catch (error) {
        console.error('❌ Error parsing lesson content:', error);
        return null;
    }
}
// Format questions for AI tutor consumption
function formatQuestions(tasksOrQuestions) {
    if (!Array.isArray(tasksOrQuestions) || tasksOrQuestions.length === 0) {
        return [];
    }
    const formattedQuestions = [];
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
                .replace(/=\s*_{4,}/g, '= ?') // Replace multiple underscores with ?
                .replace(/=\s*_+\s*$/g, '= ?') // Replace trailing underscores with ?
                .trim();
            if (questionContent.length > 0) {
                formattedQuestions.push(`Question ${numberedMatch[1]}: ${questionContent}`);
            }
        }
        else {
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
async function findTestsAndQuizzes(childSubjectIds) {
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
    }
    catch (error) {
        console.error('Error finding tests/quizzes:', error);
        return [];
    }
}
// Find worksheets
async function findWorksheets(childSubjectIds) {
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
    }
    catch (error) {
        console.error('Error finding worksheets:', error);
        return [];
    }
}
// Find study materials (notes and reading materials)
async function findStudyMaterials(childSubjectIds) {
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
    }
    catch (error) {
        console.error('Error finding study materials:', error);
        return [];
    }
}
// Debug completion status for all assignments
async function debugCompletionStatus(childSubjectIds) {
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
    }
    catch (error) {
        console.error('❌ Error in debug completion status:', error);
        return [];
    }
}
// Get material content
async function getMaterialContent(childId, materialIdentifier) {
    try {
        console.error(`📖 Getting material content: childId=${childId}, identifier="${materialIdentifier}"`);
        // Get child's subjects
        const { data: childSubjects, error: subjectsError } = await supabase
            .from('child_subjects')
            .select('id')
            .eq('child_id', childId);
        if (subjectsError || !childSubjects || childSubjects.length === 0) {
            return 'Unable to access student materials. Please check the student ID.';
        }
        const childSubjectIds = childSubjects.map(cs => cs.id);
        // Search for material by title or ID
        let materialQuery = supabase
            .from('materials')
            .select(`
        id, title, content_type, lesson_json, file_url, 
        original_filename, due_date, status, completed_at,
        grade_value, grade_max_value, grading_notes,
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
        // Try to match by ID first, then by title
        if (materialIdentifier.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
            materialQuery = materialQuery.eq('id', materialIdentifier);
        }
        else {
            materialQuery = materialQuery.ilike('title', `%${materialIdentifier}%`);
        }
        const { data: materials, error: materialError } = await materialQuery.limit(1).single();
        if (materialError || !materials) {
            return `Material "${materialIdentifier}" not found. Please check the title or ID.`;
        }
        const subjectName = materials.child_subject?.subject?.name ||
            materials.child_subject?.custom_subject_name_override || 'General';
        let result = [];
        result.push(`📚 **${materials.title}**`);
        result.push(`Subject: ${subjectName}`);
        result.push(`Type: ${materials.content_type || 'General Material'}`);
        if (materials.due_date) {
            result.push(`Due Date: ${materials.due_date}`);
        }
        if (materials.completed_at) {
            result.push(`✅ Completed: ${new Date(materials.completed_at).toLocaleDateString()}`);
        }
        if (materials.grade_value && materials.grade_max_value) {
            const percentage = Math.round((parseFloat(materials.grade_value) / parseFloat(materials.grade_max_value)) * 100);
            result.push(`Grade: ${materials.grade_value}/${materials.grade_max_value} (${percentage}%)`);
        }
        result.push('');
        // Parse and display lesson content
        if (materials.lesson_json) {
            const content = parseLessonContent(materials.lesson_json);
            if (content) {
                if (content.learning_objectives && content.learning_objectives.length > 0) {
                    result.push(`**Learning Objectives:**`);
                    content.learning_objectives.forEach((obj) => {
                        result.push(`- ${obj}`);
                    });
                    result.push('');
                }
                if (content.content_summary) {
                    result.push(`**Content Summary:**`);
                    result.push(content.content_summary);
                    result.push('');
                }
                if (content.keywords && content.keywords.length > 0) {
                    result.push(`**Key Concepts:**`);
                    result.push(content.keywords.join(', '));
                    result.push('');
                }
                if (content.formatted_questions && content.formatted_questions.length > 0) {
                    result.push(`**Practice Questions:**`);
                    content.formatted_questions.forEach((question) => {
                        result.push(`- ${question}`);
                    });
                    result.push('');
                }
            }
        }
        // Include parent material if exists
        if (materials.parent_material) {
            result.push(`**Related Material:** ${materials.parent_material.title}`);
            if (materials.parent_material.lesson_json) {
                const parentContent = parseLessonContent(materials.parent_material.lesson_json);
                if (parentContent?.content_summary) {
                    result.push(`Context: ${parentContent.content_summary}`);
                }
            }
        }
        // Include file URL if available
        if (materials.file_url) {
            result.push(`**Attached File:** ${materials.original_filename || 'Download available'}`);
        }
        if (materials.grading_notes) {
            result.push(`**Teacher Notes:** ${materials.grading_notes}`);
        }
        return result.join('\n');
    }
    catch (error) {
        console.error('❌ Error getting material content:', error);
        return `Error retrieving material content: ${error.message}`;
    }
}
// Get next homework assignment with full context
async function getNextHomework(childId, subject) {
    try {
        console.error(`📝 Getting next homework: childId=${childId}, subject=${subject || 'any'}`);
        // Get child's subjects
        const { data: childSubjects, error: subjectsError } = await supabase
            .from('child_subjects')
            .select('id, subject:subject_id(name), custom_subject_name_override')
            .eq('child_id', childId);
        if (subjectsError || !childSubjects || childSubjects.length === 0) {
            return 'Unable to access student subjects. Please check the student ID.';
        }
        let childSubjectIds = childSubjects.map(cs => cs.id);
        // Filter by subject if specified
        if (subject) {
            const filteredIds = childSubjects
                .filter(cs => (cs.subject?.name?.toLowerCase().includes(subject.toLowerCase())) ||
                (cs.custom_subject_name_override?.toLowerCase().includes(subject.toLowerCase())))
                .map(cs => cs.id);
            if (filteredIds.length === 0) {
                return `No ${subject} assignments found. Check if the subject name is correct.`;
            }
            childSubjectIds = filteredIds;
        }
        // Get next incomplete assignment
        const { data: homework, error: homeworkError } = await supabase
            .from('materials')
            .select(`
        id, title, content_type, due_date, lesson_json,
        child_subject:child_subject_id(
          subject:subject_id(name),
          custom_subject_name_override
        ),
        parent_material:parent_material_id(
          title, lesson_json
        )
      `)
            .in('child_subject_id', childSubjectIds)
            .in('content_type', ['assignment', 'worksheet', 'quiz', 'test'])
            .is('completed_at', null)
            .order('due_date', { ascending: true, nullsFirst: false })
            .limit(1)
            .single();
        if (homeworkError || !homework) {
            return subject ?
                `No pending ${subject} homework found. Great job staying on top of your work!` :
                'No pending homework found. Great job staying on top of your work!';
        }
        const subjectName = homework.child_subject?.subject?.name ||
            homework.child_subject?.custom_subject_name_override || 'General';
        let result = [];
        result.push(`📚 **Next Assignment: ${homework.title}**`);
        result.push(`Subject: ${subjectName}`);
        result.push(`Type: ${homework.content_type || 'Assignment'}`);
        if (homework.due_date) {
            const dueDate = new Date(homework.due_date);
            const today = new Date();
            const timeDiff = dueDate.getTime() - today.getTime();
            const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));
            if (daysDiff < 0) {
                result.push(`📅 **Scheduled earlier** - Was scheduled: ${homework.due_date}`);
            }
            else if (daysDiff === 0) {
                result.push(`⚠️ **DUE TODAY** - ${homework.due_date}`);
            }
            else if (daysDiff === 1) {
                result.push(`⏰ **DUE TOMORROW** - ${homework.due_date}`);
            }
            else {
                result.push(`📅 Due: ${homework.due_date} (in ${daysDiff} days)`);
            }
        }
        result.push('');
        // Add lesson content if available
        if (homework.lesson_json) {
            const content = parseLessonContent(homework.lesson_json);
            if (content) {
                if (content.learning_objectives && content.learning_objectives.length > 0) {
                    result.push(`**What you'll practice:**`);
                    content.learning_objectives.forEach((obj) => {
                        result.push(`- ${obj}`);
                    });
                    result.push('');
                }
                if (content.formatted_questions && content.formatted_questions.length > 0) {
                    result.push(`**Sample problems:**`);
                    content.formatted_questions.slice(0, 3).forEach((question) => {
                        result.push(`- ${question}`);
                    });
                    result.push('');
                }
            }
        }
        // Add parent material context
        if (homework.parent_material?.lesson_json) {
            const parentContent = parseLessonContent(homework.parent_material.lesson_json);
            if (parentContent?.content_summary) {
                result.push(`**Related lesson:** ${homework.parent_material.title}`);
                result.push(`**Review:** ${parentContent.content_summary}`);
            }
        }
        return result.join('\n');
    }
    catch (error) {
        console.error('❌ Error getting next homework:', error);
        return `Error retrieving homework: ${error.message}`;
    }
}
// Get comprehensive subject context
async function getSubjectContext(childId, subjectName) {
    try {
        console.error(`📖 Getting subject context: childId=${childId}, subject=${subjectName}`);
        // Get child's subjects
        const { data: childSubjects, error: subjectsError } = await supabase
            .from('child_subjects')
            .select('id, subject:subject_id(name), custom_subject_name_override')
            .eq('child_id', childId);
        if (subjectsError || !childSubjects || childSubjects.length === 0) {
            return 'Unable to access student subjects. Please check the student ID.';
        }
        // Find matching subject
        const matchingSubjects = childSubjects.filter(cs => (cs.subject?.name?.toLowerCase().includes(subjectName.toLowerCase())) ||
            (cs.custom_subject_name_override?.toLowerCase().includes(subjectName.toLowerCase())));
        if (matchingSubjects.length === 0) {
            const availableSubjects = childSubjects.map(cs => cs.subject?.name || cs.custom_subject_name_override).join(', ');
            return `Subject "${subjectName}" not found. Available subjects: ${availableSubjects}`;
        }
        const childSubjectIds = matchingSubjects.map(cs => cs.id);
        const actualSubjectName = matchingSubjects[0].subject?.name ||
            matchingSubjects[0].custom_subject_name_override || subjectName;
        let result = [];
        result.push(`📚 **${actualSubjectName} - Subject Overview**`);
        result.push('');
        // Get current incomplete work
        const incomplete = await findIncompleteAssignments(childSubjectIds);
        if (incomplete.length > 0) {
            result.push(`**📝 Current Work (${incomplete.length} items):**`);
            incomplete.slice(0, 5).forEach((item) => {
                const dueInfo = item.due_date ? ` - Due: ${item.due_date}` : '';
                result.push(`- ${item.title} [${item.content_type}]${dueInfo}`);
            });
            result.push('');
        }
        // Get recent grades
        const graded = await findGradedMaterialsBySubject(childSubjectIds);
        if (graded.length > 0) {
            result.push(`**📊 Recent Performance:**`);
            let totalEarned = 0;
            let totalPossible = 0;
            graded.slice(0, 5).forEach((item) => {
                const percentage = Math.round((item.grade_value / item.grade_max_value) * 100);
                const gradeEmoji = percentage >= 90 ? '🅰️' : percentage >= 80 ? '🅱️' : percentage >= 70 ? '🆔' : percentage >= 60 ? '🆘' : '❌';
                result.push(`- ${gradeEmoji} ${item.title}: ${percentage}%`);
                totalEarned += parseFloat(item.grade_value);
                totalPossible += parseFloat(item.grade_max_value);
            });
            if (totalPossible > 0) {
                const average = Math.round((totalEarned / totalPossible) * 100);
                const avgEmoji = average >= 90 ? '🅰️' : average >= 80 ? '🅱️' : average >= 70 ? '🆔' : average >= 60 ? '🆘' : '❌';
                result.push(`**Average:** ${avgEmoji} ${average}%`);
            }
            result.push('');
        }
        // Get current lessons
        const lessons = await getCurrentLessonsBySubject(childSubjectIds);
        if (lessons.length > 0) {
            result.push(`**📖 Current Lessons:**`);
            lessons.slice(0, 3).forEach((lesson) => {
                result.push(`- **${lesson.title}**`);
                if (lesson.parsed_content?.learning_objectives) {
                    result.push(`  Focus: ${lesson.parsed_content.learning_objectives.slice(0, 2).join(', ')}`);
                }
            });
            result.push('');
        }
        // Get upcoming assessments
        const tests = await findUpcomingAssessmentsBySubject(childSubjectIds);
        if (tests.length > 0) {
            result.push(`**📝 Upcoming Tests/Quizzes:**`);
            tests.forEach((test) => {
                const type = test.content_type === 'test' ? '📋 Test' : '❓ Quiz';
                const dueInfo = test.due_date ? ` - ${test.due_date}` : '';
                result.push(`- ${type}: ${test.title}${dueInfo}`);
            });
        }
        return result.join('\n');
    }
    catch (error) {
        console.error('❌ Error getting subject context:', error);
        return `Error retrieving subject context: ${error.message}`;
    }
}
// Get student learning profile
async function getStudentProfile(childId) {
    try {
        console.error(`👤 Getting student profile: childId=${childId}`);
        // Get basic child info
        const { data: child, error: childError } = await supabase
            .from('children')
            .select('name, grade, current_streak, best_streak, lifetime_correct, weekly_correct')
            .eq('id', childId)
            .single();
        if (childError || !child) {
            return 'Student profile not found. Please check the student ID.';
        }
        let result = [];
        result.push(`👤 **${child.name}'s Learning Profile**`);
        if (child.grade) {
            result.push(`Grade: ${child.grade}`);
        }
        result.push('');
        // Get learning profile
        const { data: profile, error: profileError } = await supabase
            .from('child_learning_profiles')
            .select('*')
            .eq('child_id', childId)
            .single();
        if (!profileError && profile) {
            result.push(`**🎯 Learning Stats:**`);
            result.push(`- Days learning together: ${profile.days_together || 0}`);
            result.push(`- Total interactions: ${profile.total_interactions || 0}`);
            result.push(`- Current streak: ${child.current_streak || 0} correct`);
            result.push(`- Best streak: ${child.best_streak || 0} correct`);
            result.push(`- Lifetime correct: ${child.lifetime_correct || 0}`);
            result.push('');
            result.push(`**📚 Learning Preferences:**`);
            result.push(`- Explanation style: ${profile.preferred_explanation_style || 'step_by_step'}`);
            result.push(`- Learning pace: ${profile.learning_pace || 'moderate'}`);
            result.push(`- Confidence level: ${profile.confidence_level || 'building'}`);
            if (profile.common_difficulties && profile.common_difficulties.length > 0) {
                result.push(`- Common challenges: ${profile.common_difficulties.join(', ')}`);
            }
            if (profile.engagement_triggers && profile.engagement_triggers.length > 0) {
                result.push(`- What motivates: ${profile.engagement_triggers.join(', ')}`);
            }
            result.push('');
        }
        // Get schedule preferences
        const { data: schedule, error: scheduleError } = await supabase
            .from('child_schedule_preferences')
            .select('*')
            .eq('child_id', childId)
            .single();
        if (!scheduleError && schedule) {
            result.push(`**⏰ Study Preferences:**`);
            result.push(`- Preferred study time: ${schedule.preferred_start_time} - ${schedule.preferred_end_time}`);
            result.push(`- Max daily study: ${schedule.max_daily_study_minutes} minutes`);
            result.push(`- Break duration: ${schedule.break_duration_minutes} minutes`);
            result.push(`- Difficult subjects in morning: ${schedule.difficult_subjects_morning ? 'Yes' : 'No'}`);
            if (schedule.study_days) {
                const days = Array.isArray(schedule.study_days) ? schedule.study_days : JSON.parse(schedule.study_days);
                result.push(`- Study days: ${days.join(', ')}`);
            }
            result.push('');
        }
        // Get recent learning memories
        const { data: memories, error: memoriesError } = await supabase
            .from('child_learning_memories')
            .select('memory_type, subject, topic, confidence_score, session_count')
            .eq('child_id', childId)
            .order('last_reinforced', { ascending: false })
            .limit(5);
        if (!memoriesError && memories && memories.length > 0) {
            result.push(`**🧠 Recent Learning Areas:**`);
            memories.forEach((memory) => {
                const confidence = Math.round(memory.confidence_score * 100);
                const confidenceEmoji = confidence >= 80 ? '🟢' : confidence >= 60 ? '🟡' : '🔴';
                result.push(`- ${confidenceEmoji} ${memory.subject || 'General'}: ${memory.topic} (${confidence}% confidence, ${memory.session_count} sessions)`);
            });
        }
        return result.join('\n');
    }
    catch (error) {
        console.error('❌ Error getting student profile:', error);
        return `Error retrieving student profile: ${error.message}`;
    }
}
// Helper functions for new search types
async function getNextHomeworkDetails(childSubjectIds) {
    const { data: homework, error } = await supabase
        .from('materials')
        .select(`
      id, title, content_type, due_date, lesson_json,
      child_subject:child_subject_id(
        subject:subject_id(name),
        custom_subject_name_override
      )
    `)
        .in('child_subject_id', childSubjectIds)
        .in('content_type', ['assignment', 'worksheet', 'quiz', 'test'])
        .is('completed_at', null)
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(1)
        .single();
    if (error || !homework)
        return null;
    const subjectName = homework.child_subject?.subject?.name ||
        homework.child_subject?.custom_subject_name_override || 'General';
    let result = `**${homework.title}** (${subjectName}) [${homework.content_type}]`;
    if (homework.due_date) {
        const dueDate = new Date(homework.due_date);
        const today = new Date();
        const timeDiff = dueDate.getTime() - today.getTime();
        const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));
        if (daysDiff < 0) {
            result += ` 📅 (scheduled earlier)`;
        }
        else if (daysDiff === 0) {
            result += ` ⚠️ DUE TODAY`;
        }
        else if (daysDiff === 1) {
            result += ` ⏰ DUE TOMORROW`;
        }
        else {
            result += ` - Due in ${daysDiff} days`;
        }
    }
    return result;
}
async function getSubjectMaterials(childSubjectIds, query) {
    // This would be enhanced to parse the query for subject names
    return 'Subject-specific search functionality coming soon. Use get_subject_context for detailed subject information.';
}
async function getReviewMaterials(childSubjectIds) {
    const { data, error } = await supabase
        .from('materials')
        .select(`
      id, title, grade_value, grade_max_value, content_type,
      child_subject:child_subject_id(
        subject:subject_id(name),
        custom_subject_name_override
      )
    `)
        .in('child_subject_id', childSubjectIds)
        .not('grade_value', 'is', null)
        .not('grade_max_value', 'is', null)
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(10);
    if (error)
        return [];
    // Filter for lower grades (< 80%)
    return (data || []).filter((item) => {
        const percentage = (item.grade_value / item.grade_max_value) * 100;
        return percentage < 80;
    });
}
async function findUpcomingAssessments(childSubjectIds) {
    const { data, error } = await supabase
        .from('materials')
        .select(`
      id, title, due_date, content_type,
      child_subject:child_subject_id(
        subject:subject_id(name),
        custom_subject_name_override
      )
    `)
        .in('child_subject_id', childSubjectIds)
        .in('content_type', ['test', 'quiz'])
        .is('completed_at', null)
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(5);
    return data || [];
}
async function findUpcomingAssessmentsBySubject(childSubjectIds) {
    return findUpcomingAssessments(childSubjectIds);
}
async function getCurrentLessons(childSubjectIds) {
    const { data, error } = await supabase
        .from('materials')
        .select(`
      id, title, lesson_json,
      child_subject:child_subject_id(
        subject:subject_id(name),
        custom_subject_name_override
      )
    `)
        .in('child_subject_id', childSubjectIds)
        .eq('content_type', 'lesson')
        .order('created_at', { ascending: false })
        .limit(5);
    if (error)
        return [];
    return (data || []).map(lesson => ({
        ...lesson,
        parsed_content: parseLessonContent(lesson.lesson_json)
    }));
}
async function getCurrentLessonsBySubject(childSubjectIds) {
    return getCurrentLessons(childSubjectIds);
}
async function findGradedMaterialsBySubject(childSubjectIds) {
    const { data, error } = await supabase
        .from('materials')
        .select(`
      id, title, grade_value, grade_max_value, completed_at, content_type
    `)
        .in('child_subject_id', childSubjectIds)
        .not('grade_value', 'is', null)
        .not('grade_max_value', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(10);
    return data || [];
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
//# sourceMappingURL=server.js.map
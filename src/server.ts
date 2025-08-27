#!/usr/bin/env node

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import cors from 'cors';

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

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control']
}));
app.use(express.json());

// ===============================
// HELPER FUNCTIONS
// ===============================

async function getChildSubjects(childId: string) {
  const { data, error } = await supabase
    .from('child_subjects')
    .select('id')
    .eq('child_id', childId);
  
  if (error) throw error;
  return (data || []).map(cs => cs.id);
}

// formatDueDate function removed - dates are teacher planning, not student deadlines

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
// TOOL HANDLERS
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
    
    // Due dates removed - not relevant for student tutoring
    
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
// HTTP ENDPOINTS
// ===============================

app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'ai-tutor-mcp-server'
  });
});

app.post('/tool', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tool, arguments: args } = req.body;

    if (!tool || !args || !args.child_id) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }

    let result: string;
    const childId = args.child_id;

    switch (tool) {
      case 'search_lessons':
        result = await handleSearchLessons(childId, args.query);
        break;
      
      case 'search_student_work':
        result = await handleSearchStudentWork(childId, args.query, {
          status: args.status,
          subject: args.subject,
          content_type: args.content_type,
          low_scores: args.low_scores
        });
        break;
      
      case 'get_material_details':
        result = await handleGetMaterialDetails(childId, args.material_identifier);
        break;
      
      default:
        res.status(400).json({ error: `Unknown tool: ${tool}` });
        return;
    }

    res.json({ result });
    return;

  } catch (error: any) {
    console.error('❌ Tool error:', error);
    res.status(500).json({ error: error.message });
    return;
  }
});

// SSE endpoint for GPT-5 MCP integration
app.get('/sse', async (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  // Send initial connection event
  res.write('event: connected\n');
  res.write('data: {"type": "connected"}\n\n');

  // Handle tool list request
  const toolsList = {
    tools: [
      {
        name: 'search_lessons',
        description: 'Search for educational lessons and teaching materials',
        input_schema: {
          type: 'object',
          properties: {
            child_id: { type: 'string', description: 'Child ID for context' },
            query: { type: 'string', description: 'Search query for lessons' }
          },
          required: ['child_id']
        }
      },
      {
        name: 'search_student_work',
        description: 'Search student assignments, homework, and completed work',
        input_schema: {
          type: 'object',
          properties: {
            child_id: { type: 'string', description: 'Child ID for context' },
            query: { type: 'string', description: 'Search query for work' },
            status: { type: 'string', enum: ['incomplete', 'completed', 'all'], description: 'Filter by completion status' },
            subject: { type: 'string', description: 'Filter by subject' },
            low_scores: { type: 'boolean', description: 'Include work with low scores for review' }
          },
          required: ['child_id']
        }
      },
      {
        name: 'get_material_details',
        description: 'Get detailed content for a specific educational material including worksheets, tests, and assignments with all questions',
        input_schema: {
          type: 'object',
          properties: {
            child_id: { type: 'string', description: 'Child ID for context' },
            material_identifier: { type: 'string', description: 'Name or ID of the material to retrieve (e.g., "America: Land I Love - Test 1")' }
          },
          required: ['child_id', 'material_identifier']
        }
      }
    ]
  };

  // Send tools list
  res.write('event: tools\n');
  res.write(`data: ${JSON.stringify(toolsList)}\n\n`);

  // Keep connection alive and handle requests
  const keepAlive = setInterval(() => {
    res.write('event: ping\n');
    res.write('data: {"type": "ping"}\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(keepAlive);
    res.end();
  });

  req.on('error', () => {
    clearInterval(keepAlive);
    res.end();
  });
});

// Handle tool execution via POST for SSE
app.post('/sse/tool', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, arguments: args } = req.body;

    if (!name || !args || !args.child_id) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }

    let result: string;
    const childId = args.child_id;

    switch (name) {
      case 'search_lessons':
        result = await handleSearchLessons(childId, args.query);
        break;
      
      case 'search_student_work':
        result = await handleSearchStudentWork(childId, args.query, {
          status: args.status,
          subject: args.subject,
          content_type: args.content_type,
          low_scores: args.low_scores
        });
        break;
      
      case 'get_material_details':
        result = await handleGetMaterialDetails(childId, args.material_identifier);
        break;
      
      default:
        res.status(400).json({ error: `Unknown tool: ${name}` });
        return;
    }

    res.json({ content: [{ type: 'text', text: result }] });
    return;
  } catch (error: any) {
    console.error(`❌ SSE tool execution error:`, error);
    res.status(500).json({ error: `Tool execution failed: ${error.message}` });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 AI Tutor MCP server running on port ${PORT}`);
  console.log(`📡 SSE endpoint available at: http://localhost:${PORT}/sse`);
});
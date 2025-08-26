#!/usr/bin/env node

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import cors from 'cors';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PORT = process.env.PORT || 3000;

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

function formatDueDate(dueDate: string | null): string {
  if (!dueDate) return '';
  
  const due = new Date(dueDate);
  const today = new Date();
  const daysDiff = Math.ceil((due.getTime() - today.getTime()) / (1000 * 3600 * 24));
  
  if (daysDiff < 0) return ' 🚨 **OVERDUE**';
  if (daysDiff === 0) return ' ⚠️ **DUE TODAY**';
  if (daysDiff === 1) return ' ⏰ **DUE TOMORROW**';
  if (daysDiff <= 7) return ` ⏰ Due in ${daysDiff} days`;
  return ` 📅 Due ${dueDate}`;
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
        grade_value, grade_max_value, grading_notes,
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
        const dueInfo = formatDueDate(item.due_date);
        
        results.push(`• **${item.title}** [${item.content_type}] (${subjectName})${dueInfo}`);
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

// Start server
app.listen(PORT, () => {
  console.log(`🚀 AI Tutor MCP server running on port ${PORT}`);
});
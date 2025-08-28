#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import express from 'express';
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
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});
// ===============================
// HELPER FUNCTIONS (PRESERVED)
// ===============================
async function getChildSubjects(childId) {
    console.log('🆔 getChildSubjects called with child_id:', childId);
    console.log('🆔 child_id type:', typeof childId, 'length:', childId.length);
    const { data, error } = await supabase
        .from('child_subjects')
        .select('id')
        .eq('child_id', childId);
    console.log('📊 Database query: child_subjects.child_id =', childId);
    if (error) {
        console.error('❌ getChildSubjects database error:', error);
        throw error;
    }
    const childSubjectIds = (data || []).map(cs => cs.id);
    console.log('📊 getChildSubjects returned', data?.length || 0, 'child_subjects for child_id:', childId);
    console.log('🆔 Child subject IDs:', childSubjectIds);
    if (!data || data.length === 0) {
        console.warn('⚠️ No child_subjects found for child_id:', childId, '- this may indicate an invalid child_id');
    }
    return childSubjectIds;
}
function formatGrade(gradeValue, gradeMaxValue) {
    if (!gradeValue || !gradeMaxValue)
        return '';
    const percentage = Math.round((gradeValue / gradeMaxValue) * 100);
    let gradeEmoji = '';
    if (percentage >= 90)
        gradeEmoji = '🅰️';
    else if (percentage >= 80)
        gradeEmoji = '🅱️';
    else if (percentage >= 70)
        gradeEmoji = '🆔';
    else if (percentage >= 60)
        gradeEmoji = '🆘';
    else
        gradeEmoji = '❌';
    return ` ${gradeEmoji} ${percentage}%`;
}
// ===============================
// TOOL HANDLERS (PRESERVED LOGIC)
// ===============================
async function handleSearchLessons(childId, query = '') {
    try {
        console.log('📚 handleSearchLessons called - child_id:', childId, 'query:', query);
        const childSubjectIds = await getChildSubjects(childId);
        console.log('📊 handleSearchLessons received childSubjectIds:', childSubjectIds.length, 'items');
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
        if (error)
            throw error;
        if (!data || data.length === 0) {
            return query ?
                `No lessons found matching "${query}". Try searching for a topic, unit name, or lesson number.` :
                'No lesson content found.';
        }
        const results = ['📚 **Teaching Materials Found:**', ''];
        data.forEach(item => {
            const subjectName = item.child_subject?.custom_subject_name_override ||
                item.child_subject?.subject?.name || 'General';
            results.push(`**${item.title}** (${subjectName})`);
            // Parse lesson content for key information
            if (item.lesson_json) {
                try {
                    const lessonData = typeof item.lesson_json === 'string' ?
                        JSON.parse(item.lesson_json) : item.lesson_json;
                    if (lessonData.learning_objectives && lessonData.learning_objectives.length > 0) {
                        results.push('**Learning Objectives:**');
                        lessonData.learning_objectives.slice(0, 3).forEach((obj) => {
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
                        lessonData.tasks_or_questions.slice(0, 3).forEach((question) => {
                            results.push(`• ${question}`);
                        });
                    }
                }
                catch (e) {
                    // Skip parsing errors
                }
            }
            results.push('---');
        });
        return results.join('\n');
    }
    catch (error) {
        console.error('❌ Search lessons error:', error);
        return `Error searching lessons: ${error.message}`;
    }
}
async function handleSearchStudentWork(childId, query = '', filters = {}) {
    try {
        console.log('📝 handleSearchStudentWork called - child_id:', childId, 'query:', query, 'filters:', JSON.stringify(filters));
        const childSubjectIds = await getChildSubjects(childId);
        console.log('📊 handleSearchStudentWork received childSubjectIds:', childSubjectIds.length, 'items');
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
            .in('content_type', ['assignment', 'worksheet', 'quiz', 'test', 'review']);
        // Apply text search
        if (query.trim()) {
            dbQuery = dbQuery.ilike('title', `%${query}%`);
        }
        // Apply status filters
        if (filters.status === 'incomplete') {
            dbQuery = dbQuery.is('completed_at', null);
        }
        else if (filters.status === 'completed') {
            dbQuery = dbQuery.not('completed_at', 'is', null);
        }
        else if (filters.status === 'overdue') {
            const today = new Date().toISOString().split('T')[0];
            dbQuery = dbQuery.is('completed_at', null).lt('due_date', today);
        }
        else if (filters.status === 'due_soon') {
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
        console.log('🔍 About to execute materials query with child_subject_ids:', childSubjectIds);
        console.log('🔍 Query filters - status:', filters.status, 'content_type:', filters.content_type);
        const { data, error } = await dbQuery;
        console.log('📊 Materials query result - data count:', data?.length || 0, 'error:', error?.message || 'none');
        if (error) {
            console.error('❌ Materials query error:', error);
            throw error;
        }
        let materials = data || [];
        // Apply low scores filter after fetching
        if (filters.low_scores) {
            materials = materials.filter(m => {
                if (!m.grade_value || !m.grade_max_value)
                    return false;
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
                const subjectName = item.child_subject?.custom_subject_name_override ||
                    item.child_subject?.subject?.name || 'General';
                results.push(`• **${item.title}** [${item.content_type}] (${subjectName})`);
            });
            results.push('');
        }
        if (completed.length > 0) {
            results.push(`**✅ Completed Work (${completed.length}):**`);
            completed.forEach(item => {
                const subjectName = item.child_subject?.custom_subject_name_override ||
                    item.child_subject?.subject?.name || 'General';
                const gradeInfo = formatGrade(item.grade_value, item.grade_max_value);
                results.push(`• **${item.title}** [${item.content_type}] (${subjectName})${gradeInfo}`);
            });
        }
        return results.join('\n');
    }
    catch (error) {
        console.error('❌ Search student work error:', error);
        return `Error searching student work: ${error.message}`;
    }
}
async function handleGetMaterialDetails(childId, materialIdentifier) {
    try {
        console.log('🔍 handleGetMaterialDetails called - child_id:', childId, 'material_identifier:', materialIdentifier);
        const childSubjectIds = await getChildSubjects(childId);
        console.log('📊 handleGetMaterialDetails received childSubjectIds:', childSubjectIds.length, 'items');
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
        }
        else {
            // More flexible title matching
            dbQuery = dbQuery.ilike('title', `%${materialIdentifier}%`);
        }
        const { data, error } = await dbQuery.limit(1).single();
        if (error || !data) {
            return `Material "${materialIdentifier}" not found. Please check the title or ID.`;
        }
        const subjectName = data.child_subject?.custom_subject_name_override ||
            data.child_subject?.subject?.name || 'General';
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
                lessonData.learning_objectives.forEach((obj) => {
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
                lessonData.worksheet_questions.forEach((q) => {
                    results.push(`${q.question_number}. ${q.question_text}`);
                });
                results.push('');
            }
            else if (lessonData.tasks_or_questions && lessonData.tasks_or_questions.length > 0) {
                results.push(`**All Questions/Tasks:**`);
                lessonData.tasks_or_questions.forEach((question, index) => {
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
        if (data.parent_material && data.parent_material.lesson_json) {
            results.push(`**Related Lesson:** ${data.parent_material.title}`);
            try {
                const parentLessonData = typeof data.parent_material.lesson_json === 'string' ?
                    JSON.parse(data.parent_material.lesson_json) : data.parent_material.lesson_json;
                if (parentLessonData.main_content_summary_or_extract) {
                    results.push(`**Lesson Context:** ${parentLessonData.main_content_summary_or_extract.slice(0, 300)}...`);
                }
            }
            catch (e) {
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
            }
            catch (e) {
                // Fall back to text format if JSON parsing fails
            }
        }
        return results.join('\n');
    }
    catch (error) {
        console.error('❌ Error getting material details:', error);
        return `Error retrieving material details: ${error.message}`;
    }
}
// ===============================
// OPENAI FORMAT HELPER FUNCTIONS
// ===============================
function formatCompleteEducationalContent(material) {
    const sections = [];
    // Header information
    sections.push(`📚 ${material.title}`);
    sections.push(`Grade: ${material.grade_level_suggestion || 'N/A'} | Type: ${material.content_type_suggestion || material.content_type}`);
    // Add completion status if it's student work
    if (material.content_type && ['assignment', 'worksheet', 'quiz', 'test'].includes(material.content_type)) {
        if (material.completed_at) {
            const gradeInfo = formatGrade(material.grade_value, material.grade_max_value);
            sections.push(`✅ Completed: ${new Date(material.completed_at).toLocaleDateString()}${gradeInfo}`);
        }
        else {
            sections.push(`📋 Status: Incomplete`);
        }
    }
    sections.push('');
    // Learning Objectives
    if (material.learning_objectives && material.learning_objectives.length > 0) {
        sections.push('🎯 LEARNING OBJECTIVES:');
        material.learning_objectives.forEach((obj) => sections.push(`• ${obj}`));
        sections.push('');
    }
    // Main Content Summary
    if (material.main_content_summary_or_extract) {
        sections.push('📖 LESSON CONTENT:');
        sections.push(material.main_content_summary_or_extract);
        sections.push('');
    }
    // Key Topics/Keywords
    if (material.subject_keywords_or_subtopics && material.subject_keywords_or_subtopics.length > 0) {
        sections.push('🔑 KEY TOPICS:');
        sections.push(material.subject_keywords_or_subtopics.join(', '));
        sections.push('');
    }
    // All Questions with Answers (for worksheets/assignments)
    if (material.worksheet_questions && material.worksheet_questions.length > 0) {
        sections.push('📝 QUESTIONS AND ANSWERS:');
        material.worksheet_questions.forEach((q) => {
            sections.push(`\nQuestion ${q.question_number}: ${q.question_text}`);
            if (material.answer_key && material.answer_key[q.question_number]) {
                sections.push(`✓ Answer: ${material.answer_key[q.question_number]}`);
            }
            // Add any problem context from problems_with_context
            const problemContext = material.problems_with_context?.find((p) => p.problem_number === q.question_number);
            if (problemContext) {
                if (problemContext.solution_hint) {
                    sections.push(`💡 Hint: ${problemContext.solution_hint}`);
                }
                if (problemContext.concepts && problemContext.concepts.length > 0) {
                    sections.push(`🧠 Concepts: ${problemContext.concepts.join(', ')}`);
                }
            }
        });
        sections.push('');
    }
    else if (material.tasks_or_questions && material.tasks_or_questions.length > 0) {
        // Handle lesson tasks/questions format
        sections.push('📝 PRACTICE PROBLEMS:');
        material.tasks_or_questions.forEach((question, index) => {
            const questionNum = (index + 1).toString();
            sections.push(`\n${questionNum}. ${question}`);
            if (material.answer_key && material.answer_key[questionNum]) {
                sections.push(`✓ Answer: ${material.answer_key[questionNum]}`);
            }
        });
        sections.push('');
    }
    // Include answer key for completed work or lesson materials
    if (material.answer_key && (material.completed_at || material.content_type === 'lesson')) {
        sections.push('🔢 COMPLETE ANSWER KEY:');
        Object.entries(material.answer_key).forEach(([key, value]) => {
            sections.push(`${key}: ${value}`);
        });
        sections.push('');
    }
    // Teaching Methodology
    if (material.teaching_methodology) {
        sections.push('👩‍🏫 TEACHING APPROACH:');
        sections.push(material.teaching_methodology);
        sections.push('');
    }
    // Common Mistakes
    if (material.common_mistakes && material.common_mistakes.length > 0) {
        sections.push('⚠️ COMMON STUDENT MISTAKES:');
        material.common_mistakes.forEach((mistake) => sections.push(`• ${mistake}`));
        sections.push('');
    }
    // Prerequisites
    if (material.prerequisites && material.prerequisites.length > 0) {
        sections.push('📚 PREREQUISITES:');
        material.prerequisites.forEach((req) => sections.push(`• ${req}`));
        sections.push('');
    }
    // Visual content descriptions
    if (material.visual_content_descriptions && material.visual_content_descriptions.length > 0) {
        sections.push('🖼️ VISUAL ELEMENTS:');
        material.visual_content_descriptions.forEach((desc) => sections.push(`• ${desc}`));
        sections.push('');
    }
    // Assignment metadata for worksheets/tests
    if (material.assignment_metadata) {
        const metadata = material.assignment_metadata;
        if (metadata.total_points) {
            sections.push(`📊 Total Points: ${metadata.total_points}`);
        }
        if (metadata.estimated_time_minutes) {
            sections.push(`⏱️ Estimated Time: ${metadata.estimated_time_minutes} minutes`);
        }
        if (metadata.difficulty_level) {
            sections.push(`📈 Difficulty: ${metadata.difficulty_level}`);
        }
        if (metadata.key_terms && metadata.key_terms.length > 0) {
            sections.push(`📖 Key Terms: ${metadata.key_terms.join(', ')}`);
        }
    }
    else if (material.estimated_completion_time_minutes) {
        sections.push(`⏱️ Estimated Time: ${material.estimated_completion_time_minutes} minutes`);
    }
    // Include parent lesson context if this is an assignment/worksheet
    if (material.parent_material && material.parent_material.lesson_json) {
        sections.push(`🔗 RELATED LESSON: ${material.parent_material.title}`);
        try {
            const parentLessonData = typeof material.parent_material.lesson_json === 'string' ?
                JSON.parse(material.parent_material.lesson_json) : material.parent_material.lesson_json;
            if (parentLessonData.main_content_summary_or_extract) {
                sections.push(`📖 Lesson Context: ${parentLessonData.main_content_summary_or_extract.slice(0, 300)}...`);
            }
        }
        catch (e) {
            // Skip parsing errors
        }
        sections.push('');
    }
    // Teacher grading notes
    if (material.grading_notes) {
        sections.push(`📝 TEACHER NOTES: ${material.grading_notes}`);
    }
    return sections.join('\n');
}
// ===============================
// MCP SERVER INITIALIZATION
// ===============================
function createMcpServer() {
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
    mcpServer.tool('search', 'Search for educational content including assignments, lessons, and materials', {
        query: z.string().describe('Search query for educational content')
    }, async ({ query }) => {
        try {
            console.log('🔍 MCP Search Tool Called with query:', JSON.stringify(query));
            // Extract child_id from the query if it starts with it
            // Format: "child_id:UUID query text" or fallback to default
            let childId = '058a3da2-0268-4d8c-995a-c732cd1b732a'; // Default child for testing
            let searchQuery = query;
            if (query.startsWith('child_id:')) {
                const parts = query.split(' ');
                childId = parts[0].replace('child_id:', '');
                searchQuery = parts.slice(1).join(' ');
                console.log('🆔 Extracted child_id:', childId, 'search_query:', searchQuery);
            }
            else {
                console.log('⚠️ No child_id prefix found, using default:', childId, 'full query:', query);
            }
            const childSubjectIds = await getChildSubjects(childId);
            console.log('📊 Search tool received childSubjectIds:', childSubjectIds.length, 'items:', childSubjectIds);
            const results = [];
            // Search student work (assignments, worksheets, quizzes, tests)
            let workQuery = supabase
                .from('materials')
                .select(`
            id, title, content_type, due_date, completed_at, 
            grade_value, grade_max_value, lesson_json, main_content_summary_or_extract,
            child_subject:child_subject_id(
              subject:subject_id(name),
              custom_subject_name_override
            )
          `)
                .in('child_subject_id', childSubjectIds)
                .in('content_type', ['assignment', 'worksheet', 'quiz', 'test', 'review']);
            if (searchQuery.trim()) {
                workQuery = workQuery.ilike('title', `%${searchQuery}%`);
            }
            console.log('📊 Executing student work query with childSubjectIds:', childSubjectIds);
            const { data: workData } = await workQuery.order('due_date', { ascending: true, nullsFirst: false }).limit(15);
            console.log('📊 Search found', workData?.length || 0, 'student work items');
            if (workData) {
                workData.forEach(item => {
                    const subjectName = item.child_subject?.custom_subject_name_override ||
                        item.child_subject?.subject?.name || 'General';
                    // Create preview text with rich information
                    const statusInfo = item.completed_at ?
                        `✅ Completed${formatGrade(item.grade_value, item.grade_max_value)}` :
                        '📋 Incomplete';
                    const previewText = item.main_content_summary_or_extract ||
                        (item.lesson_json ? JSON.parse(item.lesson_json).main_content_summary_or_extract : '') ||
                        'Educational material';
                    const snippet = `${item.content_type.toUpperCase()} | ${subjectName} | ${statusInfo} | ${previewText.substring(0, 150)}...`;
                    results.push({
                        id: item.id,
                        title: item.title,
                        text: snippet,
                        url: `internal://materials/${item.id}`
                    });
                });
            }
            // Search lessons and teaching materials
            let lessonQuery = supabase
                .from('materials')
                .select(`
            id, title, content_type, lesson_json, main_content_summary_or_extract,
            child_subject:child_subject_id(
              subject:subject_id(name),
              custom_subject_name_override
            )
          `)
                .in('child_subject_id', childSubjectIds)
                .or('content_type.in.(lesson,reading,chapter),is_primary_lesson.eq.true');
            if (searchQuery.trim()) {
                lessonQuery = lessonQuery.ilike('title', `%${searchQuery}%`);
            }
            console.log('📊 Executing lesson query with childSubjectIds:', childSubjectIds);
            const { data: lessonData } = await lessonQuery.order('title', { ascending: true }).limit(15);
            console.log('📚 Search found', lessonData?.length || 0, 'lesson items');
            if (lessonData) {
                lessonData.forEach(item => {
                    const subjectName = item.child_subject?.custom_subject_name_override ||
                        item.child_subject?.subject?.name || 'General';
                    let lessonInfo = '';
                    if (item.lesson_json) {
                        try {
                            const lessonData = typeof item.lesson_json === 'string' ?
                                JSON.parse(item.lesson_json) : item.lesson_json;
                            const objectives = lessonData.learning_objectives?.slice(0, 2).join(', ') || 'N/A';
                            const topics = lessonData.subject_keywords_or_subtopics?.slice(0, 3).join(', ') || 'N/A';
                            lessonInfo = `Objectives: ${objectives} | Topics: ${topics}`;
                        }
                        catch (e) {
                            lessonInfo = 'Teaching material';
                        }
                    }
                    const snippet = `LESSON | ${subjectName} | ${lessonInfo} | ${(item.main_content_summary_or_extract || '').substring(0, 100)}...`;
                    results.push({
                        id: item.id,
                        title: item.title,
                        text: snippet,
                        url: `internal://materials/${item.id}`
                    });
                });
            }
            // Return structured OpenAI-compatible response
            const searchResults = { results };
            console.log('🎯 Returning search results:', results.length, 'total items');
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(searchResults)
                    }]
            };
        }
        catch (error) {
            console.error('❌ Search tool error:', error);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            results: [],
                            error: `Search failed: ${error.message}`
                        })
                    }]
            };
        }
    });
    // Register fetch tool (OpenAI standard - required for GPT-5 integration)
    mcpServer.tool('fetch', 'Fetch complete details for a specific educational material by ID or title', {
        id: z.string().describe('Material ID or title to fetch complete content for')
    }, async ({ id }) => {
        try {
            console.log('📚 MCP Fetch Tool Called with id:', JSON.stringify(id));
            // Extract child_id from the id if it starts with it
            let childId = '058a3da2-0268-4d8c-995a-c732cd1b732a'; // Default child for testing
            let materialId = id;
            if (id.startsWith('child_id:')) {
                const parts = id.split('|');
                childId = parts[0].replace('child_id:', '');
                materialId = parts[1] || id;
                console.log('🆔 Extracted child_id from fetch id:', childId, 'material_id:', materialId);
            }
            else {
                console.log('⚠️ No child_id prefix found in fetch, using default:', childId, 'material_id:', materialId);
            }
            const childSubjectIds = await getChildSubjects(childId);
            console.log('📊 Fetch tool received childSubjectIds:', childSubjectIds.length, 'items:', childSubjectIds);
            let dbQuery = supabase
                .from('materials')
                .select(`
            id, title, content_type, due_date, completed_at,
            grade_value, grade_max_value, grading_notes, lesson_json,
            parent_material_id, is_primary_lesson, main_content_summary_or_extract,
            learning_objectives, subject_keywords_or_subtopics, tasks_or_questions,
            worksheet_questions, assignment_metadata, teaching_methodology,
            prerequisites, common_mistakes, answer_key, visual_content_descriptions,
            estimated_completion_time_minutes, grade_level_suggestion, content_type_suggestion,
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
            if (materialId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
                console.log('📊 Searching by UUID:', materialId);
                dbQuery = dbQuery.eq('id', materialId);
            }
            else {
                console.log('📊 Searching by title pattern:', materialId);
                dbQuery = dbQuery.ilike('title', `%${materialId}%`);
            }
            console.log('📊 Executing fetch query with childSubjectIds:', childSubjectIds);
            const { data, error } = await dbQuery.limit(1).single();
            if (error) {
                console.error('❌ Fetch database error:', error);
            }
            else if (data) {
                console.log('✅ Fetch found material:', data.title, 'type:', data.content_type);
            }
            else {
                console.warn('⚠️ Fetch found no material for identifier:', materialId);
            }
            if (error || !data) {
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify({
                                id: materialId,
                                title: 'Not Found',
                                text: `Material "${materialId}" not found. Please check the title or ID.`,
                                url: `internal://materials/${materialId}`,
                                metadata: { error: 'Material not found' }
                            })
                        }]
                };
            }
            const subjectName = data.child_subject?.custom_subject_name_override ||
                data.child_subject?.subject?.name || 'General';
            // Parse lesson_json if it exists
            let parsedLessonData = null;
            if (data.lesson_json) {
                try {
                    parsedLessonData = typeof data.lesson_json === 'string' ?
                        JSON.parse(data.lesson_json) : data.lesson_json;
                    // Merge parsed data with main data
                    if (parsedLessonData) {
                        data.learning_objectives = data.learning_objectives || parsedLessonData.learning_objectives;
                        data.subject_keywords_or_subtopics = data.subject_keywords_or_subtopics || parsedLessonData.subject_keywords_or_subtopics;
                        data.tasks_or_questions = data.tasks_or_questions || parsedLessonData.tasks_or_questions;
                        data.worksheet_questions = data.worksheet_questions || parsedLessonData.worksheet_questions;
                        data.assignment_metadata = data.assignment_metadata || parsedLessonData.assignment_metadata;
                        data.teaching_methodology = data.teaching_methodology || parsedLessonData.teaching_methodology;
                        data.prerequisites = data.prerequisites || parsedLessonData.prerequisites;
                        data.common_mistakes = data.common_mistakes || parsedLessonData.common_mistakes;
                        data.answer_key = data.answer_key || parsedLessonData.answer_key;
                        data.visual_content_descriptions = data.visual_content_descriptions || parsedLessonData.visual_content_descriptions;
                        data.main_content_summary_or_extract = data.main_content_summary_or_extract || parsedLessonData.main_content_summary_or_extract;
                        data.estimated_completion_time_minutes = data.estimated_completion_time_minutes || parsedLessonData.estimated_completion_time_minutes;
                        data.grade_level_suggestion = data.grade_level_suggestion || parsedLessonData.grade_level_suggestion;
                        data.content_type_suggestion = data.content_type_suggestion || parsedLessonData.content_type_suggestion;
                        data.problems_with_context = parsedLessonData.problems_with_context;
                    }
                }
                catch (e) {
                    console.error('Error parsing lesson_json:', e);
                }
            }
            // Format complete content using helper function
            const fullContent = formatCompleteEducationalContent(data);
            // Create metadata object
            const metadata = {
                subject: subjectName,
                content_type: data.content_type_suggestion || data.content_type,
                grade_level: data.grade_level_suggestion
            };
            if (data.completed_at) {
                metadata.completed = true;
                metadata.completed_date = data.completed_at;
                if (data.grade_value && data.grade_max_value) {
                    metadata.grade_percentage = Math.round((data.grade_value / data.grade_max_value) * 100);
                }
            }
            else if (['assignment', 'worksheet', 'quiz', 'test'].includes(data.content_type)) {
                metadata.completed = false;
            }
            if (data.due_date) {
                metadata.due_date = data.due_date;
            }
            if (data.estimated_completion_time_minutes) {
                metadata.estimated_time_minutes = data.estimated_completion_time_minutes;
            }
            if (data.worksheet_questions?.length > 0) {
                metadata.total_questions = data.worksheet_questions.length;
            }
            else if (data.tasks_or_questions?.length > 0) {
                metadata.total_questions = data.tasks_or_questions.length;
            }
            if (data.assignment_metadata) {
                metadata.total_points = data.assignment_metadata.total_points;
                metadata.difficulty_level = data.assignment_metadata.difficulty_level;
            }
            // Return structured OpenAI-compatible response
            const fetchResult = {
                id: data.id,
                title: data.title,
                text: fullContent,
                url: `internal://materials/${data.id}`,
                metadata
            };
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(fetchResult)
                    }]
            };
        }
        catch (error) {
            console.error('❌ Fetch tool error:', error);
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
    });
    // Register search_lessons tool
    mcpServer.tool('search_lessons', 'Search for educational lessons and teaching materials', {
        child_id: z.string().describe('Student UUID for context'),
        query: z.string().optional().describe('Search query for lesson topics (e.g., "Other New England Colonies Are Founded", "History Section 3.2")')
    }, async ({ child_id, query }) => {
        const result = await handleSearchLessons(child_id, query || '');
        return {
            content: [{
                    type: 'text',
                    text: result
                }]
        };
    });
    // Register search_student_work tool
    mcpServer.tool('search_student_work', 'Search for student assignments, worksheets, quizzes, and tests', {
        child_id: z.string().describe('Student UUID for context'),
        query: z.string().optional().describe('Search query for specific assignments'),
        status: z.enum(['incomplete', 'completed', 'overdue', 'due_soon']).optional().describe('Filter by completion status'),
        subject: z.string().optional().describe('Filter by subject name'),
        content_type: z.enum(['assignment', 'worksheet', 'quiz', 'test']).optional().describe('Filter by content type'),
        low_scores: z.boolean().optional().describe('Show only work with grades < 75%')
    }, async ({ child_id, query, status, subject, content_type, low_scores }) => {
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
    });
    // Register get_material_details tool
    mcpServer.tool('get_material_details', 'Get complete content for a specific educational material, including all questions and answers', {
        child_id: z.string().describe('Student UUID for context'),
        material_identifier: z.string().describe('Material title or UUID (e.g., "After Reading: The Friend Inside - Think & Discuss")')
    }, async ({ child_id, material_identifier }) => {
        const result = await handleGetMaterialDetails(child_id, material_identifier);
        return {
            content: [{
                    type: 'text',
                    text: result
                }]
        };
    });
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
const transports = {};
// Health check endpoint
app.get('/health', (req, res) => {
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
app.all('/mcp', async (req, res) => {
    console.log(`Received ${req.method} request to /mcp`);
    try {
        // Check for existing session ID
        const sessionId = req.headers['mcp-session-id'];
        let transport;
        if (sessionId && transports[sessionId]) {
            // Check if the transport is of the correct type
            const existingTransport = transports[sessionId];
            if (existingTransport instanceof StreamableHTTPServerTransport) {
                // Reuse existing transport
                transport = existingTransport;
            }
            else {
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
        }
        else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
            const eventStore = new InMemoryEventStore();
            transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                eventStore, // Enable resumability
                onsessioninitialized: (sessionId) => {
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
        }
        else {
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
    }
    catch (error) {
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
app.get('/sse', async (req, res) => {
    console.log('Received GET request to /sse (deprecated SSE transport)');
    const transport = new SSEServerTransport('/messages', res);
    transports[transport.sessionId] = transport;
    res.on("close", () => {
        delete transports[transport.sessionId];
    });
    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);
});
app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId;
    const existingTransport = transports[sessionId];
    if (existingTransport instanceof SSEServerTransport) {
        // Reuse existing transport
        await existingTransport.handlePostMessage(req, res, req.body);
    }
    else if (existingTransport) {
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
    }
    else {
        res.status(400).send('No transport found for sessionId');
    }
});
// Test database connection and start the server
async function startServer() {
    try {
        console.log('🔄 Starting AI Tutor MCP Server...');
        console.log('📊 Testing database connection...');
        // Test database connection
        const { data, error } = await supabase
            .from('child_subjects')
            .select('id')
            .limit(1);
        if (error) {
            console.error('❌ Database connection failed:', error);
            process.exit(1);
        }
        console.log('✅ Database connection successful');
        console.log('🔧 Supabase URL:', supabaseUrl);
        // Start the Express server
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 AI Tutor MCP server running on port ${PORT}`);
            console.log(`📡 MCP Protocol compliant server with dual transport support`);
            console.log(`🔍 Available MCP Tools: search, fetch, search_lessons, search_student_work, get_material_details`);
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
    }
    catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}
// Start the server
startServer();
//# sourceMappingURL=server.js.map
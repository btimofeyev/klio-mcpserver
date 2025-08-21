#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
dotenv.config();
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PORT = process.env.PORT || 3000;
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
const app = express();
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control']
}));
app.use(express.json());
async function getChildSubjects(childId) {
    const { data, error } = await supabase
        .from('child_subjects')
        .select('id')
        .eq('child_id', childId);
    if (error)
        throw error;
    return (data || []).map(cs => cs.id);
}
async function getMaterials(childSubjectIds, filters = {}) {
    let query = supabase
        .from('materials')
        .select(`
      id, title, due_date, completed_at, content_type, grade_value, grade_max_value,
      child_subject:child_subject_id(
        subject:subject_id(name),
        custom_subject_name_override
      )
    `)
        .in('child_subject_id', childSubjectIds);
    if (filters.types) {
        query = query.in('content_type', filters.types);
    }
    if (filters.completed === true) {
        query = query.not('completed_at', 'is', null);
    }
    else if (filters.completed === false) {
        query = query.is('completed_at', null);
    }
    if (filters.hasGrades) {
        query = query.not('grade_value', 'is', null).not('grade_max_value', 'is', null);
    }
    query = query.order('due_date', { ascending: true, nullsFirst: false });
    if (filters.limit) {
        query = query.limit(filters.limit);
    }
    const { data, error } = await query;
    if (error)
        throw error;
    let results = data || [];
    // Apply score threshold filter if specified
    if (filters.scoreThreshold !== undefined && filters.hasGrades) {
        results = results.filter(item => {
            if (!item.grade_value || !item.grade_max_value)
                return false;
            const percentage = (item.grade_value / item.grade_max_value) * 100;
            return percentage < (filters.scoreThreshold || 0);
        });
    }
    return results;
}
function formatMaterials(materials, format) {
    return materials.map(item => {
        const subjectName = item.child_subject?.custom_subject_name_override ||
            item.child_subject?.subject?.name || 'Unknown';
        const contentType = item.content_type ? ` [${item.content_type}]` : '';
        let statusInfo = '';
        if (item.due_date) {
            const dueDate = new Date(item.due_date);
            const today = new Date();
            const daysDiff = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 3600 * 24));
            if (daysDiff < 0)
                statusInfo = ' (scheduled earlier)';
            else if (daysDiff === 0)
                statusInfo = ' (scheduled today)';
            else if (daysDiff === 1)
                statusInfo = ' (scheduled tomorrow)';
            else if (daysDiff > 1)
                statusInfo = ` (scheduled in ${daysDiff} days)`;
        }
        let gradeInfo = '';
        if (item.grade_value && item.grade_max_value) {
            const percentage = Math.round((item.grade_value / item.grade_max_value) * 100);
            gradeInfo = ` - ${percentage}%`;
            if (format === 'performance_review') {
                if (percentage < 50)
                    gradeInfo += ' - Needs significant review';
                else if (percentage < 70)
                    gradeInfo += ' - Could use more practice';
                else
                    gradeInfo += ' - Room for improvement';
            }
        }
        const dueInfo = item.due_date ? ` - Scheduled: ${item.due_date}` : '';
        return `- **${item.title}**${contentType} (${subjectName})${dueInfo}${statusInfo}${gradeInfo}`;
    });
}
// ===============================
// TOOL HANDLERS
// ===============================
async function handleSearchDatabase(childId, query = '', searchType = 'all') {
    try {
        const childSubjectIds = await getChildSubjects(childId);
        const results = [];
        // Map search types to filters
        const searchConfig = {
            next_up: {
                filters: { types: ['assignment', 'worksheet', 'quiz', 'test'], completed: false, limit: 10 },
                title: 'Next Up - Ready to Work On',
                icon: '📝'
            },
            performance_review: {
                filters: { types: ['assignment', 'worksheet', 'quiz', 'test'], completed: true, hasGrades: true, scoreThreshold: 85, limit: 10 },
                title: 'Items Worth Reviewing (Low Scores)',
                icon: '📈'
            },
            grades: {
                filters: { hasGrades: true, completed: true, limit: 15 },
                title: 'Recent Grades',
                icon: '📊'
            },
            tests: {
                filters: { types: ['test', 'quiz'], limit: 15 },
                title: 'Tests & Quizzes',
                icon: '📋'
            },
            worksheets: {
                filters: { types: ['worksheet'], limit: 15 },
                title: 'Worksheets',
                icon: '📄'
            },
            assignments: {
                filters: { types: ['assignment'], limit: 15 },
                title: 'Assignments',
                icon: '📝'
            },
            incomplete_assignments: {
                filters: { types: ['assignment', 'worksheet', 'quiz', 'test'], completed: false, limit: 20 },
                title: 'Incomplete Work',
                icon: '📝'
            },
            completed_assignments: {
                filters: { types: ['assignment', 'worksheet', 'quiz', 'test'], completed: true, limit: 15 },
                title: 'Completed Work',
                icon: '✅'
            }
        };
        const searchTypes = searchType === 'all' ?
            ['next_up', 'performance_review', 'grades', 'tests'] :
            [searchType];
        for (const type of searchTypes) {
            const config = searchConfig[type];
            if (!config)
                continue;
            const materials = await getMaterials(childSubjectIds, config.filters);
            if (materials.length > 0) {
                results.push(`${config.icon} **${config.title} (${materials.length}):**`);
                const formatted = formatMaterials(materials, type);
                results.push(...formatted);
                results.push('');
            }
        }
        return results.length > 0 ? results.join('\n') : 'No educational data found.';
    }
    catch (error) {
        console.error('❌ Search error:', error);
        return `Error searching database: ${error.message}`;
    }
}
async function handleGetMaterialContent(childId, materialIdentifier) {
    try {
        const childSubjectIds = await getChildSubjects(childId);
        const { data, error } = await supabase
            .from('materials')
            .select(`
        id, title, content_type, lesson_json, file_url, 
        original_filename, due_date, status, completed_at,
        grade_value, grade_max_value, grading_notes,
        child_subject:child_subject_id(
          subject:subject_id(name),
          custom_subject_name_override
        )
      `)
            .in('child_subject_id', childSubjectIds)
            .or(`title.ilike.%${materialIdentifier}%, id.eq.${materialIdentifier}`)
            .single();
        if (error || !data) {
            return `Material "${materialIdentifier}" not found.`;
        }
        const result = [];
        const subjectName = data.child_subject?.custom_subject_name_override ||
            data.child_subject?.subject?.name || 'General';
        result.push(`**${data.title}** (${subjectName})`);
        result.push(`Type: ${data.content_type || 'General Material'}`);
        if (data.due_date) {
            result.push(`Scheduled: ${data.due_date}`);
        }
        if (data.grade_value && data.grade_max_value) {
            const percentage = Math.round((data.grade_value / data.grade_max_value) * 100);
            result.push(`Grade: ${data.grade_value}/${data.grade_max_value} (${percentage}%)`);
        }
        // Parse lesson content if available
        if (data.lesson_json) {
            try {
                const lessonData = typeof data.lesson_json === 'string' ?
                    JSON.parse(data.lesson_json) : data.lesson_json;
                const parsedContent = parseLessonContent(lessonData);
                if (parsedContent) {
                    result.push('');
                    if (parsedContent.learning_objectives && parsedContent.learning_objectives.length > 0) {
                        result.push('**Learning Objectives:**');
                        parsedContent.learning_objectives.forEach((obj) => {
                            result.push(`- ${obj}`);
                        });
                        result.push('');
                    }
                    if (parsedContent.content_summary) {
                        result.push('**Content Summary:**');
                        result.push(parsedContent.content_summary);
                        result.push('');
                    }
                    if (parsedContent.keywords && parsedContent.keywords.length > 0) {
                        result.push('**Key Concepts:**');
                        result.push(parsedContent.keywords.join(', '));
                        result.push('');
                    }
                    if (parsedContent.formatted_questions && parsedContent.formatted_questions.length > 0) {
                        result.push('**Practice Questions:**');
                        parsedContent.formatted_questions.forEach((question) => {
                            result.push(`- ${question}`);
                        });
                        result.push('');
                    }
                }
                else {
                    // Fallback to simple parsing
                    if (lessonData.content) {
                        result.push('**Content:**');
                        result.push(lessonData.content);
                        result.push('');
                    }
                    if (lessonData.questions) {
                        result.push('**Questions/Tasks:**');
                        lessonData.questions.forEach((q, i) => {
                            result.push(`${i + 1}. ${q}`);
                        });
                        result.push('');
                    }
                }
            }
            catch (parseError) {
                result.push('Note: Content format not supported for display');
            }
        }
        return result.join('\n');
    }
    catch (error) {
        console.error('❌ Error getting material content:', error);
        return `Error getting material content: ${error.message}`;
    }
}
async function handleGetNextHomework(childId, subject) {
    try {
        const childSubjectIds = await getChildSubjects(childId);
        let query = supabase
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
            .limit(1);
        if (subject) {
            // Filter by subject if specified
            const { data: subjectData } = await supabase
                .from('child_subjects')
                .select('id')
                .eq('child_id', childId)
                .or(`subject.name.ilike.%${subject}%, custom_subject_name_override.ilike.%${subject}%`);
            if (subjectData && subjectData.length > 0) {
                query = query.in('child_subject_id', subjectData.map(s => s.id));
            }
        }
        const { data: homework, error } = await query.single();
        if (error || !homework) {
            return subject ?
                `No incomplete assignments found for ${subject}.` :
                'No incomplete assignments found.';
        }
        const subjectName = homework.child_subject?.custom_subject_name_override ||
            homework.child_subject?.subject?.name || 'Unknown';
        const result = [`📚 **Next Homework Assignment:**`];
        result.push(`**${homework.title}** (${subjectName}) [${homework.content_type}]`);
        if (homework.due_date) {
            const dueDate = new Date(homework.due_date);
            const today = new Date();
            const daysDiff = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 3600 * 24));
            if (daysDiff < 0) {
                result.push(`📅 **Scheduled earlier** - Was scheduled: ${homework.due_date}`);
            }
            else if (daysDiff === 0) {
                result.push(`⚠️ **SCHEDULED TODAY** - ${homework.due_date}`);
            }
            else if (daysDiff === 1) {
                result.push(`⏰ **SCHEDULED TOMORROW** - ${homework.due_date}`);
            }
            else {
                result.push(`📅 Scheduled: ${homework.due_date} (in ${daysDiff} days)`);
            }
        }
        return result.join('\n');
    }
    catch (error) {
        console.error('❌ Error getting next homework:', error);
        return `Error getting next homework: ${error.message}`;
    }
}
async function handleGetSubjectContext(childId, subjectName) {
    try {
        const { data: childSubjects, error: subjectError } = await supabase
            .from('child_subjects')
            .select(`
        id,
        custom_subject_name_override,
        subject:subject_id(name)
      `)
            .eq('child_id', childId);
        if (subjectError || !childSubjects || childSubjects.length === 0) {
            return `No subjects enrolled for this student.`;
        }
        // Filter for matching subject
        const matchingSubjects = childSubjects.filter((cs) => {
            const customName = cs.custom_subject_name_override?.toLowerCase() || '';
            const originalName = cs.subject?.name?.toLowerCase() || '';
            const searchName = subjectName.toLowerCase();
            return customName.includes(searchName) ||
                originalName.includes(searchName) ||
                (originalName.includes('mathematics') && searchName.includes('math')) ||
                (originalName.includes('english') && (searchName.includes('ela') || searchName.includes('reading') || searchName.includes('writing')));
        });
        if (matchingSubjects.length === 0) {
            return `No ${subjectName} enrollment found for this student.`;
        }
        const childSubjectIds = matchingSubjects.map((cs) => cs.id);
        const result = [`📚 **${subjectName} Overview:**`, ''];
        // Get incomplete work
        const incomplete = await getMaterials(childSubjectIds, {
            types: ['assignment', 'worksheet', 'quiz', 'test'],
            completed: false,
            limit: 5
        });
        if (incomplete.length > 0) {
            result.push(`**📝 Current Work (${incomplete.length} items):**`);
            const formatted = formatMaterials(incomplete, 'current');
            result.push(...formatted);
            result.push('');
        }
        // Get recent grades
        const graded = await getMaterials(childSubjectIds, {
            hasGrades: true,
            completed: true,
            limit: 5
        });
        if (graded.length > 0) {
            result.push(`**📊 Recent Performance:**`);
            const formatted = formatMaterials(graded, 'grades');
            result.push(...formatted);
            result.push('');
        }
        // Get upcoming assessments
        const tests = await getMaterials(childSubjectIds, {
            types: ['test', 'quiz'],
            completed: false,
            limit: 5
        });
        if (tests.length > 0) {
            result.push(`**📝 Upcoming Tests/Quizzes:**`);
            const formatted = formatMaterials(tests, 'tests');
            result.push(...formatted);
        }
        return result.join('\n') || `No current activity found for ${subjectName}.`;
    }
    catch (error) {
        console.error('❌ Error getting subject context:', error);
        return `Error getting ${subjectName} context: ${error.message}`;
    }
}
async function handleGetStudentProfile(childId) {
    try {
        const childSubjectIds = await getChildSubjects(childId);
        const result = ['📊 **Student Learning Profile:**', ''];
        // Get overall progress
        const allMaterials = await getMaterials(childSubjectIds, {
            types: ['assignment', 'worksheet', 'quiz', 'test']
        });
        const completed = allMaterials.filter(m => m.completed_at);
        const incomplete = allMaterials.filter(m => !m.completed_at);
        result.push(`**📈 Overall Progress:**`);
        result.push(`- Completed: ${completed.length} items`);
        result.push(`- Pending: ${incomplete.length} items`);
        result.push('');
        // Calculate grade averages
        const graded = completed.filter(m => m.grade_value && m.grade_max_value);
        if (graded.length > 0) {
            const totalEarned = graded.reduce((sum, m) => sum + m.grade_value, 0);
            const totalPossible = graded.reduce((sum, m) => sum + m.grade_max_value, 0);
            const average = Math.round((totalEarned / totalPossible) * 100);
            result.push(`**📊 Grade Average:** ${average}% (${graded.length} graded items)`);
            result.push('');
        }
        // Show areas needing review
        const lowScores = await getMaterials(childSubjectIds, {
            hasGrades: true,
            completed: true,
            scoreThreshold: 70,
            limit: 3
        });
        if (lowScores.length > 0) {
            result.push(`**🎯 Areas for Review:**`);
            const formatted = formatMaterials(lowScores, 'performance_review');
            result.push(...formatted);
        }
        return result.join('\n');
    }
    catch (error) {
        console.error('❌ Error getting student profile:', error);
        return `Error getting student profile: ${error.message}`;
    }
}
// ===============================
// HTTP ENDPOINTS
// ===============================
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'simplified-ai-tutor-mcp-server'
    });
});
app.post('/tool', async (req, res) => {
    try {
        const { tool, arguments: args } = req.body;
        if (!tool || !args || !args.child_id) {
            res.status(400).json({ error: 'Missing required parameters' });
            return;
        }
        let result;
        const childId = args.child_id;
        switch (tool) {
            case 'search_database':
                result = await handleSearchDatabase(childId, args.query, args.search_type);
                break;
            case 'get_material_content':
                result = await handleGetMaterialContent(childId, args.material_identifier);
                break;
            case 'get_next_homework':
                result = await handleGetNextHomework(childId, args.subject);
                break;
            case 'get_subject_context':
                result = await handleGetSubjectContext(childId, args.subject_name);
                break;
            case 'get_student_profile':
                result = await handleGetStudentProfile(childId);
                break;
            default:
                res.status(400).json({ error: `Unknown tool: ${tool}` });
                return;
        }
        res.json({ result });
        return;
    }
    catch (error) {
        console.error('❌ Tool error:', error);
        res.status(500).json({ error: error.message });
        return;
    }
});
// ===============================
// LESSON CONTENT PARSING FUNCTIONS
// ===============================
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
// Start server
app.listen(PORT, () => {
    console.log(`🚀 Simplified MCP server running on port ${PORT}`);
});
//# sourceMappingURL=server-simplified.js.map
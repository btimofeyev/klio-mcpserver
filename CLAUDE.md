# AI Tutor MCP Server - Claude Reference Guide

This MCP server provides Claude with intelligent access to student educational data, enabling personalized tutoring experiences. The server separates **teaching content** (lessons) from **student work** (assignments/quizzes) for optimal AI tutoring support.

## Overview

The server offers two focused tools that distinguish between what students are learning (lessons) and what they need help with (their assignments, worksheets, quizzes, and tests).

## Available Tools

### 1. `search_lessons`
**Purpose**: Find teaching materials and lesson content for AI to understand what the student is learning
**Best for**: Getting context about topics, understanding learning objectives, finding relevant teaching materials

**Parameters**:
- `child_id` (required): Student UUID
- `query` (optional): Search query for lesson topics (e.g., "Other New England Colonies Are Founded", "History Section 3.2")

**Content Types Searched**: `lesson`, `reading`, `chapter`, or materials marked as `is_primary_lesson = true`

**Returns**: 
- Lesson titles and subjects
- Learning objectives
- Key topics and concepts
- Teaching materials for AI tutoring context

**Example Usage**:
```json
{
  "child_id": "abc123...",
  "query": "New England Colonies"
}
```

### 2. `search_student_work`
**Purpose**: Find student assignments, worksheets, quizzes, and tests for AI to help with actual student work
**Best for**: Identifying what students need to work on, review completed work, find assignments needing help

**Parameters**:
- `child_id` (required): Student UUID
- `query` (optional): Search query for specific assignments
- `status` (optional): Filter by status
  - `incomplete` - Unfinished work
  - `completed` - Finished work
  - `overdue` - Past due assignments
  - `due_soon` - Due within 3 days
- `subject` (optional): Filter by subject name
- `content_type` (optional): Filter by type (`assignment`, `worksheet`, `quiz`, `test`)
- `low_scores` (optional): boolean - Show only work with grades < 75%

**Content Types Searched**: `assignment`, `worksheet`, `quiz`, `test`

**Returns**: 
- Assignment details with due dates and urgency indicators
- Completion status and grades
- Sample question preview for each item
- Organized by incomplete vs. completed work
- Visual indicators for overdue/due soon items

**Example Usage**:
```json
{
  "child_id": "abc123...",
  "query": "colonies worksheet",
  "status": "incomplete",
  "subject": "history"
}
```

### 3. `get_material_details`
**Purpose**: Get complete content for a specific educational material, including all questions and answers
**Best for**: Deep dive into specific assignments or lessons when AI needs full context for tutoring

**Parameters**:
- `child_id` (required): Student UUID
- `material_identifier` (required): Material title or UUID

**Returns**:
- Complete material information (title, subject, due dates, grades)
- ALL questions/tasks for assignments and worksheets
- Answer key (for completed work or lesson materials)
- Learning objectives and key concepts
- Related lesson content if it's an assignment
- Teaching notes and methodology

**Example Usage**:
```json
{
  "child_id": "abc123...",
  "material_identifier": "After Reading: The Friend Inside - Think & Discuss"
}
```

## Student Query Translation Guide

| Student Says | Recommended Tool Flow | Parameters |
|-------------|---------------------|-------------|
| "What's my homework?" | `search_student_work` | `status: "incomplete"` |
| "I need help with math" | `search_student_work` → `get_material_details` | First: `subject: "math", status: "incomplete"`<br/>Then: `material_identifier: [assignment title]` |
| "Let's review something" | `search_student_work` | `low_scores: true` or `status: "completed"` |
| "What tests do I have?" | `search_student_work` | `content_type: "quiz"` or `content_type: "test"` |
| "I don't understand fractions" | `search_lessons` → `get_material_details` | First: `query: "fractions"`<br/>Then: `material_identifier: [lesson title]` |
| "Help with my colonies worksheet" | `search_student_work` → `get_material_details` | First: `query: "colonies", content_type: "worksheet"`<br/>Then: `material_identifier: [worksheet title]` |
| "What's the first question?" | `get_material_details` | `material_identifier: [current assignment title]` |
| "What's due soon?" | `search_student_work` | `status: "due_soon"` |
| "Show me my low grades" | `search_student_work` | `low_scores: true, status: "completed"` |

## Response Format Examples

### Student Work Search Response
```
📝 **Student Work Found:**

**📋 Incomplete Work (2):**
• **After Reading: The Friend Inside - Think & Discuss** [worksheet] (English) 🚨 **OVERDUE**
  Preview: 1. What historical elements are in this story?
• **Colonial America Essay** [assignment] (History) 📅 Due 2024-08-20
  Preview: Write a 3-paragraph essay about colonial settlements

**✅ Completed Work (3):**
• **Linear Equations Worksheet** [worksheet] (Math) 🅰️ 95%
• **Multiplication Quiz** [quiz] (Math) 🅱️ 85%
• **Geography Test** [test] (Social Studies) 🆔 72%
```

### Lesson Search Response  
```
📚 **Teaching Materials Found:**

**The Friend Inside: Lessons 92-93** (English)
**Learning Objectives:**
• Identify elements of historical fiction in the story
• Analyze how external and internal conflicts reveal character
• Infer the theme of the story
**Key Topics:** historical fiction, Civil War, Abraham Lincoln, conscience, character traits
**Summary:** This lesson focuses on the short story "The Friend Inside" by T. Morris Longstreth and the poem "Nancy Hanks" by Rosemary Carr Benét...
**Sample Questions:**
• How reliable is my conscience?
• Which historical figure appears in this story? (Abraham Lincoln)
• What character traits are revealed by Jim's inner turmoil here?
---
```

### Material Details Response
```
📚 **After Reading: The Friend Inside - Think & Discuss Questions**
Subject: English | Type: worksheet
Due Date: 2024-08-15 🚨 **OVERDUE**

**Learning Objectives:**
• Identify historical elements in a story
• Compare fictional and nonfiction accounts
• Analyze character traits through confrontations

**All Questions:**
1. What historical elements are in this story?
2. How is this story's treatment of historical figures and events different from that of a nonfiction account?
3. Identify two examples of idiom in the story.
4. What do Jim's confrontations reveal about his character?
5. What is the story's theme?
6. Read 1 Corinthians 8:7; 1 Timothy 4:2; and Titus 1:15. According to biblical teaching, is your conscience reliable for determining the right thing to do? Why or why not?

**Related Lesson:** The Friend Inside: Lessons 92-93
**Lesson Context:** This lesson focuses on the short story "The Friend Inside" by T. Morris Longstreth featuring Jim Kaley, a young man who struggles with internal and external conflicts as he serves as a messenger for Abraham Lincoln during the Civil War...
```

## Tutoring Flow Recommendations

### 1. Identify Student Need
When a student asks for help:
- Use `search_student_work` to find what they need to work on
- Look for overdue items, upcoming due dates, or specific assignments they mention
- Note the preview questions shown in search results

### 2. Get Full Assignment Details  
Once you identify the specific assignment:
- Use `get_material_details` with the assignment title/ID
- This gives you ALL questions, answer key, and learning objectives
- Shows related lesson content for teaching context

### 3. Get Additional Teaching Context (if needed)
If you need more background on the topic:
- Use `search_lessons` with relevant keywords from the assignment
- Use `get_material_details` on the parent lesson for full teaching notes

### 4. Provide Targeted Help
With complete material details:
- Reference specific questions the student is working on
- Use learning objectives to frame explanations
- Connect lesson context to assignment questions
- Provide step-by-step guidance based on teaching methodology

### 5. Track Progress
Use filters in `search_student_work`:
- `low_scores: true` to identify areas needing more practice  
- `status: "completed"` to review what they've mastered
- `status: "due_soon"` to prioritize urgent work

## Visual Indicators

The server provides helpful visual cues:
- **Urgency Indicators**: 🚨 OVERDUE, ⚠️ DUE TODAY, ⏰ DUE TOMORROW
- **Grade Indicators**: 🅰️ 90%+, 🅱️ 80-89%, 🆔 70-79%, 🆘 60-69%, ❌ <60%
- **Status Icons**: 📋 Incomplete Work, ✅ Completed Work, 📚 Teaching Materials

## Best Practices for AI Tutoring

1. **Two-Step Approach**: When helping with assignments, first search lessons for teaching context, then search student work for the specific assignment
2. **Use Lesson Context**: Always reference learning objectives and key topics from lessons when explaining concepts
3. **Prioritize by Urgency**: Use status filters to identify overdue or due-soon items first
4. **Track Performance**: Use `low_scores: true` to identify concepts that need reinforcement
5. **Subject-Specific Help**: Filter by subject to focus on specific academic areas

## Environment Setup

For local development, ensure these environment variables:
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key for database access
- `PORT`: Server port (default: 3000)

## Build Commands

```bash
npm run build    # Compile TypeScript
npm start        # Run compiled server
npm run dev      # Development mode with auto-reload
npm test         # Run connection tests
```

This simplified MCP server transforms Claude into an intelligent tutoring assistant by clearly separating lesson content (what to teach) from student work (what to help with), enabling more effective and contextual tutoring support.
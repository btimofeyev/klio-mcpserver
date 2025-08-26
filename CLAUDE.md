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

## Student Query Translation Guide

| Student Says | Recommended Tool | Parameters |
|-------------|------------------|-------------|
| "What's my homework?" | `search_student_work` | `status: "incomplete"` |
| "I need help with math" | `search_student_work` then `search_lessons` | First: `subject: "math", status: "incomplete"`<br/>Then: `query: [topic from assignment]` |
| "Let's review something" | `search_student_work` | `low_scores: true` or `status: "completed"` |
| "What tests do I have?" | `search_student_work` | `content_type: "quiz"` or `content_type: "test"` |
| "I don't understand fractions" | `search_lessons` | `query: "fractions"` |
| "Help with my colonies worksheet" | `search_lessons` then `search_student_work` | First: `query: "colonies"`<br/>Then: `query: "colonies", content_type: "worksheet"` |
| "What's due soon?" | `search_student_work` | `status: "due_soon"` |
| "Show me my low grades" | `search_student_work` | `low_scores: true, status: "completed"` |

## Response Format Examples

### Student Work Search Response
```
📝 **Student Work Found:**

**📋 Incomplete Work (2):**
• **Algebra Practice Problems** [assignment] (Math) ⏰ **DUE TOMORROW**
• **Colonial America Essay** [assignment] (History) 📅 Due 2024-08-20

**✅ Completed Work (3):**
• **Linear Equations Worksheet** [worksheet] (Math) 🅰️ 95%
• **Multiplication Quiz** [quiz] (Math) 🅱️ 85%
• **Geography Test** [test] (Social Studies) 🆔 72%
```

### Lesson Search Response  
```
📚 **Teaching Materials Found:**

**Other New England Colonies Are Founded** (History)
**Learning Objectives:**
• Explain the founding of Connecticut and Rhode Island
• Describe the role of religious freedom in colonial expansion
• Compare different colonial governments
**Key Topics:** Roger Williams, Thomas Hooker, religious tolerance, colonial charters, Fundamental Orders
---

**The Connecticut River Valley** (History)
**Learning Objectives:**
• Identify geographic factors in settlement patterns
• Understand economic opportunities in the Connecticut valley
**Key Topics:** fertile soil, river transportation, fur trade, Hartford settlement
---
```

## Tutoring Flow Recommendations

### 1. Identify Student Need
When a student asks for help:
- Use `search_student_work` to find what they need to work on
- Look for overdue items, upcoming due dates, or specific assignments they mention

### 2. Get Teaching Context
Once you know what assignment they need help with:
- Use `search_lessons` with relevant topic keywords from the assignment
- This gives you the teaching materials and learning objectives to help explain concepts

### 3. Provide Targeted Help
With both student work and lesson context:
- Reference the learning objectives when explaining concepts
- Use the key topics from lessons to provide comprehensive explanations
- Connect the lesson content to the specific assignment questions

### 4. Track Progress
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
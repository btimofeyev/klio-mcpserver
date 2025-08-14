# AI Tutor MCP Server - Claude Reference Guide

This MCP server provides Claude with intelligent access to student educational data, enabling personalized tutoring experiences through natural language queries.

## Overview

The server translates natural student requests into smart database queries, returning contextual educational information that helps Claude provide targeted tutoring support.

## Available Tools

### 1. `search_database`
**Purpose**: Search student educational data with natural language types
**Best for**: General searches and specific educational content types

**Parameters**:
- `child_id` (required): Student UUID
- `query` (optional): Search query text
- `search_type`: Type of search to perform

**Natural Search Types**:
- `homework` - "What's my homework?" → Next assignment with full context
- `help_with_subject` - "I need help with math" → Subject materials and progress
- `review` - "Let's review something" → Materials needing review (< 80% grades)
- `upcoming_tests` - "What tests do I have?" → Upcoming assessments
- `current_lesson` - "What am I learning now?" → Current lessons and objectives
- `all` - Complete overview of student's academic status

**Example Usage**:
```json
{
  "child_id": "abc123...",
  "search_type": "homework"
}
```

### 2. `get_next_homework`
**Purpose**: Get the most urgent incomplete assignment with full learning context
**Best for**: "What should I work on next?" queries

**Parameters**:
- `child_id` (required): Student UUID
- `subject` (optional): Filter by specific subject

**Returns**: Assignment details, due date urgency, related lesson content, practice problems

### 3. `get_subject_context`
**Purpose**: Comprehensive subject overview with current work, grades, and lessons
**Best for**: Subject-specific help requests like "I need help with history"

**Parameters**:
- `child_id` (required): Student UUID
- `subject_name` (required): Subject name (e.g., "Math", "History", "English")

**Returns**: Current work, recent performance, current lessons, upcoming assessments

### 4. `get_material_content`
**Purpose**: Get detailed content for specific educational materials
**Best for**: Deep dives into specific lessons or assignments

**Parameters**:
- `child_id` (required): Student UUID
- `material_identifier` (required): Material title or UUID

**Returns**: Full material content, learning objectives, practice questions, related materials

### 5. `get_student_profile`
**Purpose**: Get learning preferences, performance metrics, and study habits
**Best for**: Understanding how to best teach this student

**Parameters**:
- `child_id` (required): Student UUID

**Returns**: Learning style, performance stats, study preferences, difficulty areas

## Student Query Translation Guide

| Student Says | Recommended Tool | Search Type |
|-------------|------------------|-------------|
| "What's my homework?" | `get_next_homework` | - |
| "I need help with math" | `get_subject_context` | subject_name: "math" |
| "Let's review something" | `search_database` | search_type: "review" |
| "What tests do I have?" | `search_database` | search_type: "upcoming_tests" |
| "I don't understand fractions" | `get_material_content` | material_identifier: "fractions" |
| "What am I learning now?" | `search_database` | search_type: "current_lesson" |
| "How am I doing overall?" | `get_student_profile` | - |

## Response Format Examples

### Homework Response
```
📚 **Next Assignment: Algebra Practice Problems**
Subject: Math
Type: assignment
⏰ **DUE TOMORROW** - 2024-08-15

**What you'll practice:**
- Solving linear equations
- Working with variables

**Sample problems:**
- Question 1: 2x + 5 = 13, solve for x
- Question 2: 3(x - 4) = 15
```

### Subject Context Response
```
📚 **Math - Subject Overview**

**📝 Current Work (3 items):**
- Algebra Practice Problems [assignment] - Due: 2024-08-15
- Geometry Quiz [quiz] - Due: 2024-08-18

**📊 Recent Performance:**
- 🅰️ Linear Equations Worksheet: 95%
- 🅱️ Word Problems Assignment: 85%
**Average:** 🅰️ 90%

**📖 Current Lessons:**
- **Introduction to Algebra**
  Focus: Solving equations, Understanding variables
```

### Student Profile Response
```
👤 **Sarah's Learning Profile**
Grade: 8

**🎯 Learning Stats:**
- Days learning together: 45
- Current streak: 12 correct
- Best streak: 18 correct

**📚 Learning Preferences:**
- Explanation style: step_by_step
- Learning pace: moderate
- Confidence level: building

**⏰ Study Preferences:**
- Preferred study time: 09:00:00 - 15:00:00
- Max daily study: 240 minutes
- Difficult subjects in morning: Yes
```

## Tutoring Flow Recommendations

### 1. Session Start
Use `get_student_profile` to understand:
- Learning preferences (step-by-step vs. conceptual)
- Current confidence level
- Recent performance patterns

### 2. Determine Focus
Use `get_next_homework` or subject-specific `get_subject_context` to:
- Identify urgent work
- Understand current learning objectives
- Get relevant practice problems

### 3. Provide Context
Use `get_material_content` for detailed explanations:
- Full lesson content
- Learning objectives
- Practice questions
- Related materials

### 4. Adaptive Teaching
Based on profile data:
- **step_by_step**: Break down problems into clear steps
- **conceptual**: Focus on understanding principles
- **building confidence**: Provide encouragement and start with easier concepts

## Error Handling

The server provides helpful error messages:
- Invalid student ID → "Unable to access student subjects"
- Subject not found → Lists available subjects
- No homework → "Great job staying on top of your work!"
- Material not found → "Material not found. Please check the title or ID"

## Performance Features

- **Smart Urgency**: Overdue (🚨), Due Today (⚠️), Due Tomorrow (⏰)
- **Grade Analysis**: Color-coded performance indicators (🅰️🅱️🆔🆘❌)
- **Contextual Bundling**: Assignments include related lessons and practice problems
- **Learning Memory**: Tracks topics covered and confidence levels

## Best Practices

1. **Start with Profile**: Always check `get_student_profile` to understand learning style
2. **Use Natural Types**: Leverage `homework`, `review`, `help_with_subject` for intuitive searches
3. **Provide Context**: Include related lessons and practice problems in explanations
4. **Monitor Progress**: Use grade data to identify areas needing extra attention
5. **Adapt Teaching**: Match explanation style to student preferences

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

This MCP server transforms Claude into an intelligent tutoring assistant that understands student context and provides personalized educational support.
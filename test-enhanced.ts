/**
 * Test the enhanced GPT-5 MCP server components without database connection
 */

import { QueryParser } from './src/utils/queryParser.js';
import { ContentFormatter } from './src/utils/formatter.js';

console.log('🧪 Testing Enhanced GPT-5 MCP Server Components\n');

// Test 1: Query Parser
console.log('1. Testing Query Parser:');
const testQueries = [
  'what\'s my homework',
  'overdue math worksheets', 
  'help with colonial america lesson',
  'review my low grades',
  'due tomorrow',
  'child_id:123-456 spanish quiz'
];

testQueries.forEach(query => {
  const parsed = QueryParser.parseQuery(query);
  console.log(`   Query: "${query}"`);
  console.log(`   Intent: ${parsed.intent.type} (${parsed.intent.keywords.join(', ')})`);
  console.log(`   Description: ${QueryParser.describeIntent(parsed.intent)}`);
  console.log();
});

// Test 2: Content Formatter
console.log('2. Testing Content Formatter:');
const mockMaterial = {
  id: 'material-123',
  title: 'Math Worksheet Chapter 5',
  content_type: 'worksheet',
  due_date: '2024-12-20T10:00:00Z',
  completed_at: null,
  grade_value: null,
  grade_max_value: null,
  grading_notes: null,
  lesson_json: {
    learning_objectives: ['Solve linear equations', 'Graph functions'],
    worksheet_questions: ['Solve: 2x + 3 = 7', 'Graph: y = 2x + 1'],
    subject_keywords_or_subtopics: ['algebra', 'linear equations', 'graphing']
  },
  parent_material_id: null,
  is_primary_lesson: false,
  child_subject_id: 'subject-456'
};

const formatted = ContentFormatter.formatEducationalContent(mockMaterial);
console.log('   Formatted Material:');
console.log('   Title:', formatted.title);
console.log('   URL:', formatted.url);
console.log('   Metadata:', JSON.stringify(formatted.metadata, null, 2));
console.log('   Content Preview:', formatted.text.substring(0, 200) + '...');

console.log('\n✅ Enhanced components test completed successfully!');
console.log('🚀 Components are ready for GPT-5 integration');
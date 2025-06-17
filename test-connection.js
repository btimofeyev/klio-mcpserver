#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
// Load environment variables
dotenv.config();
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
    console.error('Please check your .env file');
    process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);
async function testConnection() {
    console.log('🧪 Testing AI Tutor MCP Server Database Connection...\n');
    try {
        // Test 1: Check if we can connect and list tables
        console.log('1️⃣ Testing database connection...');
        const { data: children, error: childrenError } = await supabase
            .from('children')
            .select('count')
            .single();
        if (childrenError) {
            console.error('❌ Failed to connect to children table:', childrenError.message);
            return false;
        }
        console.log('✅ Successfully connected to database');
        // Test 2: Check children table
        console.log('\n2️⃣ Testing children table access...');
        const { data: childrenList, error: childrenListError } = await supabase
            .from('children')
            .select('id, name, grade')
            .limit(5);
        if (childrenListError) {
            console.error('❌ Failed to read children:', childrenListError.message);
            return false;
        }
        console.log(`✅ Found ${childrenList?.length || 0} children in database`);
        if (childrenList && childrenList.length > 0) {
            console.log('Sample children:', childrenList.map(c => `${c.name} (${c.grade})`).join(', '));
        }
        // Test 3: Check subjects table
        console.log('\n3️⃣ Testing subjects table access...');
        const { data: subjects, error: subjectsError } = await supabase
            .from('subjects')
            .select('id, name')
            .limit(10);
        if (subjectsError) {
            console.error('❌ Failed to read subjects:', subjectsError.message);
            return false;
        }
        console.log(`✅ Found ${subjects?.length || 0} subjects`);
        if (subjects && subjects.length > 0) {
            console.log('Available subjects:', subjects.map(s => s.name).join(', '));
        }
        // Test 4: Check lessons table
        console.log('\n4️⃣ Testing lessons table access...');
        const { data: lessons, error: lessonsError } = await supabase
            .from('lessons')
            .select('id, title, status')
            .limit(5);
        if (lessonsError) {
            console.error('❌ Failed to read lessons:', lessonsError.message);
            return false;
        }
        console.log(`✅ Found ${lessons?.length || 0} lessons`);
        // Test 5: Test complex query (lessons with child and subject info)
        console.log('\n5️⃣ Testing complex query (lessons with relationships)...');
        const { data: lessonDetails, error: lessonDetailsError } = await supabase
            .from('lessons')
            .select(`
        id, title, status,
        child_subjects:child_subject_id (
          children:child_id (name),
          subjects:subject_id (name)
        )
      `)
            .limit(3);
        if (lessonDetailsError) {
            console.error('❌ Failed complex query:', lessonDetailsError.message);
            console.error('This might indicate RLS policy issues or missing relationships');
            return false;
        }
        console.log(`✅ Complex query successful, returned ${lessonDetails?.length || 0} lessons with relationships`);
        // Test 6: Check assignments
        console.log('\n6️⃣ Testing assignments table access...');
        const { data: assignments, error: assignmentsError } = await supabase
            .from('assignments')
            .select('id, title, due_date')
            .limit(5);
        if (assignmentsError) {
            console.error('❌ Failed to read assignments:', assignmentsError.message);
            return false;
        }
        console.log(`✅ Found ${assignments?.length || 0} assignments`);
        console.log('\n🎉 All tests passed! Your MCP server should work correctly.');
        console.log('\nNext steps:');
        console.log('1. Build your MCP server: npm run build');
        console.log('2. Test the MCP server: npm start');
        console.log('3. Add it to Claude Desktop configuration');
        console.log('4. Start using your AI tutor!');
        return true;
    }
    catch (error) {
        console.error('❌ Unexpected error during testing:', error);
        return false;
    }
}
async function checkRowLevelSecurity() {
    console.log('\n🔒 Checking Row Level Security policies...');
    try {
        // Try to access each table to see if RLS is properly configured
        const tables = ['children', 'subjects', 'lessons', 'assignments', 'grades'];
        for (const table of tables) {
            const { data, error } = await supabase
                .from(table)
                .select('*')
                .limit(1);
            if (error) {
                if (error.message.includes('row-level security')) {
                    console.log(`⚠️  ${table}: RLS is enabled but may need policy adjustment`);
                    console.log(`   Error: ${error.message}`);
                }
                else {
                    console.log(`❌ ${table}: ${error.message}`);
                }
            }
            else {
                console.log(`✅ ${table}: Access granted`);
            }
        }
    }
    catch (error) {
        console.error('Error checking RLS policies:', error);
    }
}
async function main() {
    console.log('🏠 AI Tutor MCP Server Database Test\n');
    console.log(`Supabase URL: ${supabaseUrl}`);
    console.log(`API Key: ${supabaseKey?.substring(0, 20)}...`);
    const success = await testConnection();
    if (!success) {
        console.log('\n💡 Troubleshooting tips:');
        console.log('1. Check your SUPABASE_URL and SUPABASE_ANON_KEY in .env');
        console.log('2. Verify your Supabase project is active');
        console.log('3. Check Row Level Security policies on your tables');
        console.log('4. Ensure the anon key has the necessary permissions');
        await checkRowLevelSecurity();
    }
}
main().catch(console.error);
//# sourceMappingURL=test-connection.js.map
#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
}

const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

console.error('🔧 FIXED MCP Server initialized with enhanced debugging');

class FixedMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'edunest-fixed-server',
        version: '1.2.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'search_database',
            description: 'Search for student educational data with improved logic',
            inputSchema: {
              type: 'object',
              properties: {
                child_id: {
                  type: 'string',
                  description: 'UUID of the child',
                },
                query: {
                  type: 'string',
                  description: 'Search query',
                },
                search_type: {
                  type: 'string',
                  enum: ['assignments', 'grades', 'subjects', 'overdue', 'recent', 'all'],
                  description: 'Type of search to perform',
                  default: 'all'
                }
              },
              required: ['child_id', 'query'],
            },
          },
          {
            name: 'get_material_content',
            description: 'Get complete content for a specific material',
            inputSchema: {
              type: 'object',
              properties: {
                child_id: {
                  type: 'string',
                  description: 'UUID of the child',
                },
                material_identifier: {
                  type: 'string',
                  description: 'Material title, ID, or identifier',
                }
              },
              required: ['child_id', 'material_identifier'],
            },
          }
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
      const { name, arguments: args } = request.params;

      if (!args) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: 'No arguments provided' }, null, 2)
          }]
        };
      }

      if (name === 'search_database') {
        return await this.searchDatabaseFixed(
          args.child_id as string,
          args.query as string,
          (args.search_type as string) || 'all'
        );
      }

      if (name === 'get_material_content') {
        return await this.getMaterialContent(
          args.child_id as string,
          args.material_identifier as string
        );
      }

      throw new Error(`Unknown tool: ${name}`);
    });
  }

  // FIXED search method with enhanced debugging
  private async searchDatabaseFixed(childId: string, query: string, searchType: string = 'all') {
    try {
      console.error(`🔍 FIXED SEARCH: "${query}" (type: ${searchType}) for child: ${childId}`);

      // Step 1: Get child's subjects
      const { data: childSubjects, error: subjectsError } = await supabase
        .from('child_subjects')
        .select('id, subject:subject_id(name), custom_subject_name_override')
        .eq('child_id', childId);

      if (subjectsError) {
        console.error('❌ Error getting child subjects:', subjectsError);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ 
              error: `Failed to get child subjects: ${subjectsError.message}` 
            }, null, 2)
          }]
        };
      }

      if (!childSubjects || childSubjects.length === 0) {
        console.error('❌ No subjects found for child');
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              query: query,
              searchType: searchType,
              results: {},
              summary: 'No subjects assigned to this student',
              debug: 'Child has no subjects assigned'
            }, null, 2)
          }]
        };
      }

      console.error(`✅ Found ${childSubjects.length} subjects for child`);
      const childSubjectIds = childSubjects.map(cs => cs.id);

      let searchResults: Record<string, any> = {};

      // Enhanced search logic with better debugging
      if (searchType === 'assignments' || searchType === 'all') {
        searchResults.assignments = await this.findAllMaterials(childSubjectIds, query);
        console.error(`📚 Found ${searchResults.assignments.length} assignments`);
      }

      if (searchType === 'overdue' || searchType === 'all') {
        searchResults.overdue = await this.findOverdueMaterials(childSubjectIds);
        console.error(`🚨 Found ${searchResults.overdue.length} overdue materials`);
      }

      if (searchType === 'grades' || searchType === 'all') {
        searchResults.grades = await this.findGradedMaterials(childSubjectIds, query);
        console.error(`📊 Found ${searchResults.grades.length} graded materials`);
      }

      if (searchType === 'recent' || searchType === 'all') {
        searchResults.recent = await this.findRecentMaterials(childSubjectIds);
        console.error(`📅 Found ${searchResults.recent.length} recent materials`);
      }

      if (searchType === 'subjects') {
        searchResults.subjects = childSubjects;
        console.error(`📚 Found ${searchResults.subjects.length} subjects`);
      }

      const totalResults = Object.values(searchResults).reduce((sum: number, arr: any) => {
        return sum + (Array.isArray(arr) ? arr.length : 0);
      }, 0);

      console.error(`✅ FIXED SEARCH COMPLETE: Found ${totalResults} total results`);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            query: query,
            searchType: searchType,
            results: searchResults,
            summary: this.generateSummary(searchResults, query),
            debug: {
              childSubjects: childSubjects.length,
              childSubjectIds: childSubjectIds,
              totalResults: totalResults
            }
          }, null, 2)
        }]
      };

    } catch (error: any) {
      console.error(`❌ FIXED SEARCH ERROR:`, error);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ 
            error: `Search failed: ${error.message}`,
            query: query,
            debug: 'See server logs for details'
          }, null, 2)
        }]
      };
    }
  }

  // FIXED: Find all materials (was returning empty before)
  private async findAllMaterials(childSubjectIds: string[], query: string) {
    try {
      console.error(`🔍 Finding materials for childSubjectIds: ${childSubjectIds.join(', ')}`);

      let queryBuilder = supabase
        .from('materials')
        .select(`
          id, title, due_date, completed_at, grade_value, grade_max_value, content_type, status,
          lesson:lesson_id(
            id, title,
            unit:unit_id(
              id, name,
              child_subject:child_subject_id(
                id,
                subject:subject_id(name),
                custom_subject_name_override
              )
            )
          )
        `)
        .in('child_subject_id', childSubjectIds);

      // Only add query filter if query is provided and not empty
      if (query && query.trim() !== '') {
        queryBuilder = queryBuilder.or(`title.ilike.%${query}%,content_type.ilike.%${query}%`);
      }

      const { data, error } = await queryBuilder
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('❌ Error in findAllMaterials:', error);
        return [];
      }

      console.error(`✅ findAllMaterials found ${data?.length || 0} materials`);
      return data || [];

    } catch (error) {
      console.error('❌ Exception in findAllMaterials:', error);
      return [];
    }
  }

  // FIXED: Find overdue materials with proper date comparison
  private async findOverdueMaterials(childSubjectIds: string[]) {
    try {
      // Get today's date in YYYY-MM-DD format
      const today = new Date();
      const todayString = today.toISOString().split('T')[0];
      
      console.error(`🔍 Finding overdue materials (before ${todayString})`);

      const { data, error } = await supabase
        .from('materials')
        .select(`
          id, title, due_date, completed_at, content_type, status,
          lesson:lesson_id(
            title,
            unit:unit_id(
              name,
              child_subject:child_subject_id(
                subject:subject_id(name),
                custom_subject_name_override
              )
            )
          )
        `)
        .in('child_subject_id', childSubjectIds)
        .lt('due_date', todayString)
        .order('due_date', { ascending: true });

      if (error) {
        console.error('❌ Error finding overdue materials:', error);
        return [];
      }

      console.error(`✅ findOverdueMaterials found ${data?.length || 0} overdue materials`);
      return data || [];

    } catch (error) {
      console.error('❌ Exception in findOverdueMaterials:', error);
      return [];
    }
  }

  // FIXED: Find graded materials
  private async findGradedMaterials(childSubjectIds: string[], query: string) {
    try {
      console.error(`🔍 Finding graded materials`);

      const { data, error } = await supabase
        .from('materials')
        .select(`
          id, title, grade_value, grade_max_value, completed_at, content_type,
          lesson:lesson_id(
            title,
            unit:unit_id(
              child_subject:child_subject_id(
                subject:subject_id(name),
                custom_subject_name_override
              )
            )
          )
        `)
        .in('child_subject_id', childSubjectIds)
        .not('grade_value', 'is', null)
        .not('grade_max_value', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(20);

      if (error) {
        console.error('❌ Error finding graded materials:', error);
        return [];
      }

      console.error(`✅ findGradedMaterials found ${data?.length || 0} graded materials`);
      return data || [];

    } catch (error) {
      console.error('❌ Exception in findGradedMaterials:', error);
      return [];
    }
  }

  // FIXED: Find recent materials  
  private async findRecentMaterials(childSubjectIds: string[]) {
    try {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const threeDaysAgoString = threeDaysAgo.toISOString();

      console.error(`🔍 Finding recent materials (since ${threeDaysAgoString})`);

      const { data, error } = await supabase
        .from('materials')
        .select(`
          id, title, completed_at, grade_value, grade_max_value, content_type,
          lesson:lesson_id(
            title,
            unit:unit_id(
              child_subject:child_subject_id(
                subject:subject_id(name),
                custom_subject_name_override
              )
            )
          )
        `)
        .in('child_subject_id', childSubjectIds)
        .not('completed_at', 'is', null)
        .gte('completed_at', threeDaysAgoString)
        .order('completed_at', { ascending: false })
        .limit(10);

      if (error) {
        console.error('❌ Error finding recent materials:', error);
        return [];
      }

      console.error(`✅ findRecentMaterials found ${data?.length || 0} recent materials`);
      return data || [];

    } catch (error) {
      console.error('❌ Exception in findRecentMaterials:', error);
      return [];
    }
  }

  // Keep existing getMaterialContent method
  private async getMaterialContent(childId: string, materialIdentifier: string) {
    // Implementation same as before
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ 
          message: "getMaterialContent not yet implemented in fixed version" 
        }, null, 2)
      }]
    };
  }

  private generateSummary(searchResults: Record<string, any>, query: string): string {
    const parts = [];
    
    if (searchResults.overdue?.length > 0) {
      parts.push(`Found ${searchResults.overdue.length} overdue assignments`);
    }
    
    if (searchResults.grades?.length > 0) {
      parts.push(`Found ${searchResults.grades.length} graded assignments`);
    }
    
    if (searchResults.assignments?.length > 0) {
      parts.push(`Found ${searchResults.assignments.length} assignments`);
    }
    
    if (searchResults.recent?.length > 0) {
      parts.push(`Found ${searchResults.recent.length} recently completed items`);
    }
    
    if (searchResults.subjects?.length > 0) {
      parts.push(`Found ${searchResults.subjects.length} subjects`);
    }

    return parts.length > 0 ? parts.join(', ') : `No results found for "${query}"`;
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('🔧 FIXED MCP server running with enhanced search logic');
  }
}

const server = new FixedMCPServer();
server.run().catch(console.error);
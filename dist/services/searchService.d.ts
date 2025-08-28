/**
 * Unified Search Service for GPT-5 MCP Server
 *
 * Intelligently combines lessons and student work searches based on query intent.
 * Provides enhanced filtering and ranking for optimal educational AI tutoring.
 */
import { Pool } from 'pg';
import { MaterialData, SearchResult } from '../utils/formatter.js';
export declare class SearchService {
    private pool;
    constructor(pool: Pool);
    /**
     * Perform intelligent search based on parsed query intent
     */
    intelligentSearch(childId: string, query: string): Promise<SearchResult[]>;
    /**
     * Get child subject IDs for a given child with retry logic
     */
    private getChildSubjects;
    /**
     * Execute search with intelligent filtering based on intent
     */
    private executeSearch;
    /**
     * Determine appropriate content types based on intent
     */
    private getContentTypes;
    /**
     * Apply intelligent ranking based on educational priorities and intent
     */
    private rankResults;
    /**
     * Calculate relevance score based on intent matching
     */
    private calculateRelevanceScore;
    /**
     * Check if material is overdue
     */
    private isOverdue;
    /**
     * Check if material is due soon (within 3 days)
     */
    private isDueSoon;
    /**
     * Check if material has a low score (< 75%)
     */
    private isLowScore;
    /**
     * Get a specific material by ID for fetch operations
     */
    getMaterialById(childId: string, materialId: string): Promise<MaterialData | null>;
    /**
     * Get related materials (for enhanced context in fetch)
     */
    getRelatedMaterials(material: MaterialData): Promise<MaterialData[]>;
}
//# sourceMappingURL=searchService.d.ts.map
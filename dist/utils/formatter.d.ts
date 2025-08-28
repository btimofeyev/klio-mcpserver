/**
 * Enhanced Content Formatter for GPT-5 MCP Server
 *
 * Formats educational materials for optimal AI comprehension and tutoring support.
 * Provides structured, readable content that maintains educational context.
 */
import { QueryIntent } from './queryParser.js';
export interface SearchResult {
    id: string;
    title: string;
    url: string;
}
export interface FetchResult {
    id: string;
    title: string;
    text: string;
    url: string;
    metadata?: any;
}
export interface MaterialData {
    id: string;
    title: string;
    content_type: string;
    due_date?: string;
    completed_at?: string;
    grade_value?: number;
    grade_max_value?: number;
    grading_notes?: string;
    lesson_json?: any;
    parent_material_id?: string;
    is_primary_lesson?: boolean;
    child_subject_id: string;
}
export declare class ContentFormatter {
    /**
     * Format search results with urgency indicators and context
     */
    static formatSearchResults(materials: MaterialData[], intent: QueryIntent): SearchResult[];
    /**
     * Format complete educational content for fetch results
     */
    static formatEducationalContent(material: MaterialData): FetchResult;
    /**
     * Generate urgency indicators for material titles
     */
    private static getUrgencyIndicator;
    /**
     * Generate grade indicators for completed materials
     */
    private static getGradeIndicator;
    /**
     * Format the material header with key information
     */
    private static formatHeader;
    /**
     * Format lesson JSON content into readable educational content
     */
    private static formatLessonJson;
    /**
     * Generate structured metadata for AI tutoring context
     */
    private static generateMetadata;
    /**
     * Get grade level description
     */
    private static getGradeLevel;
    /**
     * Format content type for display
     */
    private static formatContentType;
    /**
     * Generate material URL for citation (public method)
     */
    static generateMaterialUrl(materialId: string): string;
    /**
     * Sort materials by educational priority
     */
    static sortByPriority(materials: MaterialData[], intent: QueryIntent): MaterialData[];
    /**
     * Check if material is overdue
     */
    private static isOverdue;
}
//# sourceMappingURL=formatter.d.ts.map
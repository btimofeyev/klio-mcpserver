/**
 * Intelligent Query Parser for GPT-5 MCP Server
 *
 * Parses natural language queries to extract intent, filters, and context
 * for better educational material search and retrieval.
 */
export interface QueryIntent {
    type: 'homework' | 'lesson' | 'review' | 'mixed';
    urgency?: 'overdue' | 'due_soon' | 'due_today';
    subject?: string;
    contentType?: 'assignment' | 'worksheet' | 'quiz' | 'test' | 'lesson' | 'reading';
    status?: 'incomplete' | 'completed' | 'low_scores';
    keywords: string[];
    originalQuery: string;
}
export interface ParsedQuery {
    childId: string;
    searchTerm: string;
    intent: QueryIntent;
}
export declare class QueryParser {
    private static HOMEWORK_PATTERNS;
    private static LESSON_PATTERNS;
    private static REVIEW_PATTERNS;
    private static SUBJECT_PATTERNS;
    private static CONTENT_TYPE_PATTERNS;
    private static URGENCY_PATTERNS;
    /**
     * Parse a query string to extract child_id and search terms
     */
    static parseQuery(query: string): ParsedQuery;
    /**
     * Parse the intent from a search term
     */
    private static parseIntent;
    /**
     * Extract subject from query
     */
    private static extractSubject;
    /**
     * Extract content type from query
     */
    private static extractContentType;
    /**
     * Extract urgency from query
     */
    private static extractUrgency;
    /**
     * Extract status from query
     */
    private static extractStatus;
    /**
     * Extract meaningful keywords from query, excluding common words
     */
    private static extractKeywords;
    /**
     * Generate search filters based on parsed intent
     */
    static generateFilters(intent: QueryIntent): any;
    /**
     * Generate a human-readable description of the parsed intent
     */
    static describeIntent(intent: QueryIntent): string;
    /**
     * Check if query is asking for homework/assignments specifically
     */
    static isHomeworkQuery(intent: QueryIntent): boolean;
    /**
     * Check if query is asking for learning materials specifically
     */
    static isLessonQuery(intent: QueryIntent): boolean;
    /**
     * Check if query is asking for review of completed work
     */
    static isReviewQuery(intent: QueryIntent): boolean;
}
//# sourceMappingURL=queryParser.d.ts.map
/**
 * Intelligent Query Parser for GPT-5 MCP Server
 *
 * Parses natural language queries to extract intent, filters, and context
 * for better educational material search and retrieval.
 */
export class QueryParser {
    // Patterns for detecting homework/assignment intent
    static HOMEWORK_PATTERNS = [
        /\b(homework|assignment|due|overdue|incomplete|finish|complete|work on)\b/i,
        /\b(what('s|\s+is)\s+(my|due))\b/i,
        /\b(need to (do|finish|complete))\b/i
    ];
    // Patterns for detecting lesson/learning intent  
    static LESSON_PATTERNS = [
        /\b(lesson|learn|teach|understand|explain|study|review)\b/i,
        /\b(help\s+(me\s+)?(with|understand))\b/i,
        /\b(what\s+(is|are)|how\s+do)\b/i
    ];
    // Patterns for detecting review intent
    static REVIEW_PATTERNS = [
        /\b(review|revisit|go\s+over|practice|low\s+score|grade|graded)\b/i,
        /\b(completed|finished|done)\b/i
    ];
    // Subject patterns
    static SUBJECT_PATTERNS = {
        'math': /\b(math|mathematics|algebra|geometry|calculus|arithmetic)\b/i,
        'science': /\b(science|biology|chemistry|physics)\b/i,
        'english': /\b(english|language\s+arts|writing|reading|literature)\b/i,
        'history': /\b(history|social\s+studies|geography)\b/i,
        'spanish': /\b(spanish|espanol)\b/i
    };
    // Content type patterns
    static CONTENT_TYPE_PATTERNS = {
        'worksheet': /\b(worksheet|work\s+sheet)\b/i,
        'quiz': /\b(quiz|quizzes)\b/i,
        'test': /\b(test|exam)\b/i,
        'assignment': /\b(assignment|project)\b/i,
        'lesson': /\b(lesson|chapter|reading)\b/i
    };
    // Urgency patterns
    static URGENCY_PATTERNS = {
        'overdue': /\b(overdue|late|past\s+due|missed)\b/i,
        'due_today': /\b(due\s+today|today)\b/i,
        'due_soon': /\b(due\s+soon|upcoming|tomorrow)\b/i
    };
    /**
     * Parse a query string to extract child_id and search terms
     */
    static parseQuery(query) {
        const defaultChildId = '058a3da2-0268-4d8c-995a-c732cd1b732a'; // Fallback
        let childId = defaultChildId;
        let searchTerm = query;
        // Extract child_id if present
        if (query.startsWith('child_id:')) {
            const parts = query.split(' ');
            childId = parts[0].replace('child_id:', '');
            searchTerm = parts.slice(1).join(' ');
        }
        const intent = this.parseIntent(searchTerm);
        return {
            childId,
            searchTerm: searchTerm.trim(),
            intent
        };
    }
    /**
     * Parse the intent from a search term
     */
    static parseIntent(query) {
        const lowerQuery = query.toLowerCase();
        const keywords = this.extractKeywords(query);
        // Determine primary intent type
        let type = 'mixed';
        const hasHomeworkPattern = this.HOMEWORK_PATTERNS.some(pattern => pattern.test(query));
        const hasLessonPattern = this.LESSON_PATTERNS.some(pattern => pattern.test(query));
        const hasReviewPattern = this.REVIEW_PATTERNS.some(pattern => pattern.test(query));
        if (hasHomeworkPattern && !hasLessonPattern && !hasReviewPattern) {
            type = 'homework';
        }
        else if (hasLessonPattern && !hasHomeworkPattern && !hasReviewPattern) {
            type = 'lesson';
        }
        else if (hasReviewPattern) {
            type = 'review';
        }
        // Extract other attributes
        const subject = this.extractSubject(query);
        const contentType = this.extractContentType(query);
        const urgency = this.extractUrgency(query);
        const status = this.extractStatus(query);
        return {
            type,
            urgency,
            subject,
            contentType,
            status,
            keywords,
            originalQuery: query
        };
    }
    /**
     * Extract subject from query
     */
    static extractSubject(query) {
        for (const [subject, pattern] of Object.entries(this.SUBJECT_PATTERNS)) {
            if (pattern.test(query)) {
                return subject;
            }
        }
        return undefined;
    }
    /**
     * Extract content type from query
     */
    static extractContentType(query) {
        for (const [contentType, pattern] of Object.entries(this.CONTENT_TYPE_PATTERNS)) {
            if (pattern.test(query)) {
                return contentType;
            }
        }
        return undefined;
    }
    /**
     * Extract urgency from query
     */
    static extractUrgency(query) {
        for (const [urgency, pattern] of Object.entries(this.URGENCY_PATTERNS)) {
            if (pattern.test(query)) {
                return urgency;
            }
        }
        return undefined;
    }
    /**
     * Extract status from query
     */
    static extractStatus(query) {
        if (/\b(incomplete|unfinished|not\s+done)\b/i.test(query)) {
            return 'incomplete';
        }
        if (/\b(completed|finished|done)\b/i.test(query)) {
            return 'completed';
        }
        if (/\b(low\s+score|poor\s+grade|failed|below|under)\b/i.test(query)) {
            return 'low_scores';
        }
        return undefined;
    }
    /**
     * Extract meaningful keywords from query, excluding common words
     */
    static extractKeywords(query) {
        const stopWords = new Set([
            'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
            'by', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
            'should', 'may', 'might', 'can', 'what', 'where', 'when', 'why', 'how',
            'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'my', 'help'
        ]);
        return query
            .toLowerCase()
            .replace(/[^\w\s]/g, '') // Remove punctuation
            .split(/\s+/)
            .filter(word => word.length > 2 && !stopWords.has(word))
            .slice(0, 10); // Limit to top 10 keywords
    }
    /**
     * Generate search filters based on parsed intent
     */
    static generateFilters(intent) {
        const filters = {};
        // Content type filter
        if (intent.contentType) {
            filters.content_type = intent.contentType;
        }
        else if (intent.type === 'homework') {
            filters.content_types = ['lesson', 'worksheet', 'quiz', 'review'];
        }
        else if (intent.type === 'lesson') {
            filters.content_types = ['lesson', 'reading', 'chapter'];
        }
        // Status filter
        if (intent.status === 'incomplete') {
            filters.completed = false;
        }
        else if (intent.status === 'completed') {
            filters.completed = true;
        }
        else if (intent.status === 'low_scores') {
            filters.completed = true;
            filters.low_grade = true;
        }
        // Urgency filter
        if (intent.urgency === 'overdue') {
            filters.overdue = true;
        }
        else if (intent.urgency === 'due_today') {
            filters.due_today = true;
        }
        else if (intent.urgency === 'due_soon') {
            filters.due_within_days = 3;
        }
        return filters;
    }
    /**
     * Generate a human-readable description of the parsed intent
     */
    static describeIntent(intent) {
        const parts = [];
        if (intent.urgency === 'overdue')
            parts.push('overdue');
        if (intent.status === 'incomplete')
            parts.push('incomplete');
        if (intent.subject)
            parts.push(intent.subject);
        if (intent.contentType)
            parts.push(intent.contentType);
        const contentDescription = parts.length > 0 ? parts.join(' ') : intent.type;
        return `Searching for ${contentDescription} materials`;
    }
    /**
     * Check if query is asking for homework/assignments specifically
     */
    static isHomeworkQuery(intent) {
        return intent.type === 'homework' ||
            intent.status === 'incomplete' ||
            ['lesson', 'worksheet', 'quiz', 'review'].includes(intent.contentType || '');
    }
    /**
     * Check if query is asking for learning materials specifically
     */
    static isLessonQuery(intent) {
        return intent.type === 'lesson' ||
            ['lesson', 'reading', 'chapter'].includes(intent.contentType || '');
    }
    /**
     * Check if query is asking for review of completed work
     */
    static isReviewQuery(intent) {
        return intent.type === 'review' ||
            intent.status === 'completed' ||
            intent.status === 'low_scores';
    }
}
//# sourceMappingURL=queryParser.js.map
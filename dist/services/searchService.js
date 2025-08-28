/**
 * Unified Search Service for GPT-5 MCP Server
 *
 * Intelligently combines lessons and student work searches based on query intent.
 * Provides enhanced filtering and ranking for optimal educational AI tutoring.
 */
import { QueryParser } from '../utils/queryParser.js';
import { ContentFormatter } from '../utils/formatter.js';
export class SearchService {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    /**
     * Perform intelligent search based on parsed query intent
     */
    async intelligentSearch(childId, query) {
        console.log(`🔍 Starting intelligent search for child ${childId}: "${query}"`);
        const parsed = QueryParser.parseQuery(`child_id:${childId} ${query}`);
        const { intent } = parsed;
        console.log('🧠 Parsed intent:', JSON.stringify(intent, null, 2));
        // Get child subject IDs
        const childSubjectIds = await this.getChildSubjects(childId);
        if (childSubjectIds.length === 0) {
            console.warn('⚠️ No child_subjects found for child_id:', childId);
            return [];
        }
        // Execute search based on intent
        const materials = await this.executeSearch(childSubjectIds, intent);
        console.log(`📊 Found ${materials.length} materials before ranking`);
        // Apply intelligent ranking and filtering
        const rankedMaterials = this.rankResults(materials, intent);
        const limitedResults = rankedMaterials.slice(0, 15); // Limit results for GPT-5
        console.log(`✅ Returning ${limitedResults.length} ranked results`);
        // Format for GPT-5 compatibility
        return ContentFormatter.formatSearchResults(limitedResults, intent);
    }
    /**
     * Get child subject IDs for a given child with retry logic
     */
    async getChildSubjects(childId) {
        console.log('🆔 Getting child subjects for:', childId);
        // Add connection timeout and retry logic
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const result = await this.pool.query('SELECT id FROM child_subjects WHERE child_id = $1', [childId]);
                const childSubjectIds = result.rows.map((row) => row.id);
                console.log(`📊 Found ${childSubjectIds.length} child_subjects`);
                return childSubjectIds;
            }
            catch (error) {
                console.log(`⚠️  Database attempt ${attempt}/3 failed:`, error.message);
                if (attempt === 3) {
                    console.error('❌ All database attempts failed, returning fallback data');
                    // Return empty array to allow graceful degradation
                    return [];
                }
                // Wait before retry (exponential backoff)
                await new Promise(resolve => setTimeout(resolve, attempt * 1000));
            }
        }
        return [];
    }
    /**
     * Execute search with intelligent filtering based on intent
     */
    async executeSearch(childSubjectIds, intent) {
        let baseQuery = `
      SELECT 
        id, title, content_type, due_date, completed_at,
        grade_value, grade_max_value, grading_notes, lesson_json,
        parent_material_id, is_primary_lesson, child_subject_id
      FROM materials 
      WHERE child_subject_id = ANY($1::uuid[])
    `;
        const params = [childSubjectIds];
        let paramCount = 1;
        // Apply content type filters based on intent
        const contentTypes = this.getContentTypes(intent);
        if (contentTypes.length > 0) {
            paramCount++;
            baseQuery += ` AND content_type = ANY($${paramCount}::text[])`;
            params.push(contentTypes);
        }
        // Apply status filters
        if (intent.status === 'incomplete') {
            baseQuery += ` AND completed_at IS NULL`;
        }
        else if (intent.status === 'completed') {
            baseQuery += ` AND completed_at IS NOT NULL`;
        }
        else if (intent.status === 'low_scores') {
            baseQuery += ` AND completed_at IS NOT NULL AND grade_value IS NOT NULL AND grade_max_value IS NOT NULL`;
            baseQuery += ` AND (grade_value::float / grade_max_value::float) < 0.75`;
        }
        // Apply urgency filters
        const now = new Date().toISOString();
        if (intent.urgency === 'overdue') {
            baseQuery += ` AND due_date < $${++paramCount} AND completed_at IS NULL`;
            params.push(now);
        }
        else if (intent.urgency === 'due_today') {
            const today = new Date();
            const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
            const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();
            baseQuery += ` AND due_date >= $${++paramCount} AND due_date < $${++paramCount} AND completed_at IS NULL`;
            params.push(todayStart, todayEnd);
        }
        else if (intent.urgency === 'due_soon') {
            const threeDaysFromNow = new Date();
            threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
            baseQuery += ` AND due_date <= $${++paramCount} AND due_date >= $${++paramCount} AND completed_at IS NULL`;
            params.push(threeDaysFromNow.toISOString(), now);
        }
        // Apply keyword search
        if (intent.keywords.length > 0) {
            const searchTerms = intent.keywords.join(' | ');
            paramCount++;
            baseQuery += ` AND (title ILIKE $${paramCount} OR lesson_json::text ILIKE $${paramCount})`;
            params.push(`%${searchTerms}%`);
        }
        // Subject-specific search (if we can determine subject from title or content)
        if (intent.subject) {
            paramCount++;
            baseQuery += ` AND (title ILIKE $${paramCount} OR lesson_json::text ILIKE $${paramCount})`;
            params.push(`%${intent.subject}%`);
        }
        // Ordering - prioritize by educational importance
        baseQuery += ` ORDER BY 
      CASE WHEN completed_at IS NULL AND due_date < NOW() THEN 1 ELSE 2 END,
      CASE WHEN completed_at IS NULL THEN 1 ELSE 2 END,
      due_date ASC NULLS LAST,
      title ASC
      LIMIT 20
    `;
        console.log('📊 Executing enhanced search query...');
        console.log('🔍 Query:', baseQuery.replace(/\s+/g, ' '));
        console.log('📝 Params:', params);
        // Add retry logic for search query
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const result = await this.pool.query(baseQuery, params);
                console.log(`✅ Database returned ${result.rows.length} materials`);
                return result.rows;
            }
            catch (error) {
                console.log(`⚠️  Search attempt ${attempt}/2 failed:`, error.message);
                if (attempt === 2) {
                    console.error('❌ Search failed, returning empty results');
                    return [];
                }
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }
        return [];
    }
    /**
     * Determine appropriate content types based on intent
     */
    getContentTypes(intent) {
        if (intent.contentType) {
            return [intent.contentType];
        }
        switch (intent.type) {
            case 'homework':
                return ['lesson', 'worksheet', 'quiz', 'review'];
            case 'lesson':
                return ['lesson', 'reading', 'chapter'];
            case 'review':
                // For review, include both educational and assessment materials
                return ['lesson', 'worksheet', 'quiz', 'review'];
            case 'mixed':
            default:
                return []; // No filter, search all types
        }
    }
    /**
     * Apply intelligent ranking based on educational priorities and intent
     */
    rankResults(materials, intent) {
        return materials.sort((a, b) => {
            // Priority 1: Overdue items (critical)
            const aOverdue = this.isOverdue(a);
            const bOverdue = this.isOverdue(b);
            if (aOverdue && !bOverdue)
                return -1;
            if (!aOverdue && bOverdue)
                return 1;
            // Priority 2: Intent-based scoring
            const aScore = this.calculateRelevanceScore(a, intent);
            const bScore = this.calculateRelevanceScore(b, intent);
            if (aScore !== bScore)
                return bScore - aScore;
            // Priority 3: Due date proximity for incomplete items
            if (!a.completed_at && !b.completed_at && a.due_date && b.due_date) {
                return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
            }
            // Priority 4: Completion status (for homework queries, incomplete first)
            if (intent.type === 'homework') {
                const aIncomplete = !a.completed_at;
                const bIncomplete = !b.completed_at;
                if (aIncomplete && !bIncomplete)
                    return -1;
                if (!aIncomplete && bIncomplete)
                    return 1;
            }
            // Priority 5: Grade-based ranking (for review queries, low scores first)
            if (intent.status === 'low_scores' && a.grade_value && b.grade_value && a.grade_max_value && b.grade_max_value) {
                const aPercentage = (a.grade_value / a.grade_max_value) * 100;
                const bPercentage = (b.grade_value / b.grade_max_value) * 100;
                return aPercentage - bPercentage; // Lower grades first for review
            }
            // Priority 6: Alphabetical by title
            return a.title.localeCompare(b.title);
        });
    }
    /**
     * Calculate relevance score based on intent matching
     */
    calculateRelevanceScore(material, intent) {
        let score = 0;
        // Content type match
        const contentTypes = this.getContentTypes(intent);
        if (contentTypes.length === 0 || contentTypes.includes(material.content_type)) {
            score += 10;
        }
        // Keyword matching in title
        const titleLower = material.title.toLowerCase();
        const keywordMatches = intent.keywords.filter(keyword => titleLower.includes(keyword.toLowerCase())).length;
        score += keywordMatches * 5;
        // Subject matching
        if (intent.subject && titleLower.includes(intent.subject.toLowerCase())) {
            score += 8;
        }
        // Status relevance
        if (intent.status === 'incomplete' && !material.completed_at) {
            score += 15;
        }
        else if (intent.status === 'completed' && material.completed_at) {
            score += 15;
        }
        else if (intent.status === 'low_scores' && this.isLowScore(material)) {
            score += 20;
        }
        // Urgency bonus
        if (intent.urgency === 'overdue' && this.isOverdue(material)) {
            score += 25; // High priority for overdue items
        }
        else if (intent.urgency === 'due_soon' && this.isDueSoon(material)) {
            score += 12;
        }
        // Primary lesson bonus (for lesson searches)
        if (intent.type === 'lesson' && material.is_primary_lesson) {
            score += 8;
        }
        return score;
    }
    /**
     * Check if material is overdue
     */
    isOverdue(material) {
        if (!material.due_date || material.completed_at)
            return false;
        return new Date(material.due_date) < new Date();
    }
    /**
     * Check if material is due soon (within 3 days)
     */
    isDueSoon(material) {
        if (!material.due_date || material.completed_at)
            return false;
        const dueDate = new Date(material.due_date);
        const now = new Date();
        const diffDays = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        return diffDays >= 0 && diffDays <= 3;
    }
    /**
     * Check if material has a low score (< 75%)
     */
    isLowScore(material) {
        if (!material.grade_value || !material.grade_max_value)
            return false;
        const percentage = (material.grade_value / material.grade_max_value) * 100;
        return percentage < 75;
    }
    /**
     * Get a specific material by ID for fetch operations
     */
    async getMaterialById(childId, materialId) {
        console.log(`📚 Fetching material ${materialId} for child ${childId}`);
        const childSubjectIds = await this.getChildSubjects(childId);
        if (childSubjectIds.length === 0) {
            return null;
        }
        const query = `
      SELECT 
        id, title, content_type, due_date, completed_at,
        grade_value, grade_max_value, grading_notes, lesson_json,
        parent_material_id, is_primary_lesson, child_subject_id
      FROM materials
      WHERE id = $1 AND child_subject_id = ANY($2::uuid[])
      LIMIT 1
    `;
        const result = await this.pool.query(query, [materialId, childSubjectIds]);
        if (result.rows.length === 0) {
            console.warn('⚠️ Material not found:', materialId);
            return null;
        }
        console.log('✅ Found material:', result.rows[0].title);
        return result.rows[0];
    }
    /**
     * Get related materials (for enhanced context in fetch)
     */
    async getRelatedMaterials(material) {
        if (!material.parent_material_id) {
            return [];
        }
        const query = `
      SELECT 
        id, title, content_type, due_date, completed_at,
        grade_value, grade_max_value, grading_notes, lesson_json,
        parent_material_id, is_primary_lesson, child_subject_id
      FROM materials
      WHERE (parent_material_id = $1 OR id = $1) 
        AND id != $2 
        AND child_subject_id = $3
      ORDER BY is_primary_lesson DESC, title ASC
      LIMIT 5
    `;
        const result = await this.pool.query(query, [
            material.parent_material_id,
            material.id,
            material.child_subject_id
        ]);
        return result.rows;
    }
}
//# sourceMappingURL=searchService.js.map
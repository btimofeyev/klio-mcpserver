/**
 * Enhanced Content Formatter for GPT-5 MCP Server
 *
 * Formats educational materials for optimal AI comprehension and tutoring support.
 * Provides structured, readable content that maintains educational context.
 */
export class ContentFormatter {
    /**
     * Format search results with urgency indicators and context
     */
    static formatSearchResults(materials, intent) {
        return materials.map(material => {
            const urgencyIndicator = this.getUrgencyIndicator(material);
            const gradeIndicator = this.getGradeIndicator(material);
            const title = `${material.title}${urgencyIndicator}${gradeIndicator}`;
            return {
                id: material.id,
                title,
                url: ContentFormatter.generateMaterialUrl(material.id)
            };
        });
    }
    /**
     * Format complete educational content for fetch results
     */
    static formatEducationalContent(material) {
        const sections = [];
        // Header with material info
        sections.push(this.formatHeader(material));
        sections.push('');
        // Parse and format lesson content
        if (material.lesson_json) {
            const lessonContent = this.formatLessonJson(material);
            sections.push(...lessonContent);
        }
        // Teacher notes and grading info
        if (material.grading_notes) {
            sections.push('📝 **TEACHER FEEDBACK:**');
            sections.push(material.grading_notes);
            sections.push('');
        }
        const fullContent = sections.join('\n');
        const metadata = this.generateMetadata(material);
        return {
            id: material.id,
            title: material.title,
            text: fullContent,
            url: ContentFormatter.generateMaterialUrl(material.id),
            metadata
        };
    }
    /**
     * Generate urgency indicators for material titles
     */
    static getUrgencyIndicator(material) {
        if (!material.due_date || material.completed_at) {
            return '';
        }
        const dueDate = new Date(material.due_date);
        const now = new Date();
        const diffDays = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays < 0) {
            return ' 🚨 **OVERDUE**';
        }
        else if (diffDays === 0) {
            return ' ⚠️ **DUE TODAY**';
        }
        else if (diffDays === 1) {
            return ' ⏰ **DUE TOMORROW**';
        }
        else if (diffDays <= 3) {
            return ` ⏰ **DUE IN ${diffDays} DAYS**`;
        }
        return '';
    }
    /**
     * Generate grade indicators for completed materials
     */
    static getGradeIndicator(material) {
        if (!material.completed_at || !material.grade_value || !material.grade_max_value) {
            return '';
        }
        const percentage = Math.round((material.grade_value / material.grade_max_value) * 100);
        if (percentage >= 90) {
            return ` 🅰️ ${percentage}%`;
        }
        else if (percentage >= 80) {
            return ` 🅱️ ${percentage}%`;
        }
        else if (percentage >= 70) {
            return ` 🆔 ${percentage}%`;
        }
        else if (percentage >= 60) {
            return ` 🆘 ${percentage}%`;
        }
        else {
            return ` ❌ ${percentage}%`;
        }
    }
    /**
     * Format the material header with key information
     */
    static formatHeader(material) {
        const sections = [];
        // Title and type
        sections.push(`📚 **${material.title}**`);
        sections.push(`📋 **Type:** ${this.formatContentType(material.content_type)}`);
        // Due date and completion status
        if (material.due_date) {
            const dueDate = new Date(material.due_date).toLocaleDateString();
            if (material.completed_at) {
                const completedDate = new Date(material.completed_at).toLocaleDateString();
                sections.push(`✅ **Completed:** ${completedDate} (Due: ${dueDate})`);
            }
            else {
                const urgency = this.getUrgencyIndicator(material);
                sections.push(`📅 **Due Date:** ${dueDate}${urgency}`);
            }
        }
        else if (material.completed_at) {
            const completedDate = new Date(material.completed_at).toLocaleDateString();
            sections.push(`✅ **Completed:** ${completedDate}`);
        }
        else {
            sections.push('📋 **Status:** Not Started');
        }
        // Grade information
        if (material.grade_value && material.grade_max_value) {
            const percentage = Math.round((material.grade_value / material.grade_max_value) * 100);
            const gradeIcon = this.getGradeIndicator(material);
            sections.push(`📊 **Grade:** ${material.grade_value}/${material.grade_max_value}${gradeIcon}`);
        }
        return sections.join('\n');
    }
    /**
     * Format lesson JSON content into readable educational content
     */
    static formatLessonJson(material) {
        const sections = [];
        try {
            const lessonData = typeof material.lesson_json === 'string'
                ? JSON.parse(material.lesson_json)
                : material.lesson_json;
            // Learning objectives (priority content)
            if (lessonData.learning_objectives?.length > 0) {
                sections.push('🎯 **LEARNING OBJECTIVES:**');
                lessonData.learning_objectives.forEach((obj, index) => {
                    sections.push(`${index + 1}. ${obj}`);
                });
                sections.push('');
            }
            // Main content summary
            if (lessonData.main_content_summary_or_extract) {
                sections.push('📖 **LESSON CONTENT:**');
                sections.push(lessonData.main_content_summary_or_extract);
                sections.push('');
            }
            // Tasks and questions
            if (lessonData.tasks_or_questions?.length > 0) {
                sections.push('❓ **TASKS & QUESTIONS:**');
                lessonData.tasks_or_questions.forEach((task, index) => {
                    sections.push(`**${index + 1}.** ${task}`);
                });
                sections.push('');
            }
            // Worksheet questions (assignments/worksheets)
            if (lessonData.worksheet_questions?.length > 0) {
                sections.push('📝 **WORKSHEET QUESTIONS:**');
                lessonData.worksheet_questions.forEach((question, index) => {
                    sections.push(`**${index + 1}.** ${question}`);
                });
                sections.push('');
            }
            // Answer key (for completed work or lesson materials)
            if (lessonData.answer_key && Object.keys(lessonData.answer_key).length > 0) {
                sections.push('🔑 **ANSWER KEY:**');
                Object.entries(lessonData.answer_key).forEach(([key, value]) => {
                    sections.push(`**${key}:** ${value}`);
                });
                sections.push('');
            }
            // Key topics and vocabulary
            if (lessonData.subject_keywords_or_subtopics?.length > 0) {
                const topicsList = lessonData.subject_keywords_or_subtopics.slice(0, 8).join(', ');
                sections.push(`🔑 **KEY TOPICS:** ${topicsList}`);
                sections.push('');
            }
            // Additional educational notes
            if (lessonData.additional_notes) {
                sections.push('📓 **ADDITIONAL NOTES:**');
                sections.push(lessonData.additional_notes);
                sections.push('');
            }
        }
        catch (error) {
            console.warn(`Failed to parse lesson_json for material ${material.id}:`, error);
            sections.push('⚠️ **Note:** Some content formatting may be limited due to data structure.');
            sections.push('');
        }
        return sections;
    }
    /**
     * Generate structured metadata for AI tutoring context
     */
    static generateMetadata(material) {
        const metadata = {
            content_type: material.content_type,
            is_educational_material: true
        };
        // Status information
        metadata.status = material.completed_at ? 'completed' : 'incomplete';
        if (material.due_date) {
            metadata.due_date = material.due_date;
            const dueDate = new Date(material.due_date);
            const now = new Date();
            const diffDays = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays < 0) {
                metadata.urgency = 'overdue';
                metadata.days_overdue = Math.abs(diffDays);
            }
            else if (diffDays <= 3) {
                metadata.urgency = 'due_soon';
                metadata.days_until_due = diffDays;
            }
        }
        // Grade information
        if (material.grade_value && material.grade_max_value) {
            metadata.grade_percentage = Math.round((material.grade_value / material.grade_max_value) * 100);
            metadata.grade_raw = `${material.grade_value}/${material.grade_max_value}`;
            metadata.grade_level = this.getGradeLevel(metadata.grade_percentage);
        }
        // Completion information
        if (material.completed_at) {
            metadata.completed_date = material.completed_at;
        }
        // Educational context
        if (material.lesson_json) {
            try {
                const lessonData = typeof material.lesson_json === 'string'
                    ? JSON.parse(material.lesson_json)
                    : material.lesson_json;
                if (lessonData.learning_objectives?.length > 0) {
                    metadata.learning_objectives = lessonData.learning_objectives;
                }
                if (lessonData.subject_keywords_or_subtopics?.length > 0) {
                    metadata.key_topics = lessonData.subject_keywords_or_subtopics.slice(0, 5);
                }
                if (lessonData.tasks_or_questions?.length > 0) {
                    metadata.question_count = lessonData.tasks_or_questions.length;
                }
                if (lessonData.worksheet_questions?.length > 0) {
                    metadata.worksheet_question_count = lessonData.worksheet_questions.length;
                }
            }
            catch (error) {
                // Ignore parsing errors for metadata
            }
        }
        return metadata;
    }
    /**
     * Get grade level description
     */
    static getGradeLevel(percentage) {
        if (percentage >= 90)
            return 'A';
        if (percentage >= 80)
            return 'B';
        if (percentage >= 70)
            return 'C';
        if (percentage >= 60)
            return 'D';
        return 'F';
    }
    /**
     * Format content type for display
     */
    static formatContentType(contentType) {
        const typeMap = {
            'assignment': 'Assignment',
            'worksheet': 'Worksheet',
            'quiz': 'Quiz',
            'test': 'Test',
            'lesson': 'Lesson',
            'reading': 'Reading Material',
            'chapter': 'Chapter',
            'review': 'Review Material'
        };
        return typeMap[contentType] || contentType.charAt(0).toUpperCase() + contentType.slice(1);
    }
    /**
     * Generate material URL for citation (public method)
     */
    static generateMaterialUrl(materialId) {
        // Use Railway app URL or internal reference
        return `https://klio-mcpserver-production.up.railway.app/material/${materialId}`;
    }
    /**
     * Sort materials by educational priority
     */
    static sortByPriority(materials, intent) {
        return materials.sort((a, b) => {
            // Overdue items first
            const aOverdue = this.isOverdue(a);
            const bOverdue = this.isOverdue(b);
            if (aOverdue && !bOverdue)
                return -1;
            if (!aOverdue && bOverdue)
                return 1;
            // Incomplete items next (for homework queries)
            if (intent.type === 'homework') {
                const aIncomplete = !a.completed_at;
                const bIncomplete = !b.completed_at;
                if (aIncomplete && !bIncomplete)
                    return -1;
                if (!aIncomplete && bIncomplete)
                    return 1;
            }
            // Sort by due date (earliest first)
            if (a.due_date && b.due_date) {
                return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
            }
            if (a.due_date && !b.due_date)
                return -1;
            if (!a.due_date && b.due_date)
                return 1;
            // Sort by title alphabetically
            return a.title.localeCompare(b.title);
        });
    }
    /**
     * Check if material is overdue
     */
    static isOverdue(material) {
        if (!material.due_date || material.completed_at)
            return false;
        return new Date(material.due_date) < new Date();
    }
}
//# sourceMappingURL=formatter.js.map
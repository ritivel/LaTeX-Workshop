import * as vscode from 'vscode'

/**
 * Maps PDF text to LaTeX source text, handling normalization and formatting differences.
 */
export class TextMapper {
    /**
     * Finds the best match for PDF text in LaTeX source.
     *
     * @param pdfText The text extracted from PDF
     * @param sourceText The LaTeX source text
     * @param startLine Line number to start searching from (0-indexed)
     * @param startColumn Column number to start searching from (0-indexed)
     * @returns Object with line, column, and matched text, or null if not found
     */
    static findTextInSource(
        pdfText: string,
        sourceText: string,
        startLine: number,
        startColumn: number
    ): { line: number; column: number; text: string } | null {
        // Normalize PDF text: remove extra whitespace, normalize line breaks
        const normalizedPdfText = this.normalizeText(pdfText)

        if (!normalizedPdfText.trim()) {
            return null
        }

        // Split source into lines
        const lines = sourceText.split(/\r?\n/)

        // Start searching from the given position
        let searchStartLine = Math.max(0, startLine)
        let searchStartColumn = Math.max(0, startColumn)

        // Try exact match first
        let match = this.findExactMatch(normalizedPdfText, lines, searchStartLine, searchStartColumn)
        if (match) {
            return match
        }

        // Try fuzzy match (allowing for some differences)
        match = this.findFuzzyMatch(normalizedPdfText, lines, searchStartLine, searchStartColumn)
        if (match) {
            return match
        }

        // Try matching without LaTeX commands
        match = this.findMatchWithoutCommands(normalizedPdfText, lines, searchStartLine, searchStartColumn)
        if (match) {
            return match
        }

        return null
    }

    /**
     * Normalizes text by removing extra whitespace and normalizing line breaks.
     */
    private static normalizeText(text: string): string {
        return text
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/\s+/g, ' ')
            .trim()
    }

    /**
     * Finds exact match of normalized text in source.
     */
    private static findExactMatch(
        normalizedText: string,
        lines: string[],
        startLine: number,
        startColumn: number
    ): { line: number; column: number; text: string } | null {
        // Search from start position
        for (let lineIdx = startLine; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx]
            const startCol = lineIdx === startLine ? startColumn : 0
            const normalizedLine = this.normalizeText(line.substring(startCol))

            const index = normalizedLine.indexOf(normalizedText)
            if (index !== -1) {
                // Find the actual column position accounting for normalization
                const actualColumn = this.findActualColumn(
                    line,
                    startCol,
                    normalizedText,
                    index
                )
                return {
                    line: lineIdx,
                    column: actualColumn,
                    text: normalizedText
                }
            }
        }
        return null
    }

    /**
     * Finds fuzzy match allowing for minor differences.
     */
    private static findFuzzyMatch(
        normalizedText: string,
        lines: string[],
        startLine: number,
        startColumn: number
    ): { line: number; column: number; text: string } | null {
        const words = normalizedText.split(/\s+/).filter(w => w.length > 0)
        if (words.length === 0) {
            return null
        }

        // Try to find a sequence of words
        for (let lineIdx = startLine; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx]
            const startCol = lineIdx === startLine ? startColumn : 0
            const normalizedLine = this.normalizeText(line.substring(startCol))

            // Check if most words are present
            let matchCount = 0
            let firstWordIndex = -1
            for (const word of words) {
                const index = normalizedLine.indexOf(word)
                if (index !== -1) {
                    matchCount++
                    if (firstWordIndex === -1 || index < firstWordIndex) {
                        firstWordIndex = index
                    }
                }
            }

            // If most words match, consider it a match
            if (matchCount >= Math.ceil(words.length * 0.7) && firstWordIndex !== -1) {
                const actualColumn = this.findActualColumn(
                    line,
                    startCol,
                    normalizedText.substring(0, normalizedText.indexOf(words[0]) + words[0].length),
                    firstWordIndex
                )
                return {
                    line: lineIdx,
                    column: actualColumn,
                    text: normalizedText
                }
            }
        }
        return null
    }

    /**
     * Finds match by removing LaTeX commands from source text.
     */
    private static findMatchWithoutCommands(
        normalizedText: string,
        lines: string[],
        startLine: number,
        startColumn: number
    ): { line: number; column: number; text: string } | null {
        // Remove LaTeX commands from source for matching
        for (let lineIdx = startLine; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx]
            const startCol = lineIdx === startLine ? startColumn : 0
            const lineWithoutCommands = this.removeLaTeXCommands(line.substring(startCol))
            const normalizedLineWithoutCommands = this.normalizeText(lineWithoutCommands)

            const index = normalizedLineWithoutCommands.indexOf(normalizedText)
            if (index !== -1) {
                // Map back to original column position
                const actualColumn = this.findActualColumnInTextWithoutCommands(
                    line,
                    startCol,
                    normalizedText,
                    index
                )
                return {
                    line: lineIdx,
                    column: actualColumn,
                    text: normalizedText
                }
            }
        }
        return null
    }

    /**
     * Removes LaTeX commands from text, keeping only the visible content.
     */
    private static removeLaTeXCommands(text: string): string {
        // Remove LaTeX commands like \command{...}, \command[...], etc.
        // This is a simplified version - a full implementation would need a proper LaTeX parser
        return text
            .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{[^\}]*\})?/g, '') // \command{...} or \command[...]
            .replace(/\\[^a-zA-Z\s]/g, '') // Special characters like \&, \%, etc.
            .replace(/\{[^\}]*\}/g, '') // Remaining braces
            .replace(/\s+/g, ' ')
            .trim()
    }

    /**
     * Finds the actual column position accounting for text normalization.
     */
    private static findActualColumn(
        originalLine: string,
        startColumn: number,
        _searchText: string,
        normalizedIndex: number
    ): number {
        // This is an approximation - in practice, we'd need more sophisticated mapping
        const substring = originalLine.substring(startColumn)
        const normalizedSubstring = this.normalizeText(substring)

        // Find position in original text that corresponds to normalized index
        let normalizedPos = 0
        let originalPos = 0

        while (normalizedPos < normalizedIndex && originalPos < substring.length) {
            const char = substring[originalPos]
            if (!/\s/.test(char) || (normalizedPos > 0 && normalizedSubstring[normalizedPos - 1] === ' ')) {
                normalizedPos++
            }
            originalPos++
        }

        return startColumn + originalPos
    }

    /**
     * Finds actual column when matching against text with LaTeX commands removed.
     */
    private static findActualColumnInTextWithoutCommands(
        originalLine: string,
        startColumn: number,
        _searchText: string,
        normalizedIndex: number
    ): number {
        // Simplified version - would need more sophisticated mapping
        const substring = originalLine.substring(startColumn)
        const withoutCommands = this.removeLaTeXCommands(substring)
        const normalized = this.normalizeText(withoutCommands)

        // Approximate position
        const ratio = normalizedIndex / normalized.length
        const approximatePos = Math.floor(ratio * substring.length)

        return startColumn + approximatePos
    }

    /**
     * Extracts text context around a given position in source file.
     */
    static getTextContext(
        document: vscode.TextDocument,
        line: number,
        _column: number,
        contextLines: number = 2
    ): string {
        const startLine = Math.max(0, line - contextLines)
        const endLine = Math.min(document.lineCount - 1, line + contextLines)

        const context: string[] = []
        for (let i = startLine; i <= endLine; i++) {
            context.push(document.lineAt(i).text)
        }

        return context.join('\n')
    }
}


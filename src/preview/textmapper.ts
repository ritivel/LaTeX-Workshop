import * as vscode from 'vscode'

/**
 * Maps PDF text to LaTeX source text, handling normalization and formatting differences.
 * Uses advanced string matching algorithms for character-level accuracy.
 */
export class TextMapper {
    /**
     * Finds the best match for PDF text in LaTeX source.
     *
     * @param pdfText The text extracted from PDF
     * @param sourceText The LaTeX source text
     * @param startLine Line number to start searching from (0-indexed)
     * @param startColumn Column number to start searching from (0-indexed)
     * @returns Object with line, column, matched text, and confidence, or null if not found
     */
    static findTextInSource(
        pdfText: string,
        sourceText: string,
        startLine: number,
        startColumn: number
    ): { line: number; column: number; text: string; confidence: number } | null {
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

        // Try exact match first (highest confidence)
        const exactMatch = this.findExactMatch(normalizedPdfText, lines, searchStartLine, searchStartColumn)
        if (exactMatch) {
            return { ...exactMatch, confidence: 1.0 }
        }

        // Try Smith-Waterman local alignment (best for partial matches)
        const smithWatermanMatch = this.findWithSmithWaterman(normalizedPdfText, lines, searchStartLine, searchStartColumn)
        if (smithWatermanMatch && smithWatermanMatch.confidence > 0.8) {
            return smithWatermanMatch
        }

        // Try Levenshtein-based fuzzy match
        const levenshteinMatch = this.findWithLevenshtein(normalizedPdfText, lines, searchStartLine, searchStartColumn)
        if (levenshteinMatch && levenshteinMatch.confidence > 0.7) {
            return levenshteinMatch
        }

        // Try LCS-based matching
        const lcsMatch = this.findWithLCS(normalizedPdfText, lines, searchStartLine, searchStartColumn)
        if (lcsMatch && lcsMatch.confidence > 0.7) {
            return lcsMatch
        }

        // Try fuzzy match (word-based, legacy)
        const fuzzyMatch = this.findFuzzyMatch(normalizedPdfText, lines, searchStartLine, searchStartColumn)
        if (fuzzyMatch) {
            return { ...fuzzyMatch, confidence: 0.6 }
        }

        // Try matching without LaTeX commands
        const noCommandsMatch = this.findMatchWithoutCommands(normalizedPdfText, lines, searchStartLine, searchStartColumn)
        if (noCommandsMatch) {
            return { ...noCommandsMatch, confidence: 0.5 }
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
     * Levenshtein distance between two strings.
     */
    private static levenshteinDistance(str1: string, str2: string): number {
        const m = str1.length
        const n = str2.length
        const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))

        for (let i = 0; i <= m; i++) dp[i][0] = i
        for (let j = 0; j <= n; j++) dp[0][j] = j

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (str1[i - 1] === str2[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1]
                } else {
                    dp[i][j] = Math.min(
                        dp[i - 1][j] + 1,      // deletion
                        dp[i][j - 1] + 1,      // insertion
                        dp[i - 1][j - 1] + 1   // substitution
                    )
                }
            }
        }
        return dp[m][n]
    }

    /**
     * Calculates similarity score (0-1) using normalized Levenshtein distance.
     */
    private static similarity(str1: string, str2: string): number {
        const maxLen = Math.max(str1.length, str2.length)
        if (maxLen === 0) return 1.0
        const distance = this.levenshteinDistance(str1, str2)
        return 1 - (distance / maxLen)
    }

    /**
     * Longest Common Subsequence (LCS) between two strings.
     */
    private static longestCommonSubsequence(str1: string, str2: string): string {
        const m = str1.length
        const n = str2.length
        const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (str1[i - 1] === str2[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
                }
            }
        }

        // Reconstruct LCS
        let i = m, j = n
        const lcs: string[] = []
        while (i > 0 && j > 0) {
            if (str1[i - 1] === str2[j - 1]) {
                lcs.unshift(str1[i - 1])
                i--
                j--
            } else if (dp[i - 1][j] > dp[i][j - 1]) {
                i--
            } else {
                j--
            }
        }
        return lcs.join('')
    }

    /**
     * Smith-Waterman algorithm for local sequence alignment.
     * Returns the best local alignment with score and position.
     */
    private static smithWaterman(
        pdfText: string,
        sourceText: string,
        matchScore: number = 2,
        mismatchPenalty: number = -1,
        gapPenalty: number = -1
    ): { score: number; pdfStart: number; sourceStart: number; length: number } {
        const m = pdfText.length
        const n = sourceText.length
        const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))

        let maxScore = 0
        let maxI = 0
        let maxJ = 0

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                const match = pdfText[i - 1] === sourceText[j - 1] ? matchScore : mismatchPenalty

                dp[i][j] = Math.max(
                    0,
                    dp[i - 1][j - 1] + match,
                    dp[i - 1][j] + gapPenalty,
                    dp[i][j - 1] + gapPenalty
                )

                if (dp[i][j] > maxScore) {
                    maxScore = dp[i][j]
                    maxI = i
                    maxJ = j
                }
            }
        }

        // Trace back to find alignment length
        let i = maxI
        let j = maxJ
        let length = 0

        while (i > 0 && j > 0 && dp[i][j] > 0) {
            length++
            if (dp[i][j] === dp[i - 1][j - 1] +
                (pdfText[i - 1] === sourceText[j - 1] ? matchScore : mismatchPenalty)) {
                i--
                j--
            } else if (dp[i][j] === dp[i - 1][j] + gapPenalty) {
                i--
            } else {
                j--
            }
        }

        return {
            score: maxScore,
            pdfStart: i,
            sourceStart: j,
            length
        }
    }

    /**
     * Finds match using Smith-Waterman local alignment algorithm.
     */
    private static findWithSmithWaterman(
        normalizedText: string,
        lines: string[],
        startLine: number,
        startColumn: number
    ): { line: number; column: number; text: string; confidence: number } | null {
        let bestMatch: { line: number; column: number; text: string; confidence: number } | null = null
        let bestScore = 0

        // Search in a window around the start position
        const searchWindow = 5 // lines to search
        const startIdx = Math.max(0, startLine)
        const endIdx = Math.min(lines.length, startLine + searchWindow)

        for (let lineIdx = startIdx; lineIdx < endIdx; lineIdx++) {
            const line = lines[lineIdx]
            const startCol = lineIdx === startLine ? startColumn : 0

            // Try sliding window approach for better matching
            const searchText = line.substring(startCol, Math.min(startCol + normalizedText.length * 3, line.length))
            const normalizedSearch = this.normalizeText(searchText)

            if (normalizedSearch.length < normalizedText.length * 0.5) {
                continue
            }

            const alignment = this.smithWaterman(normalizedText, normalizedSearch)
            const maxPossibleScore = normalizedText.length * 2 // perfect match score
            const confidence = Math.min(1.0, alignment.score / maxPossibleScore)

            if (alignment.score > bestScore && confidence > 0.6) {
                bestScore = alignment.score
                const actualColumn = this.findActualColumn(
                    line,
                    startCol,
                    normalizedText,
                    alignment.sourceStart
                )
                bestMatch = {
                    line: lineIdx,
                    column: actualColumn,
                    text: normalizedText,
                    confidence
                }
            }
        }

        return bestMatch
    }

    /**
     * Finds match using Levenshtein distance.
     */
    private static findWithLevenshtein(
        normalizedText: string,
        lines: string[],
        startLine: number,
        startColumn: number
    ): { line: number; column: number; text: string; confidence: number } | null {
        let bestMatch: { line: number; column: number; text: string; confidence: number } | null = null
        let bestConfidence = 0

        const searchWindow = 10
        const startIdx = Math.max(0, startLine)
        const endIdx = Math.min(lines.length, startLine + searchWindow)

        for (let lineIdx = startIdx; lineIdx < endIdx; lineIdx++) {
            const line = lines[lineIdx]
            const startCol = lineIdx === startLine ? startColumn : 0

            // Try different window sizes
            for (let windowSize = normalizedText.length; windowSize <= normalizedText.length * 2; windowSize += 5) {
                const searchText = line.substring(startCol, Math.min(startCol + windowSize, line.length))
                const normalizedSearch = this.normalizeText(searchText)

                if (normalizedSearch.length < normalizedText.length * 0.5) {
                    continue
                }

                const conf = this.similarity(normalizedText, normalizedSearch)
                if (conf > bestConfidence && conf > 0.7) {
                    bestConfidence = conf
                    const index = normalizedSearch.indexOf(normalizedText.substring(0, Math.min(10, normalizedText.length)))
                    const actualColumn = index !== -1
                        ? this.findActualColumn(line, startCol, normalizedText, index)
                        : startCol

                    bestMatch = {
                        line: lineIdx,
                        column: actualColumn,
                        text: normalizedText,
                        confidence: conf
                    }
                }
            }
        }

        return bestMatch
    }

    /**
     * Finds match using Longest Common Subsequence.
     */
    private static findWithLCS(
        normalizedText: string,
        lines: string[],
        startLine: number,
        startColumn: number
    ): { line: number; column: number; text: string; confidence: number } | null {
        let bestMatch: { line: number; column: number; text: string; confidence: number } | null = null
        let bestScore = 0

        const searchWindow = 10
        const startIdx = Math.max(0, startLine)
        const endIdx = Math.min(lines.length, startLine + searchWindow)

        for (let lineIdx = startIdx; lineIdx < endIdx; lineIdx++) {
            const line = lines[lineIdx]
            const startCol = lineIdx === startLine ? startColumn : 0

            // Try sliding window
            for (let windowSize = normalizedText.length; windowSize <= normalizedText.length * 2; windowSize += 5) {
                const searchText = line.substring(startCol, Math.min(startCol + windowSize, line.length))
                const normalizedSearch = this.normalizeText(searchText)

                if (normalizedSearch.length < normalizedText.length * 0.5) {
                    continue
                }

                const lcs = this.longestCommonSubsequence(normalizedText, normalizedSearch)
                const score = lcs.length / Math.max(normalizedText.length, normalizedSearch.length)

                if (score > bestScore && score > 0.7) {
                    bestScore = score
                    const index = normalizedSearch.indexOf(lcs.substring(0, Math.min(10, lcs.length)))
                    const actualColumn = index !== -1
                        ? this.findActualColumn(line, startCol, normalizedText, index)
                        : startCol

                    bestMatch = {
                        line: lineIdx,
                        column: actualColumn,
                        text: normalizedText,
                        confidence: score
                    }
                }
            }
        }

        return bestMatch
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
     * Improved version that handles nested braces and more command patterns.
     */
    private static removeLaTeXCommands(text: string): string {
        let result = text
        let changed = true
        let iterations = 0
        const maxIterations = 10

        // Iteratively remove commands until no more changes
        while (changed && iterations < maxIterations) {
            const before = result
            iterations++

            // Remove comments
            result = result.replace(/%.*$/gm, '')

            // Remove LaTeX commands with optional and required arguments
            // Pattern: \command*[optional]{required}
            result = result.replace(/\\[a-zA-Z@]+\*?(\[[^\]]*\])*(\{[^\}]*\})*/g, '')

            // Remove special LaTeX characters (but keep some that might be visible)
            result = result.replace(/\\([^a-zA-Z@\s])/g, '$1')

            // Remove environment commands \begin{...}...\end{...}
            result = result.replace(/\\begin\{[^\}]*\}[\s\S]*?\\end\{[^\}]*\}/g, '')

            // Remove remaining standalone braces (but be careful with nested)
            // Only remove if they're clearly command arguments
            result = result.replace(/\{[^\}]*\}/g, (match) => {
                // Keep braces that might be visible content if they contain letters
                if (/[a-zA-Z]/.test(match)) {
                    return match.slice(1, -1) // Remove outer braces, keep content
                }
                return ''
            })

            // Normalize whitespace
            result = result.replace(/\s+/g, ' ').trim()

            changed = (before !== result)
        }

        return result
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


import { send } from './connection.js'
import * as utils from './utils.js'
import type { PDFViewerApplicationType } from './interface.js'

declare const PDFViewerApplication: PDFViewerApplicationType

let textEditingEnabled = false
let editDialog: HTMLElement | null = null
let currentEditData: {
    page: number
    pos: [number, number]
    selectedText: string
} | null = null

export function isTextEditingEnabled(): boolean {
    return textEditingEnabled
}

export function toggleTextEditing(): boolean {
    textEditingEnabled = !textEditingEnabled
    updateTextEditingUI()
    return textEditingEnabled
}

function updateTextEditingUI() {
    const button = document.getElementById('textEditingButton')
    if (button) {
        if (textEditingEnabled) {
            button.classList.add('toggled')
            button.setAttribute('aria-pressed', 'true')
            document.body.style.cursor = 'text'
            // Re-register handlers when mode is enabled
            registerTextEditing()
        } else {
            button.classList.remove('toggled')
            button.setAttribute('aria-pressed', 'false')
            document.body.style.cursor = ''
        }
    }
}

function createEditDialog(): HTMLElement {
    if (editDialog) {
        return editDialog
    }

    const dialog = document.createElement('div')
    dialog.id = 'textEditDialog'
    dialog.className = 'textEditDialog'
    dialog.innerHTML = `
        <div class="textEditDialogContent">
            <div class="textEditDialogHeader">
                <span>Edit Text</span>
                <button id="textEditDialogClose" class="textEditDialogClose" type="button" aria-label="Close">×</button>
            </div>
            <div class="textEditDialogBody">
                <label for="textEditInput">Text:</label>
                <textarea id="textEditInput" class="textEditInput" rows="3"></textarea>
                <div class="textEditDialogStatus" id="textEditDialogStatus"></div>
            </div>
            <div class="textEditDialogFooter">
                <button id="textEditDialogCancel" class="textEditDialogButton secondary" type="button">Cancel</button>
                <button id="textEditDialogSave" class="textEditDialogButton primary" type="button">Save</button>
            </div>
        </div>
    `
    document.body.appendChild(dialog)

    // Add event listeners
    const closeBtn = document.getElementById('textEditDialogClose')
    const cancelBtn = document.getElementById('textEditDialogCancel')
    const saveBtn = document.getElementById('textEditDialogSave')
    const input = document.getElementById('textEditInput') as HTMLTextAreaElement

    const closeDialog = () => {
        dialog.style.display = 'none'
        currentEditData = null
    }

    closeBtn?.addEventListener('click', closeDialog)
    cancelBtn?.addEventListener('click', closeDialog)

    saveBtn?.addEventListener('click', () => {
        if (currentEditData && input) {
            const newText = input.value
            const oldText = currentEditData.selectedText
            if (newText !== oldText) {
                void applyTextEdit(oldText, newText)
            }
            closeDialog()
        }
    })

    // Close on Escape key
    dialog.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeDialog()
        }
    })

    editDialog = dialog
    return dialog
}

async function extractTextAtPosition(page: number, pos: [number, number]): Promise<string> {
    try {
        // First, try to get text from selection (most reliable)
        const selection = window.getSelection()
        if (selection && selection.toString().trim()) {
            console.log('Using selected text:', selection.toString().trim())
            return selection.toString().trim()
        }

        // Try to get text from the text layer (more reliable than coordinate matching)
        const pageView = PDFViewerApplication.pdfViewer._pages[page - 1]
        if (pageView) {
            const textLayer = pageView.textLayer
            if (textLayer && textLayer.textDivs) {
                // Find the text div closest to the click position
                const textDivs = textLayer.textDivs
                let closestDiv: HTMLElement | null = null
                let minDistance = Infinity

                for (const div of textDivs) {
                    const rect = div.getBoundingClientRect()
                    const divCenterX = rect.left + rect.width / 2
                    const divCenterY = rect.top + rect.height / 2

                    // Get click position in viewport coordinates
                    const clickX = pos[0]
                    const clickY = pos[1]

                    // Calculate distance (simplified - would need proper coordinate conversion)
                    const distance = Math.sqrt(
                        Math.pow(clickX - divCenterX, 2) + Math.pow(clickY - divCenterY, 2)
                    )

                    if (distance < minDistance && distance < 200) {
                        minDistance = distance
                        closestDiv = div as HTMLElement
                    }
                }

                if (closestDiv && closestDiv.textContent) {
                    const text = closestDiv.textContent.trim()
                    if (text) {
                        console.log('Found text from text layer:', text)
                        return text
                    }
                }
            }
        }

        // Fallback: use PDF.js text content API
        if (!PDFViewerApplication.pdfDocument) {
            console.log('PDF document not available')
            return ''
        }

        const pdfPage = await PDFViewerApplication.pdfDocument.getPage(page)
        const textContent = await pdfPage.getTextContent({
            disableNormalization: true
        })

        if (!pageView) {
            console.log('Page view not available')
            return ''
        }

        // Find text items near the click position
        const viewport = pageView.viewport
        const items = textContent.items
        let closestText = ''
        let minDistance = Infinity

        for (const item of items) {
            if (item.transform && item.str && item.str.trim()) {
                // Transform coordinates from PDF space to viewport space
                const itemX = item.transform[4]
                const itemY = item.transform[5]

                // Convert to viewport coordinates for comparison
                const [viewportX, viewportY] = viewport.convertToViewportPoint(itemX, itemY)

                // Calculate distance (pos is already in viewport coordinates from getPagePoint)
                const distance = Math.sqrt(
                    Math.pow(pos[0] - viewportX, 2) + Math.pow(pos[1] - viewportY, 2)
                )

                // Use a larger threshold (200px) to catch nearby text
                if (distance < minDistance && distance < 200) {
                    minDistance = distance
                    closestText = item.str
                }
            }
        }

        if (closestText) {
            console.log('Found text from PDF content:', closestText)
        } else {
            console.log('No text found near click position')
        }

        return closestText
    } catch (error) {
        console.error('Error extracting text:', error)
        return ''
    }
}

async function requestSourceLocation(page: number, pos: [number, number], selectedText: string) {
    const pdfFileUri = utils.parseURL().pdfFileUri
    const statusEl = document.getElementById('textEditDialogStatus')
    if (statusEl) {
        statusEl.textContent = 'Looking up source location...'
        statusEl.className = 'textEditDialogStatus loading'
    }

    try {
        await send({
            type: 'edit_text_request',
            pdfFileUri,
            page,
            pos,
            selectedText
        })
    } catch (error) {
        console.error('Error requesting source location:', error)
        if (statusEl) {
            statusEl.textContent = 'Error: Failed to request source location'
            statusEl.className = 'textEditDialogStatus error'
        }
    }
}

async function applyTextEdit(oldText: string, newText: string) {
    if (!currentEditData) {
        return
    }

    const statusEl = document.getElementById('textEditDialogStatus')
    if (statusEl) {
        statusEl.textContent = 'Applying changes...'
        statusEl.className = 'textEditDialogStatus loading'
    }

    // Get source location from stored data (set by handleEditTextRequestResult)
    let sourceFile = (currentEditData as any).sourceFile || ''
    let line = (currentEditData as any).line ?? 0
    let column = (currentEditData as any).column ?? 0

    // If no source location was found, we need to find it first
    if (!sourceFile && oldText) {
        const statusEl2 = document.getElementById('textEditDialogStatus')
        if (statusEl2) {
            statusEl2.textContent = 'Finding source location...'
            statusEl2.className = 'textEditDialogStatus loading'
        }

        // Request source location first
        await requestSourceLocation(currentEditData.page, currentEditData.pos, oldText)

        // Wait a bit for the response
        await new Promise(resolve => setTimeout(resolve, 1000))

        // Check again
        sourceFile = (currentEditData as any).sourceFile || ''
        line = (currentEditData as any).line ?? 0
        column = (currentEditData as any).column ?? 0
    }

    if (!sourceFile) {
        if (statusEl) {
            statusEl.textContent = 'Error: Could not find source location. Please ensure SyncTeX is enabled and the PDF was compiled with SyncTeX.'
            statusEl.className = 'textEditDialogStatus error'
        }
        return
    }

    const pdfFileUri = utils.parseURL().pdfFileUri

    try {
        await send({
            type: 'edit_text_apply',
            pdfFileUri,
            sourceFile,
            line,
            column,
            oldText: oldText || newText, // Use newText if oldText is empty (user typed manually)
            newText
        })
    } catch (error) {
        console.error('Error applying text edit:', error)
        if (statusEl) {
            statusEl.textContent = 'Error: Failed to apply changes'
            statusEl.className = 'textEditDialogStatus error'
        }
    }
}

export function handleTextEditClick(e: MouseEvent, page: number, pageDom: HTMLElement, viewerContainer: HTMLElement) {
    if (!textEditingEnabled) {
        return
    }

    console.log('Text editing click detected on page', page)
    e.preventDefault()
    e.stopPropagation()

    const canvasDom = pageDom.getElementsByTagName('canvas')[0]
    if (!canvasDom) {
        return
    }

    const canvas = document.getElementsByClassName('canvasWrapper')[0] as HTMLElement
    const left = e.pageX - pageDom.offsetLeft + viewerContainer.scrollLeft - canvas.offsetLeft
    const top = e.pageY - pageDom.offsetTop + viewerContainer.scrollTop - canvas.offsetTop

    const pos = PDFViewerApplication.pdfViewer._pages[page - 1]?.getPagePoint(left, canvasDom.offsetHeight - top)
    if (!pos) {
        console.log('Could not get page point from click')
        return
    }

    // Get selected text if any
    const selection = window.getSelection()
    const selectedText = selection?.toString().trim() || ''

    // Extract text at position
    void extractTextAtPosition(page, pos).then(async (text) => {
        const textToEdit = text || selectedText || ''

        // Always show the dialog, even if no text is found (user can type manually)
        currentEditData = { page, pos, selectedText: textToEdit }
        showEditDialog(textToEdit, page, pos)

        if (textToEdit) {
            // Request source location from extension
            await requestSourceLocation(page, pos, textToEdit)
        } else {
            console.log('No text found at click position. User can type text manually.')
            const statusEl = document.getElementById('textEditDialogStatus')
            if (statusEl) {
                statusEl.textContent = 'No text found. Please type the text you want to edit, or select text first.'
                statusEl.className = 'textEditDialogStatus error'
            }
        }
    })
}

function showEditDialog(text: string, page: number, pos: [number, number]) {
    const dialog = createEditDialog()
    const input = document.getElementById('textEditInput') as HTMLTextAreaElement
    const statusEl = document.getElementById('textEditDialogStatus')

    if (input) {
        input.value = text
        input.focus()
        input.select()
    }

    if (statusEl) {
        statusEl.textContent = ''
        statusEl.className = 'textEditDialogStatus'
    }

    dialog.style.display = 'flex'
    currentEditData = { page, pos, selectedText: text }
}

export function handleEditTextRequestResult(data: {
    sourceFile: string
    line: number
    column: number
    text: string
    context?: string
}) {
    const statusEl = document.getElementById('textEditDialogStatus')
    if (statusEl) {
        statusEl.textContent = `Found in ${data.sourceFile} at line ${data.line + 1}`
        statusEl.className = 'textEditDialogStatus success'
    }

    // Store source location for when we apply the edit
    if (currentEditData) {
        (currentEditData as any).sourceFile = data.sourceFile
        ;(currentEditData as any).line = data.line
        ;(currentEditData as any).column = data.column
    }
}

export function handleEditTextApplyResult(data: { success: boolean; message?: string }) {
    const statusEl = document.getElementById('textEditDialogStatus')
    if (statusEl) {
        if (data.success) {
            statusEl.textContent = 'Changes applied successfully. Recompiling...'
            statusEl.className = 'textEditDialogStatus success'
        } else {
            statusEl.textContent = `Error: ${data.message || 'Failed to apply changes'}`
            statusEl.className = 'textEditDialogStatus error'
        }
    }
}

// Store handlers to avoid duplicates
const textEditingHandlers = new WeakMap<HTMLElement, (e: MouseEvent) => void>()

export function registerTextEditing() {
    // This will be called from latexworkshop.ts after pages are loaded
    const viewerDom = document.getElementById('viewer')
    if (!viewerDom) {
        return
    }

    // Wait a bit for pages to be fully rendered
    setTimeout(() => {
        const pageDomList = (viewerDom.childNodes[0] as HTMLElement)?.classList?.contains('spread')
            ? [...viewerDom.childNodes].map(node => [...node.childNodes]).flat()
            : viewerDom.childNodes

        for (const pageDom of pageDomList as NodeListOf<HTMLElement> | HTMLElement[]) {
            const pageElement = pageDom as HTMLElement
            const page = Number(pageElement.dataset.pageNumber)
            if (isNaN(page)) {
                continue
            }
            const viewerContainer = document.getElementById('viewerContainer')!

            // Check if handler already exists
            if (textEditingHandlers.has(pageElement)) {
                continue
            }

            // Create and store handler
            const handler = (e: MouseEvent) => {
                if (textEditingEnabled && !(e.ctrlKey || e.metaKey)) {
                    handleTextEditClick(e, page, pageElement, viewerContainer)
                }
            }

            textEditingHandlers.set(pageElement, handler)

            // Add click handler for text editing mode
            // Use capture phase to intercept before SyncTeX handlers
            pageElement.addEventListener('click', handler, true)
        }
    }, 100)
}


import type { PDFViewerApplicationType } from './interface.js'
import { send } from './connection.js'
import * as utils from './utils.js'

declare const PDFViewerApplication: PDFViewerApplicationType

let lastSelection: {
    text: string
    page: number
    pos: [number, number]
    rect: DOMRect
} | null = null

let buttonElement: HTMLElement | null = null
let isButtonClick = false

/**
 * Create the floating "Add to Chat" button
 */
function createButton(): HTMLElement {
    if (buttonElement) {
        return buttonElement
    }

    const button = document.createElement('div')
    button.id = 'add-to-cline-button'
    button.innerHTML = `
        <span style="display: flex; align-items: center; gap: 4px;">
            <span>Add to Chat</span>
            <span style="font-size: 12px; opacity: 0.7;">⌘'</span>
        </span>
    `

    // Style the button to match Cline's style
    button.style.cssText = `
        position: fixed;
        display: none;
        background: var(--vscode-button-background, #0e639c);
        color: var(--vscode-button-foreground, #ffffff);
        border: none;
        border-radius: 3px;
        padding: 4px 12px;
        font-size: 12px;
        font-family: var(--vscode-font-family);
        cursor: pointer;
        z-index: 10000;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        user-select: none;
        pointer-events: auto;
        transition: opacity 0.2s;
    `

    button.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        isButtonClick = true
        void sendToCline()
        hideButton()
        // Reset flag after a short delay
        setTimeout(() => {
            isButtonClick = false
        }, 100)
    })

    button.addEventListener('mouseenter', () => {
        button.style.opacity = '0.9'
    })

    button.addEventListener('mouseleave', () => {
        button.style.opacity = '1'
    })

    document.body.appendChild(button)
    buttonElement = button
    return button
}

/**
 * Show the floating button at the specified position
 */
function showButton(rect: DOMRect) {
    const button = createButton()
    const buttonHeight = 30
    const buttonPadding = 8

    // Position button above the selection, slightly to the right
    const top = Math.max(buttonPadding, rect.top - buttonHeight - 5)
    const left = rect.left + 10

    button.style.top = `${top}px`
    button.style.left = `${left}px`
    button.style.display = 'block'
}

/**
 * Hide the floating button
 */
function hideButton() {
    if (buttonElement) {
        buttonElement.style.display = 'none'
    }
}

/**
 * Get the page number and position for a given selection range
 */
function getSelectionInfo(selection: Selection): { page: number; pos: [number, number]; rect: DOMRect } | null {
    if (selection.rangeCount === 0) {
        return null
    }

    const range = selection.getRangeAt(0)
    const pageElement = range.commonAncestorContainer.parentElement?.closest('.page') as HTMLElement
    if (!pageElement) {
        return null
    }

    const page = Number(pageElement.dataset.pageNumber)
    if (isNaN(page)) {
        return null
    }

    // Get the position of the start of the selection
    const rect = range.getBoundingClientRect()
    const viewerContainer = document.getElementById('viewerContainer')!
    const canvas = document.getElementsByClassName('canvasWrapper')[0] as HTMLElement

    if (!canvas) {
        return null
    }

    const left = rect.left - viewerContainer.offsetLeft + viewerContainer.scrollLeft - canvas.offsetLeft
    const top = rect.top - viewerContainer.offsetTop + viewerContainer.scrollTop - canvas.offsetTop

    const canvasDom = pageElement.getElementsByTagName('canvas')[0]
    if (!canvasDom) {
        return null
    }

    const pos = PDFViewerApplication.pdfViewer._pages[page - 1]?.getPagePoint(left, canvasDom.offsetHeight - top)
    if (!pos) {
        return null
    }

    return { page, pos, rect }
}

/**
 * Handle text selection and store it for later use
 */
function handleSelectionChange() {
    // Don't update if user just clicked the button
    if (isButtonClick) {
        return
    }

    const selection = window.getSelection()
    if (!selection || selection.toString().trim() === '' || selection.isCollapsed) {
        lastSelection = null
        hideButton()
        return
    }

    const selectedText = selection.toString().trim()
    const selectionInfo = getSelectionInfo(selection)

    if (selectionInfo) {
        lastSelection = {
            text: selectedText,
            page: selectionInfo.page,
            pos: selectionInfo.pos,
            rect: selectionInfo.rect
        }
        showButton(selectionInfo.rect)
    } else {
        lastSelection = null
        hideButton()
    }
}

/**
 * Handle mouse up to show button after selection
 */
function handleMouseUp(_e: MouseEvent) {
    // Small delay to let selection update
    setTimeout(() => {
        if (!isButtonClick) {
            handleSelectionChange()
        }
    }, 10)
}

/**
 * Handle clicks to hide button when clicking elsewhere
 */
function handleClick(e: MouseEvent) {
    if (isButtonClick) {
        return
    }

    // Check if click is on the button
    const target = e.target as HTMLElement
    if (buttonElement && buttonElement.contains(target)) {
        return
    }

    // Check if there's still a valid selection
    const selection = window.getSelection()
    if (!selection || selection.toString().trim() === '' || selection.isCollapsed) {
        hideButton()
        lastSelection = null
    }
}

/**
 * Send the selected text to Cline via the extension
 */
async function sendToCline() {
    if (!lastSelection) {
        return
    }

    await send({
        type: 'add_to_cline',
        pdfFileUri: utils.parseURL().pdfFileUri,
        selectedText: lastSelection.text,
        pos: lastSelection.pos,
        page: lastSelection.page
    })
}

/**
 * Handle keyboard shortcut (Ctrl+' or Cmd+')
 * This matches Cline's keyboard shortcut in the editor
 */
function handleKeyDown(e: KeyboardEvent) {
    // Check for Ctrl+' (Windows/Linux) or Cmd+' (Mac)
    // Match the same shortcut as Cline uses: cmd+' or ctrl+'
    const isModifier = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey
    const isQuote = e.key === "'" || e.key === '"' || e.code === 'Quote' || e.code === 'Squote'

    if (isModifier && isQuote && lastSelection && lastSelection.text.trim() !== '') {
        e.preventDefault()
        e.stopPropagation()
        void sendToCline()
    }
}

/**
 * Register the Add to Cline functionality
 *
 * Usage:
 * 1. Select text in the PDF viewer
 * 2. A floating "Add to Chat" button will appear above the selection
 * 3. Click the button or press Ctrl+' (Windows/Linux) or Cmd+' (Mac) to add the selection to Cline chat
 *
 * The selected text will be mapped to the corresponding .tex source lines using SyncTeX
 */
export function registerAddToCline() {
    // Create the button element
    createButton()

    // Listen for text selection changes
    document.addEventListener('selectionchange', handleSelectionChange)

    // Listen for mouse up to show button after selection
    document.addEventListener('mouseup', handleMouseUp)

    // Listen for clicks to hide button when clicking elsewhere
    document.addEventListener('click', handleClick, true)

    // Listen for keyboard shortcuts
    // Use capture phase to ensure we get the event before PDF.js handles it
    document.addEventListener('keydown', handleKeyDown, true)

    // Hide button on scroll
    const viewerContainer = document.getElementById('viewerContainer')
    if (viewerContainer) {
        viewerContainer.addEventListener('scroll', () => {
            if (lastSelection) {
                // Update button position on scroll
                const selection = window.getSelection()
                if (selection && !selection.isCollapsed) {
                    const range = selection.getRangeAt(0)
                    const rect = range.getBoundingClientRect()
                    showButton(rect)
                } else {
                    hideButton()
                }
            }
        })
    }
}


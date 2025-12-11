import * as vscode from 'vscode'
import ws from 'ws'
import * as path from 'path'
import * as os from 'os'
import * as cs from 'cross-spawn'
import { lw } from '../lw'
import type { SyncTeXRecordToPDF, SyncTeXRecordToPDFAll, ViewerMode } from '../types'
import * as manager from './viewer/pdfviewermanager'
import { populate } from './viewer/pdfviewerpanel'

import type { ClientRequest, PdfViewerParams, PdfViewerState } from '../../types/latex-workshop-protocol-types/index'
import { Client } from './viewer/client'
import { TextMapper } from './textmapper'

import { moveActiveEditor } from '../utils/webview'

const logger = lw.log('Viewer')

export {
    getParams,
    getViewerState,
    handler,
    isViewing,
    locate,
    viewInWebviewPanel,
    refresh,
    view
}
export { serializer } from './viewer/pdfviewerpanel'
export { hook } from './viewer/pdfviewerhook'

lw.watcher.pdf.onChange(pdfUri => {
    if (lw.compile.compiledPDFWriting === 0 || path.relative(lw.compile.compiledPDFPath, pdfUri.fsPath) !== '') {
        refresh(pdfUri)
    }
})
lw.onConfigChange(['view.pdf.toolbar.hide.timeout', 'view.pdf.invert', 'view.pdf.invertMode', 'view.pdf.color', 'view.pdf.internal', 'view.pdf.reload.transition'], () => {
    reload()
})

const isViewing = (fileUri: vscode.Uri) => manager.getClients(fileUri) !== undefined

function reload(): void {
    manager.getClients()?.forEach(client => {
        client.send({ type: 'reload' })
    })
}

/**
 * Refreshes PDF viewers of `pdfFile`.
 *
 * @param pdfFile The path of a PDF file. If `pdfFile` is `undefined`,
 * refreshes all the PDF viewers.
 */
function refresh(pdfUri?: vscode.Uri): void {
    logger.log(`Call refreshExistingViewer: ${pdfUri ?? 'undefined'} .`)
    if (pdfUri === undefined) {
        manager.getClients()?.forEach(client => {
            client.send({ type: 'refresh', pdfFileUri: client.pdfFileUri })
        })
        return
    }
    let clientSet = manager.getClients(pdfUri)
    clientSet = lw.extra.liveshare.handle.viewer.refresh(pdfUri.fsPath, clientSet)
    if (!clientSet) {
        logger.log(`Not found PDF viewers to refresh: ${pdfUri}`)
        return
    }
    logger.log(`Refresh PDF viewer: ${pdfUri}`)
    clientSet.forEach(client => {
        client.send({ type: 'refresh', pdfFileUri: client.pdfFileUri })
    })
}

async function getUrl(pdfUri: vscode.Uri): Promise<string | undefined> {
    if (!await lw.file.exists(pdfUri)) {
        logger.log(`Cannot find PDF file ${pdfUri}`)
        logger.refreshStatus('check', 'statusBar.foreground', `Cannot view file PDF file. File not found: ${pdfUri}`, 'warning')
        return
    }
    return (await lw.server.getUrl(pdfUri)).url
}

async function view(pdfUri: vscode.Uri, mode?: 'tab' | 'browser' | 'external'): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('latex-workshop')
    const tabEditorGroup = configuration.get('view.pdf.tab.editorGroup') as string
    let viewerMode: ViewerMode = mode ?? configuration.get<ViewerMode>('view.pdf.viewer', 'tab')
    if (mode === 'tab' && configuration.get<ViewerMode>('view.pdf.viewer', 'tab') === 'legacy') {
        viewerMode = 'legacy'
    }
    if (viewerMode === 'browser') {
        return viewInBrowser(pdfUri)
    } else if (viewerMode === 'tab') {
        return viewInCustomEditor(pdfUri)
    } else if (viewerMode === 'legacy' || viewerMode === 'singleton') {
        return viewInWebviewPanel(pdfUri, tabEditorGroup, true)
    } else if (viewerMode === 'external') {
        return viewInExternal(pdfUri)
    } else {
        return viewInCustomEditor(pdfUri)
    }
}

/**
 * Opens the PDF uri in the browser.
 *
 * @param pdfUri The path of a PDF file.
 */
async function viewInBrowser(pdfUri: vscode.Uri): Promise<void> {
    const url = await getUrl(pdfUri)
    if (!url) {
        return
    }
    manager.create(pdfUri)
    lw.watcher.pdf.add(pdfUri)
    try {
        logger.log(`Serving PDF file at ${url}`)
        await vscode.env.openExternal(vscode.Uri.parse(url, true))
        logger.log(`Open PDF viewer for ${pdfUri.toString(true)}`)
    } catch (e: unknown) {
        void vscode.window.showInputBox({
            prompt: 'Unable to open browser. Please copy and visit this link.',
            value: url
        })
        logger.logError(`Failed opening PDF viewer for ${pdfUri.toString(true)}`, e)
    }
}

async function viewInCustomEditor(pdfUri: vscode.Uri): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('latex-workshop')
    const editorGroup = configuration.get('view.pdf.tab.editorGroup') as string
    const showOptions: vscode.TextDocumentShowOptions = {
        viewColumn: vscode.ViewColumn.Active,
        preserveFocus: true
    }
    if (editorGroup === 'left') {
        const currentColumn = vscode.window.activeTextEditor?.viewColumn
        if (currentColumn && currentColumn > 1) {
            showOptions.viewColumn = currentColumn - 1
            await vscode.commands.executeCommand('vscode.openWith', pdfUri, 'latex-workshop-pdf-hook', showOptions)
            await vscode.commands.executeCommand('workbench.action.focusRightGroup')
        } else {
            await vscode.commands.executeCommand('vscode.openWith', pdfUri, 'latex-workshop-pdf-hook', showOptions)
            await moveActiveEditor('left', true)
        }
    } else if (editorGroup === 'right') {
        const currentColumn = vscode.window.activeTextEditor?.viewColumn
        showOptions.viewColumn = (currentColumn ?? 0) + 1
        await vscode.commands.executeCommand('vscode.openWith', pdfUri, 'latex-workshop-pdf-hook', showOptions)
        await vscode.commands.executeCommand('workbench.action.focusLeftGroup')
    } else {
        await vscode.commands.executeCommand('vscode.openWith', pdfUri, 'latex-workshop-pdf-hook', showOptions)
        await moveActiveEditor(editorGroup, true)
    }
    logger.log(`Open PDF tab for ${pdfUri.toString(true)}`)
}

async function viewInWebviewPanel(pdfUri: vscode.Uri, tabEditorGroup: string, preserveFocus: boolean): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('latex-workshop')
    const singleton = configuration.get<ViewerMode>('view.pdf.viewer', 'tab') === 'singleton'
    if (singleton) {
        const panels = manager.getPanels(pdfUri)
        if (panels && panels.size > 0) {
            panels.forEach(panel => panel.webviewPanel.reveal(undefined, true))
            logger.log(`Reveal the existing PDF tab for ${pdfUri.toString(true)}`)
            return
        }
    }
    const activeDocument = vscode.window.activeTextEditor?.document
    const webviewPanel = vscode.window.createWebviewPanel('latex-workshop-pdf', path.basename(pdfUri.path), {
        viewColumn: vscode.ViewColumn.Active,
        preserveFocus: tabEditorGroup === 'current'
    }, {
        enableScripts: true,
        retainContextWhenHidden: true
    })
    const viewerPanel = await populate(pdfUri, webviewPanel)
    manager.insert(viewerPanel)
    if (!viewerPanel) {
        return
    }
    if (tabEditorGroup !== 'current' && activeDocument) {
        await moveActiveEditor(tabEditorGroup, preserveFocus)
    }
    logger.log(`Open PDF tab for ${pdfUri.toString(true)}`)
}

/**
 * Opens the PDF file of in the external PDF viewer.
 *
 * @param pdfUri The path of a PDF file.
 */
function viewInExternal(pdfUri: vscode.Uri): void {
    const configuration = vscode.workspace.getConfiguration('latex-workshop')
    let command = configuration.get('view.pdf.external.viewer.command') as string
    let args = configuration.get('view.pdf.external.viewer.args') as string[]
    if (!command) {
        switch (process.platform) {
            case 'win32':
                command = 'SumatraPDF.exe'
                args = ['%PDF%']
                break
            case 'linux':
                command = 'xdg-open'
                args = ['%PDF%']
                break
            case 'darwin':
                command = 'open'
                args = ['%PDF%']
                break
            default:
                break
        }
    }
    if (args) {
        args = args.map(arg => arg.replace('%PDF%', pdfUri.fsPath))
    }
    logger.log(`Open external viewer for ${pdfUri.toString(true)}`)
    logger.logCommand('Execute the external PDF viewer command', command, args)
    const proc = cs.spawn(command, args, { cwd: path.dirname(pdfUri.fsPath), detached: true })
    let stdout = ''
    proc.stdout.on('data', newStdout => {
        stdout += newStdout
    })
    let stderr = ''
    proc.stderr.on('data', newStderr => {
        stderr += newStderr
    })
    const cb = () => {
        void logger.log(`The external PDF viewer stdout: ${stdout}`)
        void logger.log(`The external PDF viewer stderr: ${stderr}`)
    }
    proc.on('error', cb)
    proc.on('exit', cb)
}

/**
 * Handles the request from the internal PDF viewer.
 *
 * @param websocket The WebSocket connecting with the viewer.
 * @param msg A message from the viewer in JSON fromat.
 */
function handler(websocket: ws, msg: string): void {
    const data = JSON.parse(msg) as ClientRequest
    if (data.type !== 'ping') {
        logger.log(`Handle data type: ${data.type}`)
    }
    switch (data.type) {
        case 'open': {
            const pdfUri = vscode.Uri.parse(data.pdfFileUri, true)
            if (pdfUri.scheme === 'vsls' && lw.extra.liveshare.isHost()) {
                manager.create(pdfUri)
            }
            const clientSet = manager.getClients(pdfUri)
            if (clientSet === undefined) {
                break
            }
            const client = new Client(websocket, pdfUri.toString(true))
            lw.extra.liveshare.register(client)
            clientSet.add(client)
            client.onDidDispose(() => {
                clientSet.delete(client)
            })
            break
        }
        case 'loaded': {
            lw.event.fire(lw.event.ViewerPageLoaded)
            const configuration = vscode.workspace.getConfiguration('latex-workshop')
            if (configuration.get('synctex.afterBuild.enabled') as boolean) {
                logger.log('SyncTex after build invoked.')
                const uri = vscode.Uri.parse(data.pdfFileUri, true)
                lw.locate.synctex.toPDF(uri)
            }
            break
        }
        case 'reverse_synctex': {
            const uri = vscode.Uri.parse(data.pdfFileUri, true)
            if (lw.extra.liveshare.handle.viewer.reverseSyncTeX(websocket, uri, data)) {
                break
            }
            void lw.locate.synctex.toTeX(data, uri)
            break
        }
        case 'external_link': {
            const uri = vscode.Uri.parse(data.url)
            if (['http', 'https'].includes(uri.scheme)) {
                void vscode.env.openExternal(uri)
            } else {
                void vscode.window.showInputBox({
                    prompt: 'For security reasons, please copy and visit this link manually.',
                    value: data.url
                })
            }
            break
        }
        case 'ping': {
            // nothing to do
            break
        }
        case 'add_log': {
            logger.log(`${data.message}`)
            break
        }
        case 'copy': {
            if ((data.isMetaKey && os.platform() === 'darwin') ||
                (!data.isMetaKey && os.platform() !== 'darwin')) {
                void vscode.env.clipboard.writeText(data.content as string)
            }
            break
        }
        case 'edit_text_request': {
            void handleEditTextRequest(websocket, data)
            break
        }
        case 'edit_text_apply': {
            void handleEditTextApply(websocket, data)
            break
        }
        case 'add_to_cline': {
            void handleAddToCline(data)
            break
        }
        default: {
            if (lw.extra.liveshare.handle.viewer.syncTeX(websocket, data)) {
                break
            }
            logger.log(`Unknown websocket message: ${msg}`)
            break
        }
    }
}

async function handleEditTextRequest(websocket: ws, data: Extract<ClientRequest, { type: 'edit_text_request' }>) {
    try {
        const pdfUri = vscode.Uri.parse(data.pdfFileUri, true)

        // Find the client for this websocket
        const clientSet = manager.getClients(pdfUri)
        const client = clientSet ? Array.from(clientSet).find(c => c.websocket === websocket) : undefined
        if (!client) {
            logger.log('Client not found for edit_text_request')
            return
        }

        // Use reverse SyncTeX to find source location
        const synctexData: Extract<ClientRequest, { type: 'reverse_synctex' }> = {
            type: 'reverse_synctex',
            pdfFileUri: data.pdfFileUri,
            pos: data.pos,
            page: data.page,
            textBeforeSelection: data.selectedText || '',
            textAfterSelection: ''
        }

        const record = await lw.locate.synctex.components.computeToTeX(synctexData, pdfUri)
        if (!record) {
            client.send({
                type: 'edit_text_request_result',
                sourceFile: '',
                line: 0,
                column: 0,
                text: data.selectedText || '',
                context: undefined
            })
            return
        }

        // Read source file
        const sourceUri = vscode.Uri.file(record.input)
        let document: vscode.TextDocument
        try {
            document = await vscode.workspace.openTextDocument(sourceUri)
        } catch (error) {
            logger.logError('Failed to open source file for text editing', error)
            client.send({
                type: 'edit_text_request_result',
                sourceFile: record.input,
                line: record.line,
                column: record.column,
                text: data.selectedText || '',
                context: undefined
            })
            return
        }

        // Extract text at the location
        const lineText = document.lineAt(record.line).text
        const textAtLocation = data.selectedText || lineText.substring(record.column).trim()

        // Get context
        const context = TextMapper.getTextContext(document, record.line, record.column)

        // Send result back to viewer
        client.send({
            type: 'edit_text_request_result',
            sourceFile: record.input,
            line: record.line,
            column: record.column,
            text: textAtLocation,
            context
        })
    } catch (error) {
        logger.logError('Error handling edit_text_request', error)
    }
}

async function handleEditTextApply(websocket: ws, data: Extract<ClientRequest, { type: 'edit_text_apply' }>) {
    try {
        const pdfUri = vscode.Uri.parse(data.pdfFileUri, true)

        // Find the client for this websocket
        const clientSet = manager.getClients(pdfUri)
        const client = clientSet ? Array.from(clientSet).find(c => c.websocket === websocket) : undefined
        if (!client) {
            logger.log('Client not found for edit_text_apply')
            return
        }

        // If source file not provided, try to get it from SyncTeX
        let sourceFile = data.sourceFile
        let line = data.line
        let column = data.column

        if (!sourceFile || line === 0) {
            // Try to get from SyncTeX - we'd need the position, but for now use the provided data
            client.send({
                type: 'edit_text_apply_result',
                success: false,
                message: 'Source location not provided'
            })
            return
        }

        // Open and modify the source file
        const sourceUri = vscode.Uri.file(sourceFile)
        const document = await vscode.workspace.openTextDocument(sourceUri)

        // Find the text to replace using TextMapper
        const sourceText = document.getText()
        const match = TextMapper.findTextInSource(data.oldText, sourceText, line, column)

        if (!match) {
            // Fallback: try to replace at the given position
            const lineText = document.lineAt(line).text
            const range = new vscode.Range(
                line,
                column,
                line,
                Math.min(column + data.oldText.length, lineText.length)
            )

            const edit = new vscode.WorkspaceEdit()
            edit.replace(document.uri, range, data.newText)
            await vscode.workspace.applyEdit(edit)
            await document.save()
        } else {
            // Use the matched position (with improved confidence-based selection)
            // If confidence is low, log a warning but still attempt the edit
            if (match.confidence < 0.7) {
                logger.log(`Low confidence match (${match.confidence.toFixed(2)}) for text replacement`)
            }

            const range = new vscode.Range(
                match.line,
                match.column,
                match.line,
                match.column + data.oldText.length
            )

            const edit = new vscode.WorkspaceEdit()
            edit.replace(document.uri, range, data.newText)
            await vscode.workspace.applyEdit(edit)
            await document.save()
        }

        // Wait a moment for the save event to propagate
        await new Promise(resolve => setTimeout(resolve, 200))

        // Trigger recompilation after save
        // We need to briefly show the document for build() to work (it checks activeTextEditor)
        // But we'll close it right after to keep the PDF in focus
        await vscode.window.showTextDocument(document, { preview: true, preserveFocus: false })

        // Wait a bit for the document to become active
        await new Promise(resolve => setTimeout(resolve, 100))

        // Refresh root file cache
        await lw.root.find()
        const rootFile = lw.root.file.path

        if (rootFile && lw.root.file.langId) {
            logger.log(`Auto-compiling after PDF text edit save: ${rootFile}`)
            try {
                // Use build with skipSelection=true to avoid prompts
                // Don't await - let it run in background so we can close the tex tab
                void lw.compile.build(true, rootFile, lw.root.file.langId)
            } catch (error) {
                logger.logError('Error during auto-compile after PDF text edit', error)
                try {
                    void vscode.commands.executeCommand('latex-workshop.build')
                } catch (cmdError) {
                    logger.logError('Error executing build command', cmdError)
                }
            }
        } else {
            logger.log(`Root file not found (rootFile: ${rootFile}, langId: ${lw.root.file.langId}), trying build command`)
            try {
                void vscode.commands.executeCommand('latex-workshop.build')
            } catch (cmdError) {
                logger.logError('Error executing build command', cmdError)
            }
        }

        // Close the tex document tab to keep PDF in focus
        // Small delay to ensure build has started
        await new Promise(resolve => setTimeout(resolve, 50))
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor')

        // Send success response
        client.send({
            type: 'edit_text_apply_result',
            success: true,
            message: 'Text edited and recompilation triggered'
        })
    } catch (error) {
        logger.logError('Error handling edit_text_apply', error)
        const pdfUri = vscode.Uri.parse(data.pdfFileUri, true)
        const clientSet = manager.getClients(pdfUri)
        const client = clientSet ? Array.from(clientSet).find(c => c.websocket === websocket) : undefined
        if (client) {
            client.send({
                type: 'edit_text_apply_result',
                success: false,
                message: error instanceof Error ? error.message : 'Unknown error'
            })
        }
    }
}

async function handleAddToCline(data: Extract<ClientRequest, { type: 'add_to_cline' }>) {
    try {
        const pdfUri = vscode.Uri.parse(data.pdfFileUri, true)

        // Use reverse SyncTeX to find source location
        const synctexData: Extract<ClientRequest, { type: 'reverse_synctex' }> = {
            type: 'reverse_synctex',
            pdfFileUri: data.pdfFileUri,
            pos: data.pos,
            page: data.page,
            textBeforeSelection: '',
            textAfterSelection: ''
        }

        const record = await lw.locate.synctex.components.computeToTeX(synctexData, pdfUri)
        if (!record) {
            // Fallback: just send text without source location
            logger.log('SyncTeX failed, sending text to Cline without source location')
            try {
                await vscode.commands.executeCommand('cline.addToChatDirect', {
                    selectedText: data.selectedText,
                    language: 'latex'
                })
            } catch (error) {
                logger.logError('Failed to call Cline addToChatDirect command', error)
                // Cline might not be installed, that's okay
            }
            return
        }

        // Read source file to get the actual text range
        const sourceUri = vscode.Uri.file(record.input)
        let document: vscode.TextDocument
        try {
            document = await vscode.workspace.openTextDocument(sourceUri)
        } catch (error) {
            logger.logError('Failed to open source file for Add to Cline', error)
            // Fallback: send without range
            try {
                await vscode.commands.executeCommand('cline.addToChatDirect', {
                    selectedText: data.selectedText,
                    filePath: record.input,
                    language: 'latex'
                })
            } catch (cmdError) {
                logger.logError('Failed to call Cline addToChatDirect command', cmdError)
            }
            return
        }

        // Convert line number from 1-indexed (SyncTeX) to 0-indexed (VS Code)
        const startLine = Math.max(0, record.line - 1)

        // Try to find the selected text in the source to get exact range
        // Start from the line indicated by SyncTeX
        let startChar = Math.max(0, record.column > 0 ? record.column - 1 : 0)
        let endLine = startLine
        let endChar = startChar

        // Try to find the selected text in the source
        const normalizedSelectedText = data.selectedText.trim().replace(/\s+/g, ' ')
        const lineText = document.lineAt(startLine).text

        // Search for the text starting from the column position
        const searchStart = Math.min(startChar, lineText.length)
        let foundIndex = lineText.substring(searchStart).toLowerCase().indexOf(normalizedSelectedText.toLowerCase().substring(0, Math.min(50, normalizedSelectedText.length)))

        if (foundIndex >= 0) {
            startChar = searchStart + foundIndex
            endChar = Math.min(lineText.length, startChar + normalizedSelectedText.length)
        } else {
            // If not found, use the column from SyncTeX or start of line
            startChar = Math.max(0, record.column > 0 ? record.column - 1 : 0)
            endChar = Math.min(lineText.length, startChar + normalizedSelectedText.length)
        }

        // Call Cline's addToChatDirect command
        try {
            await vscode.commands.executeCommand('cline.addToChatDirect', {
                selectedText: data.selectedText,
                filePath: record.input,
                language: 'latex',
                range: {
                    startLine: startLine,
                    startChar: startChar,
                    endLine: endLine,
                    endChar: endChar
                }
            })
            logger.log(`Added PDF selection to Cline: ${data.selectedText.substring(0, 50)}... from ${record.input}:${record.line}`)
        } catch (error) {
            logger.logError('Failed to call Cline addToChatDirect command', error)
            // Cline might not be installed, that's okay - just log it
        }
    } catch (error) {
        logger.logError('Error handling add_to_cline', error)
    }
}

function getParams(): PdfViewerParams {
    const configuration = vscode.workspace.getConfiguration('latex-workshop')
    const invertType = configuration.get('view.pdf.invertMode.enabled') as string
    const invertEnabled =
        (invertType === 'auto' && vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark) ||
        invertType === 'always' ||
        (invertType === 'compat' && (configuration.get('view.pdf.invert') as number) > 0)
    const pack: PdfViewerParams = {
        toolbar: configuration.get('view.pdf.toolbar.hide.timeout') as number,
        sidebar: {
            open: configuration.get('view.pdf.sidebar.open') as 'off' | 'on' | 'persist',
            view: configuration.get('view.pdf.sidebar.view') as 'thumbnails' | 'outline' | 'attachments' | 'layers' | 'persist',
        },
        scale: configuration.get('view.pdf.zoom') as string,
        trim: configuration.get('view.pdf.trim') as number,
        scrollMode: configuration.get('view.pdf.scrollMode') as number,
        spreadMode: configuration.get('view.pdf.spreadMode') as number,
        hand: configuration.get('view.pdf.hand') as boolean,
        invertMode: {
            enabled: invertEnabled,
            brightness: configuration.get('view.pdf.invertMode.brightness') as number,
            grayscale: configuration.get('view.pdf.invertMode.grayscale') as number,
            hueRotate: configuration.get('view.pdf.invertMode.hueRotate') as number,
            invert: configuration.get('view.pdf.invert') as number,
            sepia: configuration.get('view.pdf.invertMode.sepia') as number,
        },
        color: {
            light: {
                pageColorsForeground: configuration.get('view.pdf.color.light.pageColorsForeground') || '',
                pageColorsBackground: configuration.get('view.pdf.color.light.pageColorsBackground') || '',
                backgroundColor: configuration.get('view.pdf.color.light.backgroundColor', '#ffffff'),
                pageBorderColor: configuration.get('view.pdf.color.light.pageBorderColor', 'lightgrey'),
            },
            dark: {
                pageColorsForeground: configuration.get('view.pdf.color.dark.pageColorsForeground') || '',
                pageColorsBackground: configuration.get('view.pdf.color.dark.pageColorsBackground') || '',
                backgroundColor: configuration.get('view.pdf.color.dark.backgroundColor', '#ffffff'),
                pageBorderColor: configuration.get('view.pdf.color.dark.pageBorderColor', 'lightgrey'),
            },
        },
        codeColorTheme: vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ? 'light' : 'dark',
        keybindings: {
            synctex: configuration.get('view.pdf.internal.synctex.keybinding') as 'ctrl-click' | 'double-click',
        },
        reloadTransition: configuration.get('view.pdf.reload.transition') as 'none' | 'fade',
    }
    return pack
}

/**
 * Reveals the position of `record` on the internal PDF viewers.
 *
 * @param pdfUri The path of a PDF file.
 * @param record The position to be revealed.
 */
async function locate(pdfUri: vscode.Uri, record: SyncTeXRecordToPDF | SyncTeXRecordToPDFAll[]): Promise<void> {
    let clientSet = manager.getClients(pdfUri)
    if (clientSet === undefined || clientSet.size === 0) {
        logger.log(`PDF is not opened: ${pdfUri.toString(true)} , try opening.`)
        await view(pdfUri)
        clientSet = manager.getClients(pdfUri)
    }
    if (clientSet === undefined || clientSet.size === 0) {
        logger.log(`PDF cannot be opened: ${pdfUri.toString(true)} .`)
        return
    }
    const needDelay = showInvisibleWebviewPanel(pdfUri)
    for (const client of clientSet) {
        setTimeout(() => {
            client.send({ type: 'synctex', data: record })
        }, needDelay ? 200 : 0)
        logger.log(`Try to synctex ${pdfUri.toString(true)}`)
    }
}

/**
 * Reveals the internal PDF viewer of `pdfUri`.
 * The first one is revealed.
 *
 * @param pdfUri The path of a PDF file.
 * @returns Returns `true` if `WebviewPanel.reveal` called.
 */
function showInvisibleWebviewPanel(pdfUri: vscode.Uri): boolean {
    const panelSet = manager.getPanels(pdfUri)
    if (!panelSet) {
        return false
    }
    const activeViewColumn = vscode.window.activeTextEditor?.viewColumn
    for (const panel of panelSet) {
        const isSyntexOn = !panel.state || panel.state.synctexEnabled
        if (panel.webviewPanel.viewColumn !== activeViewColumn
            && !panel.webviewPanel.visible
            && isSyntexOn) {
            panel.webviewPanel.reveal(panel.webviewPanel.viewColumn, true)
            return true
        }
        if (panel.webviewPanel.visible && isSyntexOn) {
            return false
        }
        if (panel.webviewPanel.viewColumn !== activeViewColumn) {
            return false
        }
    }
    return false
}

/**
 * !! Test only
 * Returns the state of the internal PDF viewer of `pdfFilePath`.
 *
 * @param pdfUri The path of a PDF file.
 */
function getViewerState(pdfUri: vscode.Uri): (PdfViewerState | undefined)[] {
    const panelSet = manager.getPanels(pdfUri)
    if (!panelSet) {
        return []
    }
    return Array.from(panelSet).map(e => e.state)
}

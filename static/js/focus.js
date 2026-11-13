/* =========================================================================
   FOCUS MODE IMPLEMENTATION
   ========================================================================= */

let isFocusModeActive = false;
let isFocusModeStreaming = false; // Tracks if we're currently streaming a response
let focusModeStreamingNodeId = null; // The nodeId currently being streamed
let focusAutoscroll = true; // When true, follow new content in focus-nodes-layer

let lastOpenedTab = ''
function showSidebar(target) {
    // Switching to a sidebar tab closes the settings panel if it was open —
    // the FlowChat panel and the sidebar tabs share the same column and
    // must not stack.
    if (typeof inSettings !== 'undefined' && inSettings) showSettings();
    if (lastOpenedTab == target) {
        $(target).style.display = 'none'
        lastOpenedTab = ''
        return
    }
    $(target).style.display = 'flex'
    if(lastOpenedTab) $(lastOpenedTab).style.display = 'none'
    lastOpenedTab = target
    return
}

// FlowChat tab in the focus tab strip: opens the shared settings panel. Any
// open sidebar panel is closed first so the settings view replaces it; the
// panel is toggled closed by clicking the tab again, or by switching to
// Chat History / Sandbox (handled in showSidebar).
function toggleFocusSettings() {
    if (lastOpenedTab) showSidebar(lastOpenedTab);
    showSettings();
}

// Resizable focus sidebar panels: drag the right edge of Chat History /
// Sandbox to change the width — both panels share one synced width, which
// persists in localStorage.
(function initFocusSidebarResize() {
    const STORAGE_KEY = 'focusSidebarPanelWidth';
    const MIN_W = 266;
    const MAX_W = 570;
    let panels = [];

    let active = null; // { startX, startW } while a drag is in progress
    let currentW = null; // last width actually applied to the panels

    function savedWidth() {
        try {
            const w = parseInt(localStorage.getItem(STORAGE_KEY), 10);
            if (!isNaN(w)) return Math.min(MAX_W, Math.max(MIN_W, w));
        } catch (_) {}
        return null;
    }

    function applyWidth(w) {
        currentW = w;
        panels.forEach(el => { el.style.width = `${w}px`; });
    }

    function persist(w) {
        try { localStorage.setItem(STORAGE_KEY, String(w)); } catch (_) {}
    }

    ['focus-chat-selection', 'focus-project-files'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        panels.push(el);

        const handle = document.createElement('div');
        handle.className = 'focus-sidebar-resize-handle';
        el.appendChild(handle);

        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            // Start from the live width so both panels begin the drag in sync —
            // never from the persisted value, which may lag behind the last drag
            const w = currentW ?? savedWidth() ?? 275;
            applyWidth(w);
            active = { startX: e.clientX, startW: w };
            document.body.classList.add('focus-sidebar-resizing');
        });
    });

    // Restore a previously dragged width (works even while display:none)
    const saved = savedWidth();
    if (saved !== null) applyWidth(saved);

    window.addEventListener('mousemove', (e) => {
        if (!active) return;
        const maxW = Math.min(MAX_W, Math.max(MIN_W, window.innerWidth - 260));
        const newW = Math.round(Math.min(maxW, Math.max(MIN_W, active.startW + (e.clientX - active.startX))));
        applyWidth(newW);
    });

    window.addEventListener('mouseup', () => {
        if (!active) return;
        active = null;
        document.body.classList.remove('focus-sidebar-resizing');
        // Persist the width that was actually applied, not a re-read of storage
        if (currentW !== null) persist(currentW);
    });
})();

function moveContentEditableCaretToEnd(element) {
    element.focus();

    // Create a new range selection
    const range = document.createRange();
    range.selectNodeContents(element);

    // Collapse the range to the end (false = end, true = start)
    range.collapse(false);

    // Apply the range to the window's selection object
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
}

let last_active_chat = ''

function addToChatHistory(targetNode, parentElement = 'chat-selection', isFocus = true) {
    let textDisplay = ''
    let isThinking = false
    if (targetNode.parentId) {
        const parent = nodes.find(n => n.id === targetNode.parentId);
        if (parent) {
            textDisplay = parent.htmlText
            if (parent.type=='document' || parent.type =='image') {
                textDisplay = `${parent.type=='document'?'Document':'Image'} attached: `
                parent.files.forEach(file => {
                    textDisplay += `${file.name}, `
                });
                textDisplay = textDisplay.slice(0, textDisplay.length-2)
            }
            else if (parent.type=='scrape') {
                textDisplay = `Scraped: ${parent.htmlText}`
            }
            // Check if parent is currently thinking (has reasoning or a running
            // tool call, but no final answer yet) — mirrors ChatNode, where a
            // running tool chip counts as live stream content.
            const parentHasRunningTool = Array.isArray(parent.aiSegments) &&
                parent.aiSegments.some(s => s.type === 'tool_call' && s.status === 'running');
            if ((!parent.aiText || parent.aiText.trim() === '') &&
                ((parent.aiThinking && parent.aiThinking.trim() !== '') || parentHasRunningTool)) {
                isThinking = true
            }
        }
    } else {
        textDisplay = targetNode.id
    }

    const chatEntry = document.createElement('div')

    if (activeNodeId == targetNode.id) {
        last_active_chat = chatEntry
    }

    chatEntry.classList.add('chat-entry')

    // Show thinking indicator if node is streaming reasoning
    let displayText = textDisplay
    if (isThinking) {
        displayText = `<span style="opacity:0.7;font-style:italic;">${textDisplay} <img src="/static/icons/hourglass.svg" class="file-icon" style="width:12px;height:12px;vertical-align:middle;margin-left:4px;"> Thinking…</span>`
    }
    chatEntry.innerHTML = `<div class='chat-entry-text' style='overflow:hidden;'>${displayText}</div>`

    if (targetNode.id == activeNodeId) chatEntry.querySelector('.chat-entry-text').style.backgroundColor = '#1e1e1e'

    chatEntry.addEventListener('click', () => {
        if (last_active_chat) {
            last_active_chat.querySelector('.chat-entry-text').style.backgroundColor = 'transparent'
        }
        chatEntry.querySelector('.chat-entry-text').style.backgroundColor = '#1e1e1e'
        last_active_chat = chatEntry
        $(targetNode.id).click();
        if (isFocus) toggleFocusMode(true);
        centerCanvas();
    })
    $(parentElement).appendChild(chatEntry)
}

function updateChatHistory(elementId = 'chat-selection', isFocus = true) {
    $(elementId).innerHTML = ''
    if (isFocus) {
        const newChatBtn = document.createElement('div')
        newChatBtn.classList.add('chat-entry')
        newChatBtn.style.marginTop = '10px'
        newChatBtn.innerHTML = `<div class='chat-entry-text' style='display:flex; overflow:hidden; justify-content:center; width: 95%;'>+ New Chat</div>`
        $(elementId).appendChild(newChatBtn)
        newChatBtn.addEventListener('click', () => {
            // Spawn beside existing content instead of createNode()'s (0,0)
            // default — repeated clicks used to stack nodes exactly on top of
            // each other. Layout runs before entering focus so the new node is
            // placed even if focus entry is interrupted.
            const spawn = nextRootSpawnPosition()
            selectNode(createNode(null, spawn.x, spawn.y))
            updateChatHistory()
            autoLayout()
            centerCanvas()
            toggleFocusMode(true)
        })
    }
    nodes.forEach(node => {
        // P2 Fix: Include nodes that are thinking (have aiThinking but no aiText
        // yet) — show them with a "Thinking..." indicator instead of hiding them.
        // Unexecuted empty leaves stay listed too (that's the node being typed into).
        if (node.type == 'chat' && node.childNodeIds.length == 0 && ((node.aiText.trim() == '' && node.aiThinking.trim() =='') || node.isStreaming == true)) {
            if (typeof addToChatHistory == "function") {addToChatHistory(node, elementId, isFocus)}
        }
    });

}

/**
 * Toggles the linear chat Focus Mode on or off for the current active branch lineage.
 */
function toggleFocusMode(stayFocused = false, targetId = activeNodeId) {
    const focusBg = document.getElementById('focus-bg');
    if (!focusBg) return;

    let activeData = nodes.find(n => n.id === targetId);

    // If already in focus mode and not stayFocused, exit
    if (isFocusModeActive || (focusBg.style.display !== 'none' && focusBg.style.display !== '')) {
        if (!stayFocused) {
            exitFocusMode();
            return;
        }
    }

    function checkIfEmpty(node) {
        return (node.aiText.trim() == '' && node.type == 'chat' && node.aiThinking.trim() == '')
    }

    // A stream started on the canvas can be adopted into focus mode at any
    // time — the same free enter/exit a stream started inside focus mode gets.
    // Marking this before the entry restrictions so the streaming node isn't
    // treated as a completed turn that needs an empty child or add button.
    if (activeData && activeData.isStreaming) {
        isFocusModeStreaming = true;
        focusModeStreamingNodeId = activeData.id;
    } else if (isFocusModeStreaming &&
               (!focusModeStreamingNodeId || focusModeStreamingNodeId !== targetId ||
                !nodes.find(n => n.id === focusModeStreamingNodeId)?.isStreaming)) {
        // Entering focus on a different node, or on the tracked node after its
        // stream already ended: drop the tracking so the running stream's turn
        // doesn't leak into this branch's view and the input stays usable.
        // The stream itself keeps running on the canvas.
        isFocusModeStreaming = false;
        focusModeStreamingNodeId = null;
    }

    // If not in focus mode but streaming, allow re-entry to restore streaming view
    // Otherwise, apply normal entry restrictions
    if (!isFocusModeActive && !isFocusModeStreaming) {
        if (activeData && checkIfEmpty(activeData) == false) {
            let foundEmptyChat = false
            if (!foundEmptyChat) {
                const childIds = activeData.childNodeIds
                for (const id of childIds) {
                    const child = nodes.find(node => node.id === id)
                    if (checkIfEmpty(child) == true) {
                        document.getElementById(child.id).click()
                        targetId = child.id
                        foundEmptyChat = true
                        break
                    }
                }
            }
            const nodeEl = document.getElementById(activeData.id)
            if (!foundEmptyChat && nodeEl && !nodeEl.isVirtual) {
                const addBtn = nodeEl.querySelector('.add-child-btn')
                if (!addBtn.classList.contains('hidden')) {
                    addBtn.click()
                    autoLayout(true)
                    targetId = activeNodeId
                    foundEmptyChat = true
                }
            }
            if (!foundEmptyChat) {
                if (!nodeEl) {
                    showToast('Please select a node first.', 'error', 3000);
                    return
                }
                showToast('Current selected node cannot create child.', 'error', 3000);
                return
            }
        }
    }

    if (!targetId) {
        if (nodes.length > 0) {
            targetId = nodes[nodes.length - 1].id;
        } else {
            const spawn = nextRootSpawnPosition();
            targetId = createNode(null, spawn.x, spawn.y);
        }
        selectNode(targetId);
    }

    const nodeData = nodes.find(n=>n.id==targetId)
    nodeData.userText = document.getElementById(targetId).querySelector('.node-input').innerText
    nodeData.htmlText = document.getElementById(targetId).querySelector('.node-input').innerHTML

    // Adopted canvas stream: sendFocusMessage normally creates the focus turn
    // element; build the equivalent here so the in-progress response shows in
    // the focus layer instead of an empty conversation. Created before
    // renderFocusLineage so its preserve-and-reappend path keeps it.
    if (isFocusModeStreaming && focusModeStreamingNodeId === targetId) {
        const nodesLayer = document.getElementById('focus-nodes-layer');
        if (nodesLayer && !document.getElementById(`focus-turn-${targetId}`)) {
            const turnDiv = document.createElement('div');
            turnDiv.className = 'focus-node chat-node streaming';
            turnDiv.id = `focus-turn-${targetId}`;
            turnDiv.innerHTML = `
                <div class="focus-user">${nodeData.htmlText}</div>
                <div class="focus-ai ai-content"></div>
                <button class="add-child-btn" title="Branch">+</button>
            `;
            nodesLayer.appendChild(turnDiv);
            const aiEl = turnDiv.querySelector('.focus-ai');
            if (Array.isArray(nodeData.aiSegments) && nodeData.aiSegments.length > 0 && typeof renderAiStream === 'function') {
                renderAiStream(aiEl, nodeData);
                syncFocusThinkVisibility(turnDiv);
                if (window.Prism) Prism.highlightAllUnder(aiEl);
            }
        }
    }

    // Auto-scroll guard for focus-nodes-layer: mirrors ChatNode behavior.
    // Scrolling up to read history disables auto-follow; scrolling near bottom re-enables.
    const nodesLayerForScroll = document.getElementById('focus-nodes-layer');
    if (nodesLayerForScroll && !nodesLayerForScroll._autoscrollListener) {
        nodesLayerForScroll._autoscrollListener = true;
        nodesLayerForScroll.addEventListener('scroll', () => {
            const nearBottom = nodesLayerForScroll.scrollTop + nodesLayerForScroll.clientHeight >= nodesLayerForScroll.scrollHeight - 50;
            focusAutoscroll = nearBottom;
        });
    }

    updateChatHistory()


    isFocusModeActive = true;
    focusBg.style.display = 'flex';
    document.body.classList.add('focus-mode-active');
    // Don't carry an open canvas settings panel into focus mode — it would be
    // hidden under the focus layer but stay toggled on, making the first
    // FlowChat click in the strip close it instead of opening it.
    if (typeof inSettings !== 'undefined' && inSettings) showSettings();

    // Update header info
    const badgeEl = document.getElementById('focus-node-count-badge');

    if (badgeEl) {
        badgeEl.textContent = `${current_active_lineage.length} turns in branch`;
    }

    // Render project files & lineage
    renderFocusProjectFiles();
    renderFocusLineage();

    // Setup input listeners
    setupFocusInputListeners();

    // Populate focus model selection dropdown
    populateFocusModelSelection();

    // Focus input
    const chatInput = document.getElementById('focus-chat-input');
    if (chatInput) {
        // Don't overwrite input if we're streaming (preserve in-progress content)
        const inputContent = document.getElementById(targetId).querySelector('.node-input')
        if (!isFocusModeStreaming) {
            chatInput.innerHTML = inputContent.innerHTML;
        }
        chatInput.focus();
        moveContentEditableCaretToEnd(chatInput);
        lastFocusedInput = chatInput;

        // P1 Fix: Real-time sync focus input → canvas input
        // Remove any existing sync listener first
        if (chatInput._syncListener) {
            chatInput.removeEventListener('input', chatInput._syncListener);
        }
        chatInput._syncListener = () => {
            // Resolve the canvas node dynamically: targetId at entry goes stale
            // once a turn completes and the next turn begins, which would sync
            // the new prompt into the previous turn's node (prompt override bug).
            const canvasInput = document.getElementById(activeNodeId)?.querySelector('.node-input');
            if (canvasInput && !isFocusModeStreaming) {
                canvasInput.innerHTML = chatInput.innerHTML;
                // Update nodeData for saveState
                const nodeData = nodes.find(n => n.id === activeNodeId);
                if (nodeData) nodeData.htmlText = chatInput.innerHTML;
            }
        };
        chatInput.addEventListener('input', chatInput._syncListener);
    }

    // Ensure button state is correct on entry
    if (isFocusModeStreaming && focusModeStreamingNodeId) {
        updateFocusModeButtonState('streaming', focusModeStreamingNodeId);
    } else {
        updateFocusModeButtonState();
    }
}

/**
 * Exits Focus Mode and synchronizes the canvas camera and state.
 * Does NOT abort streaming - generation continues on the canvas node.
 * @param {boolean} abortStreaming - If true, abort the generation (e.g., user clicked Stop). Default false.
 */
function exitFocusMode(abortStreaming = false) {
    const focusBg = document.getElementById('focus-bg');
    if (focusBg) focusBg.style.display = 'none';
    isFocusModeActive = false;
    document.body.classList.remove('focus-mode-active');
    // Close the settings panel if it was opened from the focus tab strip —
    // leaving it open would float it over the canvas with stale state.
    if (typeof inSettings !== 'undefined' && inSettings) showSettings();
    const sandboxMenu = document.getElementById('sandbox-context-menu');
    if (sandboxMenu) sandboxMenu.style.display = 'none';

    // If we were streaming and explicitly asked to abort (e.g., Stop button), abort it
    if (abortStreaming && isFocusModeStreaming && focusModeStreamingNodeId) {
        const nodeData = nodes.find(n => n.id === focusModeStreamingNodeId);
        if (nodeData && nodeData.abortController) {
            nodeData.abortController.abort();
        }
        // Reset streaming state
        isFocusModeStreaming = false;
        focusModeStreamingNodeId = null;
    }
    // If streaming but not aborting, keep streaming state so we can restore view on re-entry

    // P1 Fix: Clean up real-time sync listener
    const focusInput = document.getElementById('focus-chat-input');
    if (focusInput && focusInput._syncListener) {
        focusInput.removeEventListener('input', focusInput._syncListener);
        focusInput._syncListener = null;
        focusInput.innerHTML = ''
    }

    if (lastFocusedInput && lastFocusedInput.id === 'focus-chat-input') {
        lastFocusedInput = null;
    }

    if (activeNodeId) {
        selectNode(activeNodeId);
        const activeEl = document.getElementById(activeNodeId);
        const activeData = nodes.find(n => n.id === activeNodeId);
        if (activeEl && activeData) {
            camera.x = (window.innerWidth / 2) - activeData.x - (activeEl.offsetWidth / 2);
            camera.y = (window.innerHeight / 2) - activeData.y - (activeEl.offsetHeight / 2);
            if (typeof updateCanvas === 'function') updateCanvas();
        }
        // Sync focus input back to canvas node (only if not streaming, as streaming node updates itself)
        if (!isFocusModeStreaming) {
            const focusInput = document.getElementById('focus-chat-input');
            const focusModel = document.getElementById('focus-model-selection');
            const canvasNode = document.getElementById(activeNodeId)
            const canvasInput = canvasNode?.querySelector('.node-input');
            if (focusInput && canvasInput) {
                canvasInput.innerHTML = focusInput.innerHTML.trim() || activeData.htmlText;
                canvasInput.focus();
                const canvasModelSelect = canvasNode.querySelector('.model-selection');
                const selectedModel = focusModel.getAttribute('value');
                if (canvasModelSelect && selectedModel) {
                    canvasModelSelect.innerHTML = focusModel.innerHTML;
                    canvasModelSelect.setAttribute('value', selectedModel);
                }
                moveContentEditableCaretToEnd(canvasInput)
            }
        }
    }

    if (typeof drawEdges === 'function') drawEdges();
    if (typeof drawGroups === 'function') drawGroups();
    if (typeof saveState === 'function') saveState();
    centerCanvas();
}

/**
 * Centralized function to update focus mode button and input state.
 * @param {string} state - 'idle' | 'streaming' | 'error' | 'complete'
 * @param {string} [nodeId] - The nodeId being streamed (required for 'streaming')
 */
function updateFocusModeButtonState(state = 'idle', nodeId = null) {
    const chatInput = document.getElementById('focus-chat-input');
    const sendBtn = document.getElementById('focus-send-btn');
    const stopBtn = document.getElementById('focus-stop-btn');

    if (state === 'streaming') {
        isFocusModeStreaming = true;
        focusModeStreamingNodeId = nodeId;
        if (chatInput) chatInput.contentEditable = false;
        if (sendBtn) sendBtn.style.display = 'none';
        if (stopBtn) stopBtn.style.display = 'flex';
    } else {
        isFocusModeStreaming = false;
        focusModeStreamingNodeId = null;
        if (chatInput) chatInput.contentEditable = true;
        if (sendBtn) sendBtn.style.display = 'flex';
        if (stopBtn) stopBtn.style.display = 'none';
    }
}

/**
 * Updates visual selection highlighting in the focus file tree.
 */
function updateFocusFileSelection() {
    const tree = document.getElementById('focus-file-tree');
    if (!tree) return;
    const items = tree.querySelectorAll('.file-item');
    items.forEach((item) => {
        const filepath = item.dataset.path;
        if (filepath && selectedSandboxFiles.has(filepath)) {
            item.style.background = 'rgba(255, 255, 255, 0.15)';
        } else {
            item.style.background = '';
        }
    });
}

/**
 * Renders the project files tree inside #focus-file-tree through the shared
 * sandbox tree renderer (sidebar.js), so both trees get the same lazy folder
 * expansion, selection, drag/drop behaviour and context menu.
 *
 * Bails out while focus mode is closed — the tree is rebuilt on entry, so
 * re-rendering a hidden tree on every background refresh bought nothing.
 * @param {boolean} showLoading - When false (background refreshes), keep the current tree
 * visible until new data arrives instead of flashing the loading indicator.
 * @param {Object} [preloadedData] - A listing the caller already fetched, so a refresh
 * covering both trees only costs one round trip.
 */
async function renderFocusProjectFiles(showLoading = true, preloadedData = null) {
    const treeContainer = document.getElementById('focus-file-tree');
    if (!treeContainer) return;

    const focusBg = document.getElementById('focus-bg');
    if (!focusBg || focusBg.style.display === 'none') return;

    if (showLoading) {
        treeContainer.innerHTML = '<div class="focus-loading-files"><img src="/static/icons/hourglass.svg" class="file-icon"> Loading files...</div>';
    }

    const data = preloadedData || await loadSandboxFileData();
    if (!data) {
        // On a background refresh, keep the stale tree rather than wiping it with an error
        if (showLoading) {
            treeContainer.innerHTML = '<div class="focus-loading-files" style="color:#ef4444;">Failed to load project files</div>';
        }
        return;
    }

    renderSandboxTree(treeContainer, data, updateFocusFileSelection);
}

/**
 * Renders the linear message lineage history in the main chat layer.
 * Preserves the currently streaming node (if any) to avoid wiping in-progress content.
 */
function renderFocusLineage() {
    const focusNodesLayer = document.getElementById('focus-nodes-layer');
    if (!focusNodesLayer) return;

    // Save the streaming node element if it exists, so we can restore it after
    // re-render — but only when the streamed node belongs to the branch being
    // viewed, otherwise its turn would leak into unrelated conversations.
    const streamingInLineage = isFocusModeStreaming && focusModeStreamingNodeId &&
        current_active_lineage.includes(focusModeStreamingNodeId);
    let streamingNodeEl = null;
    if (streamingInLineage) {
        streamingNodeEl = document.getElementById(`focus-turn-${focusModeStreamingNodeId}`);
        if (streamingNodeEl) {
            // Detach it temporarily to preserve its state
            streamingNodeEl = streamingNodeEl.cloneNode(true);
        }
    }

    focusNodesLayer.innerHTML = '';

    current_active_lineage.forEach(nodeId => {
        const nodeData = nodes.find(n => n.id === nodeId);
        if (!nodeData) return;

        // Skip the last node (the active/input node) - it's rendered separately by sendFocusMessage()
        // and preserved via cloning when streaming. The loop only renders completed ancestor turns.
        if (nodeId === activeNodeId) return;
        // The streaming node is rendered via the preserved live element below
        // (only when its live element actually exists — otherwise fall through
        // and render a snapshot like any other turn).
        if (nodeId === focusModeStreamingNodeId && streamingNodeEl) return;

        const nodeEl = document.getElementById(nodeId);

        // Document or Image node attached in lineage
        if (nodeData.type === 'document' || nodeData.type === 'image' || nodeData.type === 'scrape') {
            const files = nodeData.files || [];
            const fileList = files.map(f => f.name).join(', ') || 'None';
            let icon = {
                'document': documentIcon(),
                'image': imageIcon(),
                'scrape': scrapeIcon()
            }[nodeData.type];
            let text = ''
            const showSummary = nodeData.summaryText && nodeData.isCollapsed;
            switch (nodeData.type) {
                case 'document':
                    icon += 'Document attached: '
                    text = nodeData.files.map(file => `
                        <div style='display:flex; flex-direction: row; justify-content: center; align-items: center; gap: 3px; flex-shrink: 0;'>
                            <img src='${getIconpath(file.name)}' class='file-icon' style='margin-top: -5px;'>${file.name}
                        </div>`)
                    break
                case 'image':
                    icon += 'Image attached: '
                    nodeData.files.forEach(file => {
                        text += `<img src='${file.payload}' class='file-preview' style='display:block; max-height:120px; margin-top: 0px;'>`
                    });
                    break
                case 'scrape':
                    let aiHtml = nodeData.aiText;
                    if (nodeData.type === 'scrape') {
                        if (showSummary) {
                            aiHtml = typeof renderMarkdown === 'function' ? renderMarkdown(nodeData.summaryText) : nodeData.summaryText;
                        } else {
                            aiHtml = marked.parse(nodeData.aiText)
                        }
                    }
                    icon += 'Scraped: '
                    text = `
                        <details style="width: 100%;">
                            <summary style="color: var(--text-muted); justify-content: space-between"><span>${nodeData.htmlText || 'None'} ${showSummary ? '(Summarized)' : ''}</span> ${expandIcon('#888')}</summary>
                            <div class="focus-ai ai-content focus-scraped-md">${aiHtml}</div>
                        </details>
                    `
                    break
                default:
                    break
            }
            const fileNodeEl = document.createElement('div');
            fileNodeEl.className = 'focus-node attachment-node';
            fileNodeEl.classList.add(`${nodeData.type}-node`);
            fileNodeEl.style = 'margin: 40px 0px 10px 0px;';
            fileNodeEl.id = `focus-turn-${nodeId}`;
            fileNodeEl.innerHTML = `
                <div class="focus-user" style="${nodeData.type ==='scrape'?'':'max-'}width: 70%;">
                    <div class='file-node-header' style='display: flex; justify-content: center; align-items: center; gap: 5px;'>${icon}</div>
                    <div ${nodeData.type==='scrape'?'class="scrape-content"':'class="file-div"'} style='max-width: 100%;display: flex; overflow: auto; scrollbar-width: none; ${nodeData.type==='scrape'?'flex-direction: column; width: 100%;':'flex-direction: row'};'>${text}</div>
                </div>
            `;
            focusNodesLayer.appendChild(fileNodeEl);
            return;
        }

        // Chat node
        let userHtml = '';
        if (nodeEl) {
            const inputEl = nodeEl.querySelector('.node-input');
            if (inputEl) userHtml = inputEl.innerHTML.trim();
        }
        if (!userHtml && nodeData.userText) {
            userHtml = typeof renderMarkdown === 'function' ? renderMarkdown(nodeData.userText) : nodeData.userText;
        }

        // Always rebuild from the node's segments via renderAiStreamHtml — the
        // same one-shot renderer ChatNode uses on restore/first paint. The old
        // verbatim copy of the canvas .ai-content made live focus views
        // structurally different from refreshed ones (the incremental stream
        // renderer wraps segments in reconciliation wrappers the one-shot path
        // doesn't), so the structure changed after every reload.
        let aiStreamHtml = (typeof renderAiStreamHtml === 'function') ? renderAiStreamHtml(nodeData) : '';

        const showSummary = nodeData.summaryText && nodeData.isCollapsed;
        if (showSummary) {
            aiStreamHtml = `<span style="font-style: italic;opacity: .5;font-size: 14px;line-height: 1;">Summarized response:</span> ${typeof renderMarkdown === 'function' ? renderMarkdown(nodeData.summaryText) : nodeData.summaryText}`
        }

        // Skip completely unexecuted trailing node in lineage display
        if (!userHtml && !aiStreamHtml) {
            return;
        }

        const turnDiv = document.createElement('div');
        turnDiv.className = nodeData.isStreaming ? 'focus-node chat-node streaming' : 'focus-node chat-node';
        turnDiv.id = `focus-turn-${nodeId}`;

        let turnHtml = '';
        if (userHtml) {
            turnHtml += `<div class="focus-user" style="flex-direction: row;${showSummary?'max-height: 150px; overflow: auto; scrollbar-width: none;':''}">${userHtml}</div>`;
        }
        turnHtml += `<div class="focus-ai ai-content">${aiStreamHtml}</div>`;
        turnHtml += `<button class="add-child-btn" title="Branch">+</button>`

        turnDiv.innerHTML = turnHtml

        // Restored stream: the markup is already in the DOM, so its code blocks
        // can be highlighted right away (Prism skips already-highlighted code).
        if (window.Prism) {
            Prism.highlightAllUnder(turnDiv.querySelector('.focus-ai'));
        }
        focusNodesLayer.appendChild(turnDiv);
    });

    // Add click handlers for "Branch" buttons using event delegation
    // (Do this once after all turnDivs are added)
    if (!focusNodesLayer._branchClickHandler) {
        focusNodesLayer._branchClickHandler = true;
        focusNodesLayer.addEventListener('click', (e) => {
            const branchBtn = e.target.closest('.add-child-btn');
            if (!branchBtn) return;
            const turnEl = branchBtn.closest('.focus-node');
            if (!turnEl || !turnEl.id.startsWith('focus-turn-')) return;
            const nodeId = turnEl.id.slice('focus-turn-'.length);
            const nodeData = nodes.find(n => n.id === nodeId);
            if (!nodeData) return;
            e.stopPropagation();

            // Create a new child node branching from this turn
            const parentEl = document.getElementById(nodeId);
            const parentWidth = parentEl ? parentEl.offsetWidth : 336;
            const bottomY = nodeData.y + (parentEl ? parentEl.offsetHeight : 150);
            const snappedBottomY = Math.ceil(bottomY / GRID_SIZE) * GRID_SIZE;
            let childWidth = 336;
            if (Math.round(parentWidth / GRID_SIZE) % 2 !== Math.round(childWidth / GRID_SIZE) % 2) childWidth += GRID_SIZE;
            const forkX = nodeData.x + (parentWidth - childWidth) / 2;
            const forkY = snappedBottomY + (GRID_SIZE * 3);
            const existingChildren = nodes.filter(n => n.parentId === nodeData.id);
            const parentModel = nodeData.selectedModel || defaultModel;
            const newId = createNode(nodeData.id, forkX, forkY, "", nodeData.turn + 1, nodeData.branch + existingChildren.length, nodeData.name, null, 'chat', parentModel);
            const newEl = document.getElementById(newId);
            const newData = nodes.find(n => n.id === newId);
            if (newEl && newData) {
                newData.nodeWidth = childWidth;
                newEl.style.width = childWidth + 'px';
            }

            // Select the new node and update focus mode
            selectNode(newId);
            if (typeof autoLayout === 'function') autoLayout(true);
            if (typeof saveState === 'function') saveState();

            // Update focus mode to show the new branch
            if (isFocusModeActive) {
                updateChatHistory();
                renderFocusLineage();
                document.getElementById('focus-chat-input').focus()
            }
        });
    }

    // Restore the streaming node if we saved it (append at the end since it's the active node)
    if (streamingNodeEl) {
        // cloneNode(true) keeps the streamed DOM text but drops the renderer's
        // expando caches (_shown/_chipHtml/_segText), so the next incremental
        // renderAiStream pass would mis-reconcile. Rebuild the stream from the
        // node's segments instead — identical markup, caches re-seeded, chip
        // open state preserved via seg.open (same as ChatNode's restore path).
        const clonedStream = streamingNodeEl.querySelector('.focus-ai');
        const streamingData = nodes.find(n => n.id === focusModeStreamingNodeId);
        const hasSegs = streamingData && Array.isArray(streamingData.aiSegments) && streamingData.aiSegments.length > 0;
        if (clonedStream && hasSegs && typeof renderAiStream === 'function') {
            clonedStream.innerHTML = '';
            renderAiStream(clonedStream, streamingData);
        }
        // With no segments yet the clone shows an empty .focus-ai until the
        // first stream event arrives (thinking indicator is CSS-driven now).
        focusNodesLayer.appendChild(streamingNodeEl);
    }

    focusNodesLayer.scrollTop = focusNodesLayer.scrollHeight;
}

/**
 * Handles sending messages directly from Focus Mode.
 * Automatically spawns or uses a child ChatNode on the canvas, sets user content, and streams response.
 */
async function sendFocusMessage() {
    const chatInput = document.getElementById('focus-chat-input');
    if (!chatInput) return;

    // P0 Fix: Prevent double-send while already streaming
    if (isFocusModeStreaming) {
        return;
    }

    const userHtml = chatInput.innerHTML.trim();
    const userText = chatInput.textContent.trim();
    if (!userText) return;

    // Use centralized state management
    updateFocusModeButtonState('streaming'); // nodeId will be set after we determine targetNodeId

    chatInput.innerHTML = '';

    // Check if current activeNodeId is an unexecuted leaf chat node
    let targetNodeId = null;
    let targetNode = nodes.find(n => n.id === activeNodeId);

    const isLeafEmpty = targetNode &&
        targetNode.type === 'chat' &&
        targetNode.childNodeIds.length === 0 &&
        (!targetNode.aiText || targetNode.aiText.trim() === '');

    if (isLeafEmpty) {
        targetNodeId = targetNode.id;
    } else {
        // Automatically create a new child ChatNode attached to current activeNode
        const parentId = activeNodeId;
        const parentNode = nodes.find(n => n.id === parentId);
        let forkX = 408, forkY = 216, turn = 1, branch = 0, name = "Chat_Node", childWidth = 336;
        if (parentNode) {
            const parentEl = document.getElementById(parentNode.id);
            const parentHeight = parentEl ? parentEl.offsetHeight : 150;
            const parentWidth = parentEl ? parentEl.offsetWidth : 336;
            const bottomY = parentNode.y + parentHeight;
            const snappedBottomY = Math.ceil(bottomY / GRID_SIZE) * GRID_SIZE;
            if (Math.round(parentWidth / GRID_SIZE) % 2 !== Math.round(childWidth / GRID_SIZE) % 2) childWidth += GRID_SIZE;
            forkX = parentNode.x + (parentWidth - childWidth) / 2;
            forkY = snappedBottomY + (GRID_SIZE * 3);
            const existingChildren = nodes.filter(n => n.parentId === parentNode.id);
            turn = parentNode.turn + 1;
            branch = parentNode.branch + existingChildren.length;
            name = parentNode.name;
        }

        // Inherit model from parent/active node
        const parentNodeData = nodes.find(n => n.id === parentId);
        const inheritedModel = parentNodeData?.selectedModel || null;
        targetNodeId = createNode(parentId, forkX, forkY, "", turn, branch, name, null, 'chat', inheritedModel);
        const newEl = document.getElementById(targetNodeId);
        const newData = nodes.find(n => n.id === targetNodeId);
        if (newEl && newData) {
            newData.nodeWidth = childWidth;
            newEl.style.width = childWidth + 'px';
        }
        selectNode(targetNodeId);
    }

    // Set input content in canvas node instance
    const targetEl = document.getElementById(targetNodeId);
    if (!targetEl || !targetEl.__nodeInstance) {
        updateFocusModeButtonState('idle');
        return;
    }

    // Now that we have targetNodeId, update streaming state with the correct nodeId
    updateFocusModeButtonState('streaming', targetNodeId);

    const nodeInstance = targetEl.__nodeInstance;
    const inputEl = (nodeInstance && nodeInstance.textarea) ? nodeInstance.textarea : targetEl.querySelector('.node-input');
    if (inputEl) {
        if (nodeInstance) nodeInstance.textarea = inputEl;
        inputEl.innerHTML = userHtml;
        inputEl.dispatchEvent(new Event('input'));
    }

    // Append to Focus Mode conversation layer
    const focusNodesLayer = document.getElementById('focus-nodes-layer');
    if (focusNodesLayer) {
        const turnDiv = document.createElement('div');
        // Same shape renderFocusLineage builds: the chat-node class drives the
        // hover style that reveals the Branch button, and the button is
        // included here so live-created turns branch like restored ones
        // (the delegated click handler on focusNodesLayer covers it).
        turnDiv.className = 'focus-node chat-node streaming';
        turnDiv.id = `focus-turn-${targetNodeId}`;
        turnDiv.innerHTML = `
            <div class="focus-user">${userHtml}</div>
            <div class="focus-ai ai-content"></div>
            <button class="add-child-btn" title="Branch">+</button>
        `;
        focusNodesLayer.appendChild(turnDiv);
        focusNodesLayer.scrollTop = focusNodesLayer.scrollHeight;
    }

    // Update turns badge
    const badgeEl = document.getElementById('focus-node-count-badge');
    if (badgeEl) badgeEl.textContent = `${current_active_lineage.length} turns in branch`;

    // Sync selected model from focus dropdown to canvas node
    const focusModelSelect = document.getElementById('focus-model-selection');
    if (focusModelSelect && targetEl) {
        const canvasModelSelect = targetEl.querySelector('.model-selection');
        const selectedModel = focusModelSelect.getAttribute('value');
        if (canvasModelSelect && selectedModel) {
            canvasModelSelect.innerHTML = focusModelSelect.innerHTML;
            canvasModelSelect.setAttribute('value', selectedModel);
        }
        // Also persist to nodeData
        const targetNodeData = nodes.find(n => n.id === targetNodeId);
        if (targetNodeData && selectedModel) {
            targetNodeData.selectedModel = selectedModel;
        }
    }

    // Trigger execution on the ChatNode
    nodeInstance.run();
}

let focusFileInput = null;

/**
 * Opens the file picker behind the focus mode "+" button. Files picked are
 * attached to the active branch via attachFocusFileNodes().
 */
function openFocusFilePicker() {
    if (isFocusModeStreaming) {
        showToast('Cannot attach files while a response is streaming.', 'error', 2500);
        return;
    }
    if (!focusFileInput) {
        focusFileInput = document.createElement('input');
        focusFileInput.type = 'file';
        focusFileInput.multiple = true;
        focusFileInput.accept = `image/*,${getTextWhitelistExtensions()}`;
        focusFileInput.style.display = 'none';
        document.body.appendChild(focusFileInput);
        focusFileInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files || []);
            focusFileInput.value = '';
            if (files.length) attachFocusFileNodes(files);
        });
    }
    focusFileInput.click();
}

/**
 * Attaches picked files to the active focus branch by creating FileNodes
 * between the current node and its parent (parent -> fileNodes -> currentNode),
 * so the attachments show up as turns in the focus conversation and stay part
 * of the lineage on the canvas.
 * @param {File[]} fileList - Files picked through the hidden input.
 */
async function attachFocusFileNodes(fileList) {
    const currentNode = nodes.find(n => n.id === activeNodeId);
    if (!currentNode || currentNode.isVirtual) {
        showToast('Please select a node first.', 'error', 2500);
        return;
    }

    // Read every payload up front so unsupported files are skipped before any
    // node is created (same whitelists FileNode uses).
    const imageFiles = [];
    const documentFiles = [];
    for (const file of fileList) {
        const isImage = file.type.startsWith('image/') || !!file.name.match(imageWhitelist);
        const isText = textWhitelist.test(file.name) || exactNameWhitelist.test(file.name);
        if (!isImage && !isText) {
            showToast(`Unsupported file type: ${file.name}`, 'error', 2500);
            continue;
        }
        const payload = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            if (isImage) reader.readAsDataURL(file);
            else reader.readAsText(file);
        });
        (isImage ? imageFiles : documentFiles).push({ name: file.name, payload });
    }
    if (imageFiles.length === 0 && documentFiles.length === 0) return;

    const currentEl = document.getElementById(currentNode.id);
    const currentWidth = currentEl ? currentEl.offsetWidth : 336;
    let childWidth = 336;
    if (Math.round(currentWidth / GRID_SIZE) % 2 !== Math.round(childWidth / GRID_SIZE) % 2) childWidth += GRID_SIZE;
    const baseX = currentNode.x + (currentWidth - childWidth) / 2;

    // Build the chain: the first node takes over the current node's old parent,
    // each next node chains onto the previous one. Images and documents each
    // get one node, mirroring the canvas drop handler's grouping.
    const groups = [];
    if (imageFiles.length) groups.push({ type: 'image', files: imageFiles });
    if (documentFiles.length) groups.push({ type: 'document', files: documentFiles });

    let parentId = currentNode.parentId;
    const createdIds = [];
    for (const group of groups) {
        const name = group.files.length === 1 ? group.files[0].name : `${group.files.length} items`;
        const newId = createNode(parentId, baseX, currentNode.y, '', currentNode.turn, currentNode.branch, name, null, group.type);
        const newNode = nodes.find(n => n.id === newId);
        if (newNode) newNode.files = group.files;
        const newEl = document.getElementById(newId);
        if (newEl) {
            newNode.nodeWidth = childWidth;
            newEl.style.width = childWidth + 'px';
        }
        createdIds.push(newId);
        parentId = newId;
    }

    // Re-wire the current node below the last file node
    setNodeParent(currentNode.id, createdIds[createdIds.length - 1]);

    // Stack the created nodes vertically above the current node. Measured after
    // a tick so the file previews have rendered and heights are real.
    setTimeout(() => {
        let topY = currentNode.y;
        for (let i = createdIds.length - 1; i >= 0; i--) {
            const data = nodes.find(n => n.id === createdIds[i]);
            const el = document.getElementById(createdIds[i]);
            if (!data) continue;
            const height = el ? el.offsetHeight : 150;
            const y = Math.ceil((topY - GRID_SIZE * 3 - height) / GRID_SIZE) * GRID_SIZE;
            data.x = baseX;
            data.y = y;
            if (el) el.style.transform = `translate(${data.x}px, ${y}px)`;
            topY = y;
        }
        if (typeof autoLayout === 'function') autoLayout();
        if (typeof drawEdges === 'function') drawEdges();
        if (typeof drawGroups === 'function') drawGroups();
    }, 0);

    // Refresh the active lineage (now runs through the file nodes) and the focus view
    selectNode(activeNodeId);
    if (typeof saveState === 'function') saveState();

    if (isFocusModeActive) {
        updateChatHistory();
        renderFocusLineage();
        const badgeEl = document.getElementById('focus-node-count-badge');
        if (badgeEl) badgeEl.textContent = `${current_active_lineage.length} turns in branch`;
    }
}

/**
 * Removes a "Thinking..." header from a focus turn, if one is present.
 * The built-in placeholder is gone (the thinking indicator is CSS-driven
 * now), so this is a safe no-op kept for any future header-based indicator.
 */
function syncFocusThinkVisibility(turnEl) {
    const aiEl = turnEl && turnEl.querySelector('.focus-ai');
    if (!aiEl) return;
    const headerEl = aiEl.querySelector('.focus-think-header');
    if (headerEl && headerEl.isConnected) headerEl.remove();
}

/**
 * Real-time streaming hook invoked by ChatNode.run() to update Focus Mode UI.
 * Mirrors the canvas ChatNode rendering: reasoning text, tool-call chips and
 * answer text all flow in stream order inside .focus-ai (via the same
 * renderAiStream renderer the canvas node uses), running chips show
 * "Tool call: name(args)..." and flip to expandable "Done:" chips on result,
 * and the stream stays visible while the answer streams and after completion.
 */
function onNodeStreamUpdate(nodeId, type, data, isAborted = false) {
    const focusBg = document.getElementById('focus-bg');
    const focusVisible = focusBg && focusBg.style.display !== 'none' && focusBg.style.display !== '';
    if (!focusVisible) {
        // Focus mode is closed but the stream keeps running on the canvas —
        // still reset the focus streaming state when it ends, otherwise a
        // stale isFocusModeStreaming blocks re-entry, sending and new chats.
        if (type === 'complete' || type === 'error') updateFocusModeButtonState('idle');
        return;
    }

    const turnEl = document.getElementById(`focus-turn-${nodeId}`);
    if (!turnEl) {
        // No focus turn to update, but the stream still ends — reset the
        // focus state or the input stays disabled forever.
        if (type === 'error' || type === 'complete') updateFocusModeButtonState('idle');
        return;
    }

    const aiEl = turnEl.querySelector('.focus-ai');
    const nodeData = nodes.find(n => n.id === nodeId);
    const nodesLayer = document.getElementById('focus-nodes-layer');

    // Shared updater: reconciles the focus stream with ALL of the node's
    // segments so reasoning, chips and answer text interleave in stream order,
    // exactly like the canvas node (renderAiStream comes from ChatNode.js).
    // Stream events arrive per-delta, far faster than frames — render at most
    // once per animation frame, mirroring ChatNode's flushUi throttle.
    let rafId = null;
    const renderStreamNow = () => {
        rafId = null;
        if (!aiEl || !nodeData || typeof renderAiStream !== 'function') return;
        syncFocusThinkVisibility(turnEl);
        renderAiStream(aiEl, nodeData);
    };
    const syncStream = () => {
        if (rafId !== null) return;
        rafId = requestAnimationFrame(renderStreamNow);
    };
    // Final synchronous render: cancels any queued incremental flush first so
    // it can't fire afterwards and wipe an end-of-stream notice appended on top.
    const settleStream = () => {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        renderStreamNow();
    };

    if (type === 'reasoning' || type === 'tool_call_start' || type === 'tool_call' || type === 'tool_result' || type === 'content') {
        // Everything the model emits renders inline in one stream: reasoning
        // text, tool chips ("Tool call: name(args)..." flipping to an
        // expandable "Done:" chip on result) and the answer, in emission order.
        syncStream();
        turnEl.classList.add('streaming');
        updateFocusModeButtonState('streaming', nodeId);
    } else if (type === 'error') {
        settleStream();
        turnEl.classList.remove('streaming');
        syncFocusThinkVisibility(turnEl);
        // The [Stopped by User] / Error notice renders from the persisted
        // nodeData flags (stoppedByUser / lastError) inside renderAiStream, so
        // the focus view and a reloaded canvas end up identical. Non-abort
        // errors now keep the partial stream, instead of wiping it.
        if (!isAborted) {
            document.getElementById('focus-chat-input').innerText = turnEl.querySelector('.focus-user').innerText
            showToast(`${data ? (data.message || data) : 'Unknown error'}`, 'error', 2500)
        }
        updateFocusModeButtonState('idle');
    } else if (type === 'complete') {
        updateFocusModeButtonState('idle');
        turnEl.classList.remove('streaming');
        // Final render (synchronously, so Prism below sees the finished DOM),
        // then the stream stays visible after completion — reasoning text and
        // "Done" tool chips remain inspectable in place.
        settleStream();
        if (window.Prism && aiEl) {
            Prism.highlightAllUnder(aiEl);
        }
        const inputEl = document.getElementById('focus-chat-input');
        if (inputEl) {
            inputEl.focus();
            lastFocusedInput = inputEl;
        }
        autoLayout();
        updateChatHistory();
    }

    if (nodesLayer) {
        if (focusAutoscroll) nodesLayer.scrollTop = nodesLayer.scrollHeight;
    }
}

let focusInputListenersInitialized = false;

/**
 * Populates the focus mode model selection dropdown with cached models.
 * Uses custom dropdown (like ChatNode) instead of native <select>.
 */
async function populateFocusModelSelection() {
    const selectBtn = document.getElementById('focus-model-selection');
    const selectEl = document.querySelector('#focus-input-area .model-list');
    if (!selectEl) return;

    // Add a default/loading option
    selectBtn.innerHTML = 'Loading models...';

    try {
        const models = await getCachedModels();
        if (models && models.length > 0) {

            selectEl.innerHTML = models.map(m =>
                `<div class="model-option" value="${m.id}" vv="${m}" title="${(displayModelName?m.name:m.id)}">${(displayModelName?m.name:m.id)}</div>`
            ).join('');
            // Restore previously selected model if any, else the .env default.
            // No write-back here: nodes without an explicit pick must keep
            // following the default when it changes (e.g. via Settings).
            const activeNodeData = nodes.find(n => n.id === activeNodeId);
            const wanted = activeNodeData?.selectedModel || defaultModel || 'openrouter/free';
            const selectedOption = selectEl.querySelector(`[value="${wanted}"]`) || selectEl.querySelector('.model-option');
            if (selectedOption) {
                selectBtn.innerHTML = selectedOption.innerHTML;
                selectBtn.setAttribute('value', selectedOption.getAttribute('value'));
            }
        } else {
            selectBtn.innerHTML = 'No free models found';
        }
    } catch (e) {
        console.error("Failed to populate focus models:", e);
        selectBtn.innerHTML = 'Error loading models';
    }

    // Toggle dropdown on click
    selectBtn.onclick = () => {
        selectEl.style = selectEl.style.visibility === 'hidden' ? 'visibility: visible; pointer-events: all;' : 'visibility: hidden; pointer-events: none;';
    };

    // Hide dropdown on mouse leave
    const parentEl = document.querySelector('#focus-input-area .model-select-parent');
    if (parentEl) {
        parentEl.onmouseleave = () => {
            selectEl.style = 'visibility: hidden; pointer-events: none;';
        };
    }

    // Store selected model when changed
    selectEl.addEventListener('click', (e) => {
        const target = e.target.closest('.model-option');
        if (!target) return;
        selectBtn.innerHTML = target.innerHTML;
        selectBtn.setAttribute('value', target.getAttribute('value'));
        selectEl.style = 'visibility: hidden; pointer-events: none;';

        const activeNodeData = nodes.find(n => n.id === activeNodeId);
        if (activeNodeData) {
            activeNodeData.selectedModel = target.getAttribute('value');
        }
    });
}

function setupFocusInputListeners() {
    if (focusInputListenersInitialized) return;
    focusInputListenersInitialized = true;

    const chatInput = document.getElementById('focus-chat-input');
    const sendBtn = document.getElementById('focus-send-btn');
    const stopBtn = document.getElementById('focus-stop-btn');
    const exitBtn = document.getElementById('exit-focus-btn');
    const refreshBtn = document.getElementById('focus-refresh-files-btn');

    if (exitBtn) {
        exitBtn.addEventListener('click', () => exitFocusMode(false));
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            renderFocusProjectFiles();
        });
    }

    const uploadFileBtn = document.getElementById('focus-upload-file-btn');
    if (uploadFileBtn) {
        uploadFileBtn.addEventListener('click', openFocusFilePicker);
    }

    if (sendBtn) {
        sendBtn.addEventListener('click', sendFocusMessage);
    }

    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            // Use the streaming node ID if available, otherwise fall back to activeNodeId
            const nodeIdToAbort = focusModeStreamingNodeId || activeNodeId;
            if (nodeIdToAbort) {
                const nodeData = nodes.find(n => n.id === nodeIdToAbort);
                if (nodeData && nodeData.abortController) {
                    nodeData.abortController.abort();
                }
            }
            // Unblock the input immediately — the abort's error event will
            // still arrive and append the "[Stopped by User]" notice.
            updateFocusModeButtonState('idle');
        });
    }

    if (chatInput) {
        chatInput.addEventListener('focus', () => {
            lastFocusedInput = chatInput;
            document.body.classList.add('input-focused');
        });

        chatInput.addEventListener('blur', () => {
            lastFocusedInput = null;
            document.body.classList.remove('input-focused');
        });

        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendFocusMessage();
            }
        });

        // @ mention auto referencing
        // chatInput.addEventListener('keyup', (e) => {
        //     if (e.key === ' ') {
        //         const selection = window.getSelection();
        //         if (!selection.rangeCount) return;
        //         const range = selection.getRangeAt(0);
        //         const textNode = range.startContainer;
        //         if (textNode.nodeType === Node.TEXT_NODE) {
        //             const text = textNode.textContent;
        //             const cursorOffset = range.startOffset;
        //             const textBeforeCursor = text.slice(0, cursorOffset);
        //             const refRegex = /@([\w().\/-]+)\s$/;
        //             const match = textBeforeCursor.match(refRegex);
        //             if (match) {
        //                 const refName = match[1];
        //                 let isGroup = false;
        //                 let targetId = null;
        //                 const refNode = nodes.find(n => n.id === refName);
        //                 if (refNode) {
        //                     targetId = refName;
        //                 } else {
        //                     const groupObj = Object.values(groups).find(g => g.name === refName || g.id === refName);
        //                     if (groupObj) {
        //                         targetId = groupObj.id;
        //                         isGroup = true;
        //                     }
        //                 }
        //                 if (targetId) {
        //                     const delRange = document.createRange();
        //                     delRange.setStart(textNode, match.index);
        //                     delRange.setEnd(textNode, cursorOffset);
        //                     delRange.deleteContents();
        //                     const newRange = document.createRange();
        //                     newRange.setStart(textNode, match.index);
        //                     newRange.collapse(true);
        //                     insertChipAtRange(chatInput, newRange, targetId, isGroup);
        //                 }
        //             }
        //         }
        //     }
        // });

        // Drop file directly into focus input
        chatInput.addEventListener('drop', async (e) => {
            const data = e.dataTransfer.getData('text/plain');
            if (!data) return;
            try {
                const parsed = JSON.parse(data);
                if (Array.isArray(parsed)) {
                    e.preventDefault(); e.stopPropagation();
                    const selection = window.getSelection();
                    let range = null;
                    if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(e.clientX, e.clientY);
                    else if (e.rangeParent) {
                        range = document.createRange();
                        range.setStart(e.rangeParent, e.rangeOffset);
                    }
                    if (range) {
                        selection.removeAllRanges();
                        selection.addRange(range);
                    }
                    lastFocusedInput = chatInput;
                    const filteredPaths = parsed.filter(p => !parsed.some(other => other !== p && p.startsWith(other + '/')));
                    for (const filepath of filteredPaths) {
                        if (typeof handleSandboxFileShiftClick === 'function') {
                            await handleSandboxFileShiftClick(filepath);
                        }
                    }
                    selectedSandboxFiles.clear();
                    lastSelectedSandboxFileIndex = -1;
                    if (typeof updateSidebarSelection === 'function') updateSidebarSelection();
                    if (typeof updateFocusFileSelection === 'function') updateFocusFileSelection();
                }
            } catch (err) { }
        });
    }

    // Keep every collapsible <details> (tool chips, thoughts, tool groups) in
    // sync between the focus layer and the canvas node, and persist the open
    // state into the segment data via the shared persistStreamToggle helper
    // (capture phase, since 'toggle' does not bubble) — so expansion states
    // survive both focus re-renders and full page reloads.
    const focusNodesLayer = document.getElementById('focus-nodes-layer');
    if (focusNodesLayer && !focusNodesLayer._thinkToggleSyncInitialized) {
        focusNodesLayer._thinkToggleSyncInitialized = true;
        focusNodesLayer.addEventListener('toggle', (e) => {
            const details = e.target;
            if (!details.matches || !details.matches('details')) return;
            const turnEl = details.closest('.focus-node');
            if (!turnEl || !turnEl.id.startsWith('focus-turn-')) return;
            const nodeId = turnEl.id.slice('focus-turn-'.length);
            const nodeData = nodes.find(n => n.id === nodeId);
            persistStreamToggle(nodeData, details);

            // Mirror onto the canvas twin so both views stay in sync. Setting
            // open there fires that element's own toggle listener, which also
            // shifts canvas children — nothing loops back to the focus layer.
            const canvasAi = document.getElementById(nodeId)?.querySelector('.ai-content');
            if (!canvasAi) return;
            let canvasDetails = null;
            const segId = details.getAttribute('data-seg-id');
            if (segId) {
                canvasDetails = canvasAi.querySelector(`details[data-seg-id="${segId}"]`);
            } else if (details.classList.contains('tool-group')) {
                const firstChip = details.querySelector('.tool-chip[data-seg-id]');
                const firstId = firstChip ? firstChip.getAttribute('data-seg-id') : null;
                if (firstId) {
                    const chip = canvasAi.querySelector(`.tool-chip[data-seg-id="${firstId}"]`);
                    canvasDetails = chip ? chip.closest('details.tool-group') : null;
                }
            }
            if (canvasDetails && canvasDetails !== details && canvasDetails.open !== details.open) {
                canvasDetails.open = details.open;
            }
        }, true);
    }

    // ESC key to exit Focus Mode (does not abort streaming)
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const focusBg = document.getElementById('focus-bg');
            if (focusBg && focusBg.style.display !== 'none' && focusBg.style.display !== '') {
                exitFocusMode(false); // Don't abort generation on Escape
            }
        }
    });
}

/* =========================================================================
   FOCUS MODE IMPLEMENTATION
   ========================================================================= */

let isFocusModeActive = false;
let isFocusModeStreaming = false; // Tracks if we're currently streaming a response
let focusModeStreamingNodeId = null; // The nodeId currently being streamed

let lastOpenedTab = ''
function showSidebar(target) {
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

function addToChatHistory(targetNode) {
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
            // running tool chip counts as live think-stream content.
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
        // Prevent switching away from an in-progress streaming response
        if (typeof isFocusModeStreaming !== 'undefined' && isFocusModeStreaming) {
            return;
        }
        if (last_active_chat) {
            last_active_chat.querySelector('.chat-entry-text').style.backgroundColor = 'transparent'
        }
        chatEntry.querySelector('.chat-entry-text').style.backgroundColor = '#1e1e1e'
        last_active_chat = chatEntry
        $(targetNode.id).click();
        toggleFocusMode(true);
        centerCanvas();
    })
    $('chat-selection').appendChild(chatEntry)
}

function updateChatHistory() {
    $('chat-selection').innerHTML = ''
    const newChatBtn = document.createElement('div')
    newChatBtn.classList.add('chat-entry')
    newChatBtn.style.marginTop = '10px'
    newChatBtn.innerHTML = `<div class='chat-entry-text' style='display:flex; overflow:hidden; justify-content:center; width: 95%;'>+ New Chat</div>`
    $('chat-selection').appendChild(newChatBtn)
    nodes.forEach(node => {
        // P2 Fix: Include nodes that are thinking (have aiThinking but no aiText
        // yet) — show them with a "Thinking..." indicator instead of hiding them.
        // Unexecuted empty leaves stay listed too (that's the node being typed into).
        if (node.type == 'chat' && node.aiText.trim() == '' && node.childNodeIds.length == 0 && node.aiThinking.trim() =='') {
            if (typeof addToChatHistory == "function") {addToChatHistory(node)}
        }
    });

    newChatBtn.addEventListener('click', () => {
        // Prevent creating new chat while streaming
        if (typeof isFocusModeStreaming !== 'undefined' && isFocusModeStreaming) {
            return;
        }
        createNode()
        updateChatHistory()
        toggleFocusMode(true)
        autoLayout()
        centerCanvas()
    })
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
            selectNode(nodes[nodes.length - 1].id);
        } else {
            createNode();
        }
    }

    const nodeData = nodes.find(n=>n.id==targetId)  
    nodeData.userText = document.getElementById(targetId).querySelector('.node-input').innerText
    nodeData.htmlText = document.getElementById(targetId).querySelector('.node-input').innerHTML

    updateChatHistory()


    isFocusModeActive = true;
    focusBg.style.display = 'flex';
    document.body.classList.add('focus-mode-active');

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
            const canvasInput = document.getElementById(targetId)?.querySelector('.node-input');
            if (canvasInput && !isFocusModeStreaming) {
                canvasInput.innerHTML = chatInput.innerHTML;
                // Update nodeData for saveState
                const nodeData = nodes.find(n => n.id === targetId);
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
 * Renders the project files tree inside #focus-file-tree.
 * Full parity with the floating sidebar palette: selection (single, Shift-range, Ctrl-toggle),
 * drag/drop between folders, context menu, and Shift+Click-to-reference when input is focused.
 */
async function renderFocusProjectFiles() {
    const treeContainer = document.getElementById('focus-file-tree');
    if (!treeContainer) return;

    treeContainer.innerHTML = '<div class="focus-loading-files"><img src="/static/icons/hourglass.svg" class="file-icon"> Loading files...</div>';

    const data = await apiFetchSandboxFiles();
    if (!data) {
        treeContainer.innerHTML = '<div class="focus-loading-files" style="color:#ef4444;">Failed to load project files</div>';
        return;
    }

    treeContainer.innerHTML = '';
    const items = data.items || data.files.map(f => ({ path: f, type: 'file' }));
    const sRoot = { name: 'Sandbox (S:)', path: '', type: 'directory', children: {}, isSandboxRoot: true };
    const treeRoot = { name: '', path: '', type: 'directory', children: { 'S:/': sRoot } };

    items.forEach(item => {
        const parts = item.path.split('/');
        let current = sRoot;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!current.children[parts[i]]) {
                current.children[parts[i]] = { name: parts[i], path: parts.slice(0, i + 1).join('/'), type: 'directory', children: {} };
            }
            current = current.children[parts[i]];
        }
        const name = parts[parts.length - 1];
        if (item.type === 'directory') {
            if (!current.children[name]) {
                current.children[name] = { name, path: item.path, type: 'directory', children: {} };
            }
        } else {
            current.children[name] = { name, path: item.path, type: 'file' };
        }
    });

    currentSandboxFiles = []; // Reset and rebuild in visual order

    function renderNode(node, container, depth = 0) {
        const children = Object.values(node.children).sort((a, b) => {
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        children.forEach(child => {
            const itemWrapper = document.createElement('div');
            itemWrapper.className = 'tree-item-wrapper';

            const item = document.createElement('div');
            item.className = 'file-item';
            item.style.paddingLeft = `${depth * 16 + 8}px`;
            item.style.paddingTop = '4px';
            item.style.paddingBottom = '4px';
            item.style.paddingRight = '8px';
            item.style.borderRadius = '4px';
            item.style.cursor = 'pointer';

            const filepath = child.path;
            currentSandboxFiles.push(filepath);
            const index = currentSandboxFiles.length - 1;

            item.dataset.path = filepath;

            if (child.type === 'directory') {
                const isCollapsed = collapsedSandboxFolders.has(child.path);
                const chevronChar = isCollapsed ? `<img src="/static/icons/chevron-right.svg" class="file-icon">` : `<img src="/static/icons/chevron-down.svg" class="file-icon">`;
                item.innerHTML = `<span class="chevron" style="display:inline-block; width:12px; font-size:10px;">${chevronChar}</span><img src="/static/icons/folder.svg" class="file-icon"> ${child.name}`;

                const childrenContainer = document.createElement('div');
                childrenContainer.className = 'folder-children';
                if (isCollapsed) childrenContainer.style.display = 'none';

                itemWrapper.appendChild(item);
                itemWrapper.appendChild(childrenContainer);
                container.appendChild(itemWrapper);
                renderNode(child, childrenContainer, depth + 1);
            } else {
                const iconSrc = typeof getIconpath === 'function' ? getIconpath(child.name) : '/static/icons/file.svg';
                item.innerHTML = `<span style="display:inline-block; width:12px;"></span> <img class="file-icon" src="${iconSrc}">${child.name}`;
                item.title = 'Double-click to open. Shift+Click in textbox to reference.';

                item.addEventListener('dblclick', () => {
                    window.open('/sandbox/' + filepath, '_blank');
                });

                itemWrapper.appendChild(item);
                container.appendChild(itemWrapper);
            }

            // --- Shared events for selection, drag/drop, and context menu ---

            // Prevent text-selection on modifier clicks
            item.addEventListener('mousedown', (e) => {
                if (child.isSandboxRoot) return;
                if (e.shiftKey || e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                }
            });

            // Drag-over / drag-leave for move targets
            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                item.style.backgroundColor = 'var(--bg-hover)';
            });
            item.addEventListener('dragleave', () => {
                item.style.backgroundColor = selectedSandboxFiles.has(filepath) ? 'rgba(255, 255, 255, 0.15)' : '';
            });

            // Drop to move files between folders
            item.addEventListener('drop', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                item.style.backgroundColor = '';
                const raw = e.dataTransfer.getData('text/plain');
                try {
                    const paths = JSON.parse(raw);
                    let targetDir = child.type === 'directory' ? filepath : (filepath.includes('/') ? filepath.substring(0, filepath.lastIndexOf('/')) : "");
                    if (paths.some(p => targetDir === p || targetDir.startsWith(p + '/'))) return;
                    const success = await apiMoveSandboxFiles(paths, targetDir);
                    if (success) {
                        if (targetDir && collapsedSandboxFolders.has(targetDir)) {
                            let parts = targetDir.split('/');
                            let currentPath = '';
                            for (let part of parts) {
                                currentPath += (currentPath ? '/' : '') + part;
                                collapsedSandboxFolders.delete(currentPath);
                            }
                            localStorage.setItem('collapsedSandboxFolders', JSON.stringify(Array.from(collapsedSandboxFolders)));
                        }
                        selectedSandboxFiles.clear();
                        renderFocusProjectFiles();
                    }
                } catch (err) { }
            });

            // Drag start
            item.draggable = !child.isSandboxRoot;
            item.addEventListener('dragstart', (e) => {
                if (child.isSandboxRoot) { e.preventDefault(); return; }
                if (!selectedSandboxFiles.has(filepath)) {
                    selectedSandboxFiles.clear();
                    selectedSandboxFiles.add(filepath);
                    lastSelectedSandboxFileIndex = index;
                    updateFocusFileSelection();
                }
                e.dataTransfer.setData('text/plain', JSON.stringify(Array.from(selectedSandboxFiles)));
                e.dataTransfer.effectAllowed = 'copy';
            });
            item.addEventListener('dragend', () => {
                selectedSandboxFiles.clear();
                lastSelectedSandboxFileIndex = -1;
                if (typeof updateSidebarSelection === 'function') updateSidebarSelection();
                updateFocusFileSelection();
            });

            // Context menu (right-click)
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if (child.isSandboxRoot) return;
                if (!selectedSandboxFiles.has(filepath)) {
                    selectedSandboxFiles.clear();
                    selectedSandboxFiles.add(filepath);
                    lastSelectedSandboxFileIndex = index;
                    updateFocusFileSelection();
                }
                targetSandboxFile = filepath;

                const delMenu = document.getElementById('menu-delete-sandbox-file');
                if (delMenu) {
                    delMenu.innerHTML = selectedSandboxFiles.size > 1 ? `<img src="/static/icons/trash.svg" class="file-icon"> Delete ${selectedSandboxFiles.size} Items` : `<img src="/static/icons/trash.svg" class="file-icon"> Delete`;
                }

                const ctxMenu = document.getElementById('sandbox-context-menu') || (typeof sandboxContextMenu !== 'undefined' ? sandboxContextMenu : null);
                if (ctxMenu) {
                    ctxMenu.style.display = 'block';
                    ctxMenu.style.left = `${e.clientX}px`;
                    ctxMenu.style.top = `${e.clientY}px`;
                }
            });

            // Click handler: reference insertion OR selection
            item.addEventListener('click', (e) => {
                // If an input is focused and Shift is held, insert a reference chip
                if (e.shiftKey && lastFocusedInput) {
                    e.preventDefault();
                    handleSandboxFileShiftClick(filepath);
                    return;
                }

                // Directory toggle (plain click only)
                if (child.type === 'directory') {
                    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
                        e.stopPropagation();
                        const childrenContainer = itemWrapper.querySelector('.folder-children');
                        const chevron = item.querySelector('.chevron');
                        if (childrenContainer.style.display === 'none') {
                            childrenContainer.style.display = 'block';
                            chevron.innerHTML = `<img src="/static/icons/chevron-down.svg" class="file-icon">`;
                            collapsedSandboxFolders.delete(filepath);
                        } else {
                            childrenContainer.style.display = 'none';
                            chevron.innerHTML = `<img src="/static/icons/chevron-right.svg" class="file-icon">`;
                            collapsedSandboxFolders.add(filepath);
                        }
                        localStorage.setItem('collapsedSandboxFolders', JSON.stringify(Array.from(collapsedSandboxFolders)));
                    }
                }

                if (child.isSandboxRoot) return;

                // Shift+Click range selection (no input focused)
                if (e.shiftKey) {
                    if (lastSelectedSandboxFileIndex === -1) {
                        selectedSandboxFiles.add(filepath);
                        lastSelectedSandboxFileIndex = index;
                    } else {
                        const visibleItems = Array.from(treeContainer.querySelectorAll('.file-item'))
                            .filter(el => el.offsetParent !== null)
                            .map(el => el.dataset.path);
                        const lastPath = currentSandboxFiles[lastSelectedSandboxFileIndex];
                        const startIdx = visibleItems.indexOf(lastPath);
                        const endIdx = visibleItems.indexOf(filepath);

                        if (startIdx !== -1 && endIdx !== -1) {
                            const start = Math.min(startIdx, endIdx);
                            const end = Math.max(startIdx, endIdx);
                            selectedSandboxFiles.clear();
                            for (let i = start; i <= end; i++) {
                                selectedSandboxFiles.add(visibleItems[i]);
                            }
                        } else {
                            selectedSandboxFiles.add(filepath);
                        }
                    }
                } else if (e.ctrlKey || e.metaKey) {
                    // Ctrl/Cmd toggle
                    if (selectedSandboxFiles.has(filepath)) {
                        selectedSandboxFiles.delete(filepath);
                    } else {
                        selectedSandboxFiles.add(filepath);
                        lastSelectedSandboxFileIndex = index;
                    }
                } else {
                    // Plain click – single select
                    selectedSandboxFiles.clear();
                    selectedSandboxFiles.add(filepath);
                    lastSelectedSandboxFileIndex = index;
                }
                updateFocusFileSelection();
            });
        });
    }

    renderNode(treeRoot, treeContainer);

    // Root-level drop to move files to root
    treeContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
    });
    treeContainer.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (e.defaultPrevented) return;
        const raw = e.dataTransfer.getData('text/plain');
        try {
            const paths = JSON.parse(raw);
            if (!Array.isArray(paths)) return;
            const itemsToMove = paths.filter(p => p.includes('/'));
            if (itemsToMove.length === 0) return;
            const success = await apiMoveSandboxFiles(itemsToMove, "");
            if (success) {
                selectedSandboxFiles.clear();
                renderFocusProjectFiles();
            }
        } catch (err) { }
    });
}

/**
 * Wires the fade-on-scroll behavior for a focus-mode think block.
 *
 * The element that actually scrolls is `.focus-think-body .think-stream`
 * (the <details> itself never scrolls, and scroll events don't bubble, so a
 * listener on the <details> would never fire for the stream's scrolling).
 * The <details> click handler re-runs the fade after the block opens/closes.
 *
 * Must be re-run whenever a think block is (re)created or cloned — cloneNode()
 * drops event listeners, so a cloned turn comes back un-wired.
 */
function wireFocusThink(thinkEl) {
    if (!thinkEl || thinkEl._fadeWired) return;
    thinkEl._fadeWired = true;
    const onScroll = () => addFade(thinkEl);
    const stream = thinkEl.querySelector('.focus-think-body .think-stream');
    if (stream) stream.addEventListener('scroll', onScroll);
    const body = thinkEl.querySelector('.focus-think-body');
    if (body) body.addEventListener('scroll', onScroll);
    thinkEl.addEventListener('click', () => {
        setTimeout(() => {
            addFade(thinkEl, !thinkEl.open)
        }, 1)
    })
}

/**
 * Renders the linear message lineage history in the main chat layer.
 * Preserves the currently streaming node (if any) to avoid wiping in-progress content.
 */
function renderFocusLineage() {
    const focusNodesLayer = document.getElementById('focus-nodes-layer');
    if (!focusNodesLayer) return;

    // Save the streaming node element if it exists, so we can restore it after re-render
    let streamingNodeEl = null;
    if (isFocusModeStreaming && focusModeStreamingNodeId) {
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

        const nodeEl = document.getElementById(nodeId);

        // Document or Image node attached in lineage
        if (nodeData.type === 'document' || nodeData.type === 'image' || nodeData.type === 'scrape') {
            const files = nodeData.files || [];
            const fileList = files.map(f => f.name).join(', ') || 'None';
            const icon = {
                'document': documentIcon(),
                'image': imageIcon(),
                'scrape': scrapeIcon()
            }[nodeData.type];
            const text = {
                'document': `Document attached: ${fileList}`,
                'image': `Image attached: ${fileList}`,
                'scrape': `Scraped: <span style="text-decoration:${nodeData.htmlText? 'underline': 'none'};">${nodeData.htmlText || 'None'}</span>`,
            }[nodeData.type];
            const showSummary = nodeData.summaryText && nodeData.isCollapsed;
            let aiHtml = nodeData.aiText;
            if (nodeData.type === 'scrape') {
                if (showSummary) {
                    aiHtml = typeof renderMarkdown === 'function' ? renderMarkdown(nodeData.summaryText) : nodeData.summaryText;
                } else {
                    aiHtml = marked.parse(nodeData.aiText)
                }
            }
            const fileNodeEl = document.createElement('div');
            fileNodeEl.className = 'focus-node';
            fileNodeEl.id = `focus-turn-${nodeId}`;
            fileNodeEl.innerHTML = `
                <div class="focus-user" style="align-self: center; font-size: 13px; color: var(--text-muted); background: var(--bg-surface-hover); padding: 8px 14px; border-radius: 8px; display: flex; align-items: center; gap: 5px;">
                    ${icon} ${text} ${showSummary ? '(Summarized)' : ''}
                </div>
                ${nodeData.type === 'scrape' ? `<div class="focus-ai ai-content focus-scraped-md">${aiHtml}</div>` : ''}
            `;
            fileNodeEl.style = "gap:0px;"
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

        let aiHtml = '';
        if (nodeEl) {
            const contentEl = nodeEl.querySelector('.ai-content');
            if (contentEl) aiHtml = contentEl.innerHTML.trim();
        }
        if (!aiHtml && nodeData.aiText) {
            aiHtml = typeof renderMarkdown === 'function' ? renderMarkdown(nodeData.aiText) : nodeData.aiText;
        }
        const showSummary = nodeData.summaryText && nodeData.isCollapsed;
        if (showSummary) {
            aiHtml = `<span style="font-style: italic;opacity: .5;font-size: 14px;line-height: 1;">Summarized response:</span> ${typeof renderMarkdown === 'function' ? renderMarkdown(nodeData.summaryText) : nodeData.summaryText}`
        }

        const thinking = nodeData.aiThinking ? nodeData.aiThinking.trim() : '';

        // Mirror ChatNode: completed turns keep their full think stream visible —
        // reasoning text and tool-call chips interleaved in stream order. The
        // canvas node's .think-stream is the source of truth for that markup
        // (ChatNode keeps it in the DOM after completion), so copy it verbatim
        // to get the exact same chips ("Done: name(args)" + expandable result).
        // With no live .think-stream (node restored from history — ChatNode's
        // static restore markup sits directly inside .think-content), rebuild
        // the identical markup from the node's segments via renderThinkStreamHtml,
        // the same one-shot renderer ChatNode uses on restore/first paint, so
        // restored turns keep their chips and escaped reasoning text too.
        let thinkStreamHtml = '';
        if (nodeEl) {
            const canvasStream = nodeEl.querySelector('.think-content .think-stream');
            if (canvasStream) thinkStreamHtml = canvasStream.innerHTML.trim();
        }
        if (!thinkStreamHtml && typeof renderThinkStreamHtml === 'function') {
            thinkStreamHtml = renderThinkStreamHtml(nodeData);
        }

        // Skip completely unexecuted trailing node in lineage display
        if (!userHtml && !aiHtml && !thinking && !thinkStreamHtml) {
            return;
        }

        const turnDiv = document.createElement('div');
        turnDiv.className = 'focus-node';
        turnDiv.id = `focus-turn-${nodeId}`;

        let turnHtml = '';
        if (userHtml) {
            turnHtml += `<div class="focus-user">${userHtml}</div>`;
        }
        if (thinkStreamHtml) {
            turnHtml += `
                <details class="focus-think" style="display: block;">
                    <summary class='outer-summary'>Thoughts</summary>
                    <div class="focus-think-body"><div class="think-stream">${thinkStreamHtml}</div></div>
                </details>
            `;
        } else if (thinking) {
            // Legacy node without segments: keep the same .think-stream DOM
            // shape the streaming/canvas structure uses.
            turnHtml += `
                <details class="focus-think" style="display: block;">
                    <summary class='outer-summary'>Thoughts</summary>
                    <div class="focus-think-body"><div class="think-stream">${typeof renderMarkdown === 'function' ? renderMarkdown(thinking) : thinking}</div></div>
                </details>
            `;
        } else {
            turnHtml += `<details class="focus-think" style="display: none;"></details>`;
        }
        if (aiHtml) {
            turnHtml += `<div class="focus-ai ai-content">${aiHtml}</div>`;
        } else {
            turnHtml += `<div class="focus-ai ai-content"></div>`;
        }

        
        
        turnDiv.innerHTML = turnHtml;
        // Restored think stream: the reasoning markup is already in the DOM, so
        // its code blocks can be highlighted right away (the streaming path
        // highlights them as it renders).
        if (window.Prism) {
            const restoredStream = turnDiv.querySelector('.think-stream');
            if (restoredStream) Prism.highlightAllUnder(restoredStream);
        }
        const focusThink = turnDiv.querySelector('.focus-think')

        if (focusThink) {
            wireFocusThink(focusThink)
        }
        focusNodesLayer.appendChild(turnDiv);
    });

    // Restore the streaming node if we saved it (append at the end since it's the active node)
    if (streamingNodeEl) {
        // cloneNode(true) keeps the streamed DOM text but drops the renderer's
        // expando caches (_shown/_chipHtml), so the next incremental
        // renderThinkStream pass would re-append the full reasoning text and
        // duplicate it. Rebuild the stream from the node's segments instead —
        // identical markup, caches re-seeded, chip open state preserved via
        // seg.open (same as ChatNode's restore path).
        const clonedStream = streamingNodeEl.querySelector('.focus-think-body .think-stream');
        const streamingData = nodes.find(n => n.id === focusModeStreamingNodeId);
        if (clonedStream && streamingData && typeof renderThinkStream === 'function') {
            clonedStream.innerHTML = '';
            renderThinkStream(clonedStream, streamingData);
        }
        focusNodesLayer.appendChild(streamingNodeEl);
        // The streaming turn was cloneNode()'d, which drops every listener it had
        // (including the fade wiring) — re-wire it on the clone that's now live.
        wireFocusThink(streamingNodeEl.querySelector('.focus-think'));
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
        turnDiv.className = 'focus-node';
        turnDiv.id = `focus-turn-${targetNodeId}`;
        turnDiv.innerHTML = `
            <div class="focus-user">${userHtml}</div>
            <details class="focus-think" style="display: block;" open>
                <summary class='outer-summary'>Thoughs</summary>
                <div class="focus-think-header"><img src="/static/icons/hourglass.svg" class="file-icon"> Thinking...</div>
                <div class="focus-think-body"><div class="think-stream"></div></div>
            </details>
            <div class="focus-ai ai-content"></div>
        `;
        focusNodesLayer.appendChild(turnDiv);
        // Wire the fade behavior for this live turn — the turn is built from
        // innerHTML here, so it starts with no listeners at all.
        wireFocusThink(turnDiv.querySelector('.focus-think'));
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

/**
 * Mirrors ChatNode's syncThinkVisibility() + think-placeholder lifecycle.
 * ChatNode removes .think-placeholder on the first stream event no matter
 * which kind arrives (onReasoning/onContent/onToolCallStart/onToolCall),
 * then shows the section only while it has reasoning text or tool-call
 * chips. So the "Thinking..." header here is dropped permanently on the
 * first sync — it can never flash back if erase_thoughts later wipes the
 * reasoning segments mid-turn — and the section toggles exactly like the
 * canvas node's .think-content. Only call this from stream events.
 */
function syncFocusThinkVisibility(turnEl, nodeData) {
    const thinkEl = turnEl && turnEl.querySelector('.focus-think');
    if (!thinkEl) return;
    const headerEl = thinkEl.querySelector('.focus-think-header');
    if (headerEl && headerEl.isConnected) headerEl.remove();
    const segs = nodeData && Array.isArray(nodeData.aiSegments) ? nodeData.aiSegments : [];
    const hasReasoning = segs.some(s => s.type === 'reasoning' && s.text && s.text.trim() !== '');
    const hasChips = segs.some(s => s.type === 'tool_call');
    thinkEl.style.display = (hasReasoning || hasChips) ? 'block' : 'none';
}

/**
 * Real-time streaming hook invoked by ChatNode.run() to update Focus Mode UI.
 * Mirrors the canvas ChatNode rendering: reasoning text and tool-call chips
 * interleave in stream order inside .focus-think-body .think-stream (via the
 * same renderThinkStream renderer the canvas node uses), running chips show
 * "Tool call: name(args)..." and flip to expandable "Done:" chips on result,
 * and the stream stays visible while the answer streams and after completion.
 */
function onNodeStreamUpdate(nodeId, type, data, isAborted = false) {
    const focusBg = document.getElementById('focus-bg');
    if (!focusBg || focusBg.style.display === 'none') return;

    const turnEl = document.getElementById(`focus-turn-${nodeId}`);
    if (!turnEl) return;

    const thinkEl = turnEl.querySelector('.focus-think');
    const thinkStreamEl = turnEl.querySelector('.focus-think-body .think-stream');
    const aiEl = turnEl.querySelector('.focus-ai');
    const nodeData = nodes.find(n => n.id === nodeId);
    const nodesLayer = document.getElementById('focus-nodes-layer');

    // Shared updater: reconciles the focus stream with the node's reasoning +
    // tool_call segments so text and chips interleave in stream order, exactly
    // like the canvas node (renderThinkStream comes from ChatNode.js).
    const syncThinkStream = () => {
        if (!thinkEl || !thinkStreamEl) return;
        if (nodeData && typeof renderThinkStream === 'function') {
            renderThinkStream(thinkStreamEl, nodeData);
            // Mirror ChatNode's flushUi: only auto-scroll the think stream if
            // the user is already near the bottom (within 100px).
            const isNearBottom = thinkStreamEl.scrollTop + thinkStreamEl.clientHeight >= thinkStreamEl.scrollHeight - 100;
            if (isNearBottom) thinkStreamEl.scrollTop = thinkStreamEl.scrollHeight;
        }
        syncFocusThinkVisibility(turnEl, nodeData);
    };

    if (type === 'reasoning' || type === 'tool_call_start' || type === 'tool_call' || type === 'tool_result') {
        // Reasoning text and tool chips render inline in the stream: a running
        // chip shows "Tool call: name(args)..." and flips to an expandable
        // "Done:" chip with its result when onToolResult fires (same as canvas).
        syncThinkStream();
        updateFocusModeButtonState('streaming', nodeId);
    } else if (type === 'content') {
        // ChatNode keeps the think stream visible once the answer starts (it may
        // collapse here if erase_thoughts wiped the reasoning) — re-reconcile the
        // stream instead of removing the section, so later tool calls in the same
        // turn still appear alongside the answer.
        syncThinkStream();
        if (aiEl) {
            // Mirror ChatNode's flushUi: the answer always renders through
            // renderAnswerHtml (text segments joined with blank lines), so an
            // answer split around tool calls gets the same paragraph
            // separation as the canvas node instead of a raw concatenation.
            if (nodeData && typeof renderAnswerHtml === 'function') {
                aiEl.innerHTML = renderAnswerHtml(nodeData);
            } else {
                aiEl.innerHTML = typeof renderMarkdown === 'function' ? renderMarkdown(data) : data;
            }
        }
        updateFocusModeButtonState('streaming', nodeId);
    } else if (type === 'error') {
        if (isAborted) {
            if (aiEl) aiEl.innerHTML += `<br><br><span style="color: #ffb86c; font-size: 12px;">[Stopped by User]</span>`;
        } else {
            document.getElementById('focus-chat-input').innerText = turnEl.querySelector('.focus-user').innerText
            showToast(`${data ? (data.message || data) : 'Unknown error'}`, 'error', 2500)
            if (aiEl) aiEl.innerHTML = `<span style="color: #ff5555;">Error: ${data ? (data.message || data) : 'Unknown error'}</span>`;
        }
        updateFocusModeButtonState('idle');
    } else if (type === 'complete') {
        updateFocusModeButtonState('idle');
        // Mirror ChatNode's onComplete: a final placeholder-remove + visibility
        // reconcile, then the think stream stays visible after completion —
        // reasoning text and "Done" tool chips remain inspectable in place.
        // Prism is applied to the answer only, same as the canvas node.
        syncThinkStream();
        thinkEl.open = false
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
        // Mirror ChatNode's near-bottom auto-scroll guard: keep the newest
        // content in view while the user is at the bottom, but never yank the
        // layer away while they scroll back to read earlier thoughts.
        const isNearBottom = nodesLayer.scrollTop + nodesLayer.clientHeight >= nodesLayer.scrollHeight - 100;
        if (isNearBottom) nodesLayer.scrollTop = nodesLayer.scrollHeight;
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
                `<div class="model-option" value="${m.id}" title="${m.name || m.id}">${m.name || m.id}</div>`
            ).join('');
            // Restore previously selected model if any
            const activeNodeData = nodes.find(n => n.id === activeNodeId);
            if (activeNodeData?.selectedModel) {
                const selectedOption = selectEl.querySelector(`[value="${activeNodeData.selectedModel}"]`);
                if (selectedOption) {
                    selectBtn.innerHTML = selectedOption.innerHTML;
                    selectBtn.setAttribute('value', activeNodeData.selectedModel);
                }
            } else {
                const selectedOption = selectEl.querySelector(`[value="openrouter/free"]`);
                if (selectedOption) {
                    selectBtn.innerHTML = selectedOption.innerHTML;
                    selectBtn.setAttribute('value', activeNodeData.selectedModel);
                }
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
        exitBtn.addEventListener('click', exitFocusMode);
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            renderFocusProjectFiles();
        });
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

    // Keep tool-chip <details> open state in sync between the focus layer and
    // the canvas node (capture phase, since 'toggle' does not bubble) — mirrors
    // the capture-phase toggle listener ChatNode attaches to .think-stream, so
    // a chip stays open/closed across focus re-renders.
    const focusNodesLayer = document.getElementById('focus-nodes-layer');
    if (focusNodesLayer && !focusNodesLayer._thinkToggleSyncInitialized) {
        focusNodesLayer._thinkToggleSyncInitialized = true;
        focusNodesLayer.addEventListener('toggle', (e) => {
            const chip = e.target;
            if (!chip.matches || !chip.matches('.tool-chip[data-seg-id]')) return;
            const turnEl = chip.closest('.focus-node');
            if (!turnEl || !turnEl.id.startsWith('focus-turn-')) return;
            const nodeId = turnEl.id.slice('focus-turn-'.length);
            const segId = chip.getAttribute('data-seg-id');
            const nodeData = nodes.find(n => n.id === nodeId);
            if (nodeData && Array.isArray(nodeData.aiSegments)) {
                const seg = nodeData.aiSegments.find(s => s.type === 'tool_call' && s.id === segId);
                if (seg) seg.open = chip.open;
            }
            const canvasChip = document.getElementById(nodeId)?.querySelector(`.think-stream .tool-chip[data-seg-id="${segId}"]`);
            if (canvasChip && canvasChip.open !== chip.open) canvasChip.open = chip.open;
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

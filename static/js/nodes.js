/**
 * Generates a unique ID for a new node based on its name, turn, branch, and ensures no duplicates exist.
 * @param {Object} nodeData - The node's metadata.
 * @returns {string} The newly generated unique ID.
 */
function idfy(nodeData) {
    const name = nodeData.name;
    const turn = nodeData.turn;
    const branch = nodeData.branch;
    let new_id = undefined;
    let dupe_count = 0;
    do {
        new_id = `${name}${dupe_count > 0 ? '(' + dupe_count + ')' : ''}_turn-${turn}${branch > 0 ? '_branch-' + branch : ''}`;
        dupe_count += 1;
    } while (nodes.find(n => n.id === new_id));
    return new_id;
}

/**
 * Recursively fetches all descendant node IDs for a given node.
 * @param {string} nodeId - The ID of the parent node.
 * @returns {string[]} An array containing all descendant node IDs.
 */
function getDescendants(nodeId) {
    let descendants = [];
    let children = nodes.filter(n => n.parentId === nodeId);
    for (let child of children) {
        descendants.push(child.id);
        descendants = descendants.concat(getDescendants(child.id));
    }
    return descendants;
}

/**
 * Finds the direct path of node IDs connecting two nodes within the same lineage (parent to child or vice versa).
 * @param {string} idA - The first node ID.
 * @param {string} idB - The second node ID.
 * @returns {string[]|null} The ordered array of node IDs forming the path, or null if no direct path exists.
 */
function getLineagePath(idA, idB) {
    let path = [];
    let curr = idB;
    while (curr) {
        path.push(curr);
        if (curr === idA) return path.reverse();
        const n = nodes.find(x => x.id === curr);
        curr = n ? n.parentId : null;
    }

    path = [];
    curr = idA;
    while (curr) {
        path.push(curr);
        if (curr === idB) return path.reverse();
        const n = nodes.find(x => x.id === curr);
        curr = n ? n.parentId : null;
    }

    return null;
}

/**
 * Checks if a set of nodes all belong to the same lineage (a single ancestry path).
 * @param {Set<string>} nodeIds - The set of node IDs to check.
 * @returns {boolean} True if they form a single lineage path, false otherwise.
 */
function areNodesInSameLineage(nodeIds) {
    if (nodeIds.size <= 1) return true;

    let deepestNode = null;
    let maxDepth = -1;

    const nodesArray = Array.from(nodeIds).map(id => nodes.find(n => n.id === id)).filter(Boolean);
    if (nodesArray.length !== nodeIds.size) return false;

    nodesArray.forEach(n => {
        let depth = 0;
        let curr = n.parentId;
        while (curr) {
            depth++;
            const parent = nodes.find(x => x.id === curr);
            curr = parent ? parent.parentId : null;
        }
        if (depth > maxDepth) {
            maxDepth = depth;
            deepestNode = n;
        }
    });

    let hitCount = 0;
    let curr = deepestNode ? deepestNode.id : null;
    while (curr) {
        if (nodeIds.has(curr)) hitCount++;
        const n = nodes.find(x => x.id === curr);
        curr = n ? n.parentId : null;
    }

    return hitCount === nodeIds.size;
}

function createNode(parentId = null, x = 0, y = 0, initialUserText = "", turn = 1, branch = 0, name = "Chat_Node", restoreData = null, type = "chat") {
    if (restoreData) type = restoreData.type || 'chat';
    const config = { parentId, x, y, initialUserText, turn, branch, name, restoreData, type };
    let nodeInstance;
    if (type === 'image' || type === 'document') nodeInstance = new FileNode(config);
    else if (type === 'scrape') nodeInstance = new ScrapeNode(config);
    else nodeInstance = new ChatNode(config);
    return nodeInstance.id;
}

/**
 * Creates a Chat node with interactive text areas, LLM execution controls, and branching capabilities.
 * @returns {string} The ID of the created Chat node.
 */
function deleteNode(nodeId, deleteBranch) {
    const nodeIndex = nodes.findIndex(n => n.id === nodeId);
    if (nodeIndex === -1) return;
    const nodeData = nodes[nodeIndex];

    let idsToRemove = [nodeId];

    if (deleteBranch) {
        idsToRemove = idsToRemove.concat(getDescendants(nodeId));
    } else {
        const children = nodes.filter(n => n.parentId === nodeId);
        children.forEach(child => {
            child.parentId = nodeData.parentId;
        });
    }

    // P0 Fix: Abort any in-flight requests for nodes being deleted
    idsToRemove.forEach(id => {
        const nodeToDelete = nodes.find(n => n.id === id);
        if (nodeToDelete && nodeToDelete.abortController) {
            nodeToDelete.abortController.abort();
            nodeToDelete.abortController = null;
        }
        // P0 Fix: Call cleanup on node instance to remove event listeners
        const el = document.getElementById(id);
        if (el && el.__nodeInstance && typeof el.__nodeInstance.cleanup === 'function') {
            el.__nodeInstance.cleanup();
        }
    });

    idsToRemove.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
        nodes = nodes.filter(n => n.id !== id);
    });

    if (idsToRemove.includes(activeNodeId)) {
        if (nodeData.parentId && nodes.find(n => n.id === nodeData.parentId)) {
            selectNode(nodeData.parentId);
        } else if (nodes.length > 0) {
            selectNode(nodes[nodes.length - 1].id);
        } else {
            activeNodeId = null;
            if (typeof updateThermometer === 'function') updateThermometer(null);
            edgesLayer.innerHTML = '';
        }
    } else {
        selectNode(activeNodeId);
    }
    if (nodes.length === 0) {
        setTimeout(() => {
            createNode(null, 0,0);
        }, 20);
    }

    if (typeof saveState === 'function') saveState();
}

/**
 * Marks a node as active, maps its active lineage path, and highlights it visually. 
 * Supports shift-clicking to select multiple nodes in a direct lineage.
 * @param {string} id - The ID of the node to select.
 * @param {boolean} isShiftClick - True if the shift key is held during selection.
 */
function selectNode(id, isShiftClick = false, isCtrlClick = false) {
    const el = document.getElementById(id);
    if (el) el.style.zIndex = highestZIndex++;

    if (isCtrlClick) {
        if (selectedNodes.has(id)) {
            selectedNodes.delete(id);
            if (activeNodeId === id) {
                activeNodeId = selectedNodes.size > 0 ? Array.from(selectedNodes)[selectedNodes.size - 1] : null;
            }
        } else {
            selectedNodes.add(id);
            if (!activeNodeId) activeNodeId = id;
        }
        shiftSelectionStartId = id;
    } else if (isShiftClick) {
        let anchor = shiftSelectionStartId || activeNodeId || id;
        if (anchor !== id) {
            const path = getLineagePath(anchor, id);
            if (path) {
                selectedNodes.clear();
                path.forEach(nodeId => selectedNodes.add(nodeId));
            } else {
                console.warn("Cannot group: Nodes must be in the same direct lineage.");
                selectedNodes.clear();
                selectedNodes.add(id);
                shiftSelectionStartId = id;
            }
        } else {
            selectedNodes.clear();
            selectedNodes.add(id);
            shiftSelectionStartId = id;
        }
    } else {
        selectedNodes.clear();
        selectedNodes.add(id);
        activeNodeId = id;
        shiftSelectionStartId = id;
    }

    const lineage = new Set();
    let curr = activeNodeId;
    while (curr) {
        lineage.add(curr);
        const n = nodes.find(item => item.id === curr);
        curr = n ? n.parentId : null;
    }

    current_active_lineage = Array.from(lineage).reverse()

    document.querySelectorAll('.node').forEach(el => {
        el.classList.toggle('active-branch', lineage.has(el.id));
        const isMulti = selectedNodes.has(el.id) && (selectedNodes.size > 1 || el.id !== activeNodeId || shiftSelectionStartId === el.id);
        el.classList.toggle('multi-selected', isMulti);
    });

    if (typeof drawEdges === 'function') drawEdges(lineage);
    if (typeof updateThermometer === 'function') updateThermometer(activeNodeId);
}

/**
 * Toggles the muted state of a node, allowing its text to be excluded from LLM context generation.
 * @param {string} nodeId - The ID of the node to mute/unmute.
 * @param {Event} e - The click event.
 */
function toggleMute(nodeId, e) {
    if (e) e.stopPropagation();
    const nodeData = nodes.find(n => n.id === nodeId);
    if (!nodeData) return;

    nodeData.muted = !nodeData.muted;
    const el = document.getElementById(nodeId);
    if (el) el.classList.toggle('muted-node', nodeData.muted);

    if (activeNodeId) {
        selectNode(activeNodeId);
    }
}

/**
 * Injects a visual @reference chip into a contenteditable textarea at the current cursor range.
 * @param {HTMLElement} textarea - The target text area.
 * @param {Range} range - The selection range where the chip will be inserted.
 * @param {string} refId - The target ID of the node or group being referenced.
 * @param {boolean} isGroup - True if the reference is pointing to a group of nodes.
 */
function insertChipAtRange(textarea, range, refId, isGroup) {
    let refText = '';
    let chipLabel = '';
    let isFile = false

    if (isGroup) {
        if (!groups[refId]) return false;
        const groupObj = groups[refId];
        const gNodes = nodes.filter(n => n.groupId === refId);

        if (groupObj.isCollapsed) {
            chipLabel = `Summary of <span style="color:${groupObj.color};">${groupIcon(groupObj.color)} ${groupObj.name}</span>`;
            gNodes.forEach((n, idx) => {
                if (n.summaryText && n.summaryText !== "Summary unavailable.") {
                    refText += `[NODE_${idx}] SUMMARY: ${n.summaryText}\n\n`;
                }
            });
        } else {
            chipLabel = `<span style="color:${groupObj.color};">${groupIcon(groupObj.color)} ${groupObj.name}</span>`;
            gNodes.forEach((n, idx) => {
                if (n.aiText && n.aiText.trim() !== '') {
                    refText += `[NODE_${idx}]\nUSER: ${n.userText}\nAssistant: ${n.aiText}\n\n`;
                }
            });
        }

        if (!refText) return false;
    } else {
        const refData = nodes.find(n => n.id === refId);
        if (!refData) return false;

        if (refData.type === 'image' && refData.files && refData.files.length > 0) {
            chipLabel = `<img src="/static/icons/image.svg" class="file-icon"> ${refId}`;
            refText = `[IMAGE_ATTACHED: ${refData.files.map(f => f.name).join(', ')}]`;
            isFile = true
        } else if (refData.type === 'document' && refData.files && refData.files.length > 0) {
            chipLabel = `<img src="/static/icons/document.svg" class="file-icon"> ${refId}`;
            if (refId.endsWith('/*')) {
                const folderName = refId.split('/').slice(1, -1).join('/');
                refText = `[FOLDER_ATTACHED: ${folderName}]\n`;
                refData.files.forEach(f => {
                    refText += `--- START OF ${f.name} ---\n${f.payload}\n--- END OF ${f.name} ---\n\n`;
                });
            } else {
                refText = `[DOCUMENT_ATTACHED: ${refData.files.map(f => f.name).join(', ')}]`;
            }
            isFile = true
        } else if (refData.isCollapsed && refData.summaryText && refData.summaryText !== "Summary unavailable.") {
            chipLabel = `<img src="/static/icons/node.svg" class="file-icon"> Summary of ${refId}`;
            refText = `SUMMARY: ${refData.summaryText}`;
        } else if (refData.type === 'scrape') {
            if (!refData.aiText || refData.aiText.trim() === '') return false;
            chipLabel = `<img src="/static/icons/globe.svg" class="file-icon"> ${refId}`;
            refText = `USER: ${refData.userText} \n Assistant: ${refData.aiText}`;
        } else {
            if (!refData.aiText || refData.aiText.trim() === '') return false;
            chipLabel = `<img src="/static/icons/node.svg" class="file-icon"> ${refId}`;
            refText = `USER: ${refData.userText} \n Assistant: ${refData.aiText}`;
        }
    }

    const chip = document.createElement('span');
    chip.className = 'reference-node';
    chip.contentEditable = 'false';
    chip.setAttribute('data-id', chipLabel);
    chip.setAttribute('data-ref', refId);

    const labelSpan = document.createElement('span');
    labelSpan.className = 'ref-label';
    labelSpan.innerHTML = isFile ? chipLabel : chipLabel.replaceAll('_', ' ');
    chip.appendChild(labelSpan);

    const hiddenText = document.createElement('span');
    hiddenText.className = 'ref-text';
    hiddenText.textContent = `\n\n[START CONTEXT FROM ${refId}]:\n${refText}\n[END CONTEXT]\n\n`;
    chip.appendChild(hiddenText);

    range.deleteContents();
    range.insertNode(chip);

    range.setStartAfter(chip);
    range.setEndAfter(chip);

    const spaceNode = document.createTextNode('\u00A0');
    range.insertNode(spaceNode);
    range.setStartAfter(spaceNode);
    range.setEndAfter(spaceNode);

    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    lastSelectionRange = range.cloneRange();
    textarea.dispatchEvent(new Event('input'));
    textarea.focus();

    return true;
}

/**
 * Handles clicks on node ID headers. Copies ID to clipboard, or if shift-clicked, drops a reference chip into the active text box.
 * @param {Event} event - The click event.
 * @param {string} id - The ID of the node or group.
 * @param {boolean} isGroup - True if the ID belongs to a group.
 */
function handleIdClick(event, id, isGroup = false) {
    if (event.shiftKey) {
        let inserted = false;
        if (lastFocusedInput && lastSelectionRange) {
            // Defensive: re-capture the live cursor position right before inserting.
            // The stored range can go stale (e.g., the user moved the cursor or typing
            // advanced the selection), which would drop the chip at a wrong spot.
            const sel = window.getSelection();
            if (sel.rangeCount && lastFocusedInput.contains(sel.anchorNode)) {
                lastSelectionRange = sel.getRangeAt(0).cloneRange();
            }
            inserted = insertChipAtRange(lastFocusedInput, lastSelectionRange, id, isGroup);
        }

        if (inserted) {
            event.stopPropagation();
        }
        // If not inserted, we intentionally do nothing and do NOT stop propagation.
        // This lets the click event bubble up to `.node` which will naturally trigger
        // lineage selection via `selectNode(el.id, e.shiftKey)`.
    } else {
        if (typeof copy_text === 'function') copy_text(isGroup ? groups[id].name : id);
    }
}

document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (sel.rangeCount > 0 && lastFocusedInput && lastFocusedInput.contains(sel.anchorNode)) {
        lastSelectionRange = sel.getRangeAt(0).cloneRange();
    }
});


/* =========================================================================
   FOCUS MODE IMPLEMENTATION
   ========================================================================= */

let isFocusModeActive = false;
let isFocusModeStreaming = false; // Tracks if we're currently streaming a response
let focusModeStreamingNodeId = null; // The nodeId currently being streamed

/**
 * Toggles the linear chat Focus Mode on or off for the current active branch lineage.
 */
function toggleFocusMode(stayFocused = false) {
    const focusBg = document.getElementById('focus-bg');
    if (!focusBg) return;

    const activeData = nodes.find(n => n.id === activeNodeId);

    // If already in focus mode and not stayFocused, exit
    if (isFocusModeActive || (focusBg.style.display !== 'none' && focusBg.style.display !== '')) {
        if (!stayFocused) {
            exitFocusMode();
            return;
        }
    }

    // If not in focus mode but streaming, allow re-entry to restore streaming view
    // Otherwise, apply normal entry restrictions
    if (!isFocusModeActive && !isFocusModeStreaming) {
        if (activeData && (activeData.hasChild || activeData.aiText.trim() != '' || activeData.type != 'chat' || activeData.aiThinking.trim() != '')) {
            return
        }
    }

    if (!activeNodeId) {
        if (nodes.length > 0) {
            selectNode(nodes[nodes.length - 1].id);
        } else {
            createNode();
        }
    }

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

    // Focus input
    const chatInput = document.getElementById('focus-chat-input');
    if (chatInput) {
        // Don't overwrite input if we're streaming (preserve in-progress content)
        if (!isFocusModeStreaming) {
            chatInput.innerHTML = document.getElementById(activeNodeId).querySelector('.node-input').innerHTML;
        }
        chatInput.focus();
        moveContentEditableCaretToEnd(chatInput);
        lastFocusedInput = chatInput;
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
            const canvasInput = document.getElementById(activeNodeId)?.querySelector('.node-input');
            if (focusInput && canvasInput) {
                canvasInput.innerHTML = focusInput.innerHTML.trim() || activeData.htmlText;
                canvasInput.focus();
            }
        }
    }

    if (typeof drawEdges === 'function') drawEdges();
    if (typeof drawGroups === 'function') drawGroups();
    if (typeof updateThermometer === 'function') updateThermometer(activeNodeId);
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

        // Skip completely unexecuted trailing node in lineage display
        if (!userHtml && !aiHtml && !thinking) {
            return;
        }

        const turnDiv = document.createElement('div');
        turnDiv.className = 'focus-node';
        turnDiv.id = `focus-turn-${nodeId}`;

        let turnHtml = '';
        if (userHtml) {
            turnHtml += `<div class="focus-user">${userHtml}</div>`;
        }
        if (thinking) {
            turnHtml += `
                <div class="focus-think" style="display: block;">
                    <div class="focus-think-header"><img src="/static/icons/hourglass.svg" class="file-icon"> Thinking...</div>
                    <div class="focus-think-body">${typeof renderMarkdown === 'function' ? renderMarkdown(thinking) : thinking}</div>
                </div>
            `;
        } else {
            turnHtml += `<div class="focus-think" style="display: none;"></div>`;
        }
        if (aiHtml) {
            turnHtml += `<div class="focus-ai ai-content">${aiHtml}</div>`;
        } else {
            turnHtml += `<div class="focus-ai ai-content"></div>`;
        }

        turnDiv.innerHTML = turnHtml;
        focusNodesLayer.appendChild(turnDiv);
    });

    // Restore the streaming node if we saved it (append at the end since it's the active node)
    if (streamingNodeEl) {
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
        !targetNode.hasChild &&
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

        targetNodeId = createNode(parentId, forkX, forkY, "", turn, branch, name);
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
            <div class="focus-think" style="display: flex;">
                <div class="focus-think-header"><img src="/static/icons/hourglass.svg" class="file-icon"> Thinking...</div>
                <div class="focus-think-body"></div>
            </div>
            <div class="focus-ai ai-content"></div>
        `;
        focusNodesLayer.appendChild(turnDiv);
        focusNodesLayer.scrollTop = focusNodesLayer.scrollHeight;
    }

    // Update turns badge
    const badgeEl = document.getElementById('focus-node-count-badge');
    if (badgeEl) badgeEl.textContent = `${current_active_lineage.length} turns in branch`;

    // Trigger execution on the ChatNode
    nodeInstance.run();
}

/**
 * Real-time streaming hook invoked by ChatNode.run() to update Focus Mode UI.
 */
function onNodeStreamUpdate(nodeId, type, data, isAborted = false) {
    const focusBg = document.getElementById('focus-bg');
    if (!focusBg || focusBg.style.display === 'none') return;

    const turnEl = document.getElementById(`focus-turn-${nodeId}`);
    if (!turnEl) return;

    const thinkEl = turnEl.querySelector('.focus-think');
    const aiEl = turnEl.querySelector('.focus-ai');
    const nodesLayer = document.getElementById('focus-nodes-layer');

    if (type === 'reasoning') {
        if (thinkEl) {
            const truncData = data.slice(Math.max(0,data.length-1000),data.length)
            thinkEl.style.display = 'block';
            thinkEl.innerHTML = `<div class="focus-think-header"><img src="/static/icons/hourglass.svg" class="file-icon"> Thinking...</div><div class="focus-think-body">${truncData}</div>`;
        }
        updateFocusModeButtonState('streaming', nodeId);
    } else if (type === 'content') {
        if (thinkEl) thinkEl.remove();
        if (aiEl) {
            aiEl.innerHTML = typeof renderMarkdown === 'function' ? renderMarkdown(data) : data;
        }
        updateFocusModeButtonState('streaming', nodeId);
    } else if (type === 'error') {
        if (isAborted) {
            if (aiEl) aiEl.innerHTML += `<br><br><span style="color: #ffb86c; font-size: 12px;">[Stopped by User]</span>`;
        } else {
            if (aiEl) aiEl.innerHTML = `<span style="color: #ff5555;">Error: ${data ? (data.message || data) : 'Unknown error'}</span>`;
        }
        updateFocusModeButtonState('idle');
    } else if (type === 'complete') {
        updateFocusModeButtonState('idle');
        if (window.Prism && aiEl) {
            Prism.highlightAllUnder(aiEl);
            if (thinkEl) Prism.highlightAllUnder(thinkEl);
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
        nodesLayer.scrollTop = nodesLayer.scrollHeight;
    }
}

let focusInputListenersInitialized = false;
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
        chatInput.addEventListener('keyup', (e) => {
            if (e.key === ' ') {
                const selection = window.getSelection();
                if (!selection.rangeCount) return;
                const range = selection.getRangeAt(0);
                const textNode = range.startContainer;
                if (textNode.nodeType === Node.TEXT_NODE) {
                    const text = textNode.textContent;
                    const cursorOffset = range.startOffset;
                    const textBeforeCursor = text.slice(0, cursorOffset);
                    const refRegex = /@([\w().\/-]+)\s$/;
                    const match = textBeforeCursor.match(refRegex);
                    if (match) {
                        const refName = match[1];
                        let isGroup = false;
                        let targetId = null;
                        const refNode = nodes.find(n => n.id === refName);
                        if (refNode) {
                            targetId = refName;
                        } else {
                            const groupObj = Object.values(groups).find(g => g.name === refName || g.id === refName);
                            if (groupObj) {
                                targetId = groupObj.id;
                                isGroup = true;
                            }
                        }
                        if (targetId) {
                            const delRange = document.createRange();
                            delRange.setStart(textNode, match.index);
                            delRange.setEnd(textNode, cursorOffset);
                            delRange.deleteContents();
                            const newRange = document.createRange();
                            newRange.setStart(textNode, match.index);
                            newRange.collapse(true);
                            insertChipAtRange(chatInput, newRange, targetId, isGroup);
                        }
                    }
                }
            }
        });

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

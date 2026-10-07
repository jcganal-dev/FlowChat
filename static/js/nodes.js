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
 * Initializes the base data structure and DOM element for any new node type (chat, image, document).
 * @param {string|null} parentId - The parent node ID.
 * @param {number} x - The X coordinate.
 * @param {number} y - The Y coordinate.
 * @param {string} initialUserText - The starting text of the node.
 * @param {number} turn - The depth turn number of the node.
 * @param {number} branch - The branch index of the node.
 * @param {string} name - The base name of the node.
 * @param {Object|null} restoreData - Optional data object to restore from save state.
 * @param {string} type - The type of node to spawn (e.g. 'chat', 'image').
 * @returns {Object} An object containing the new ID, nodeData, DOM element, and collapsed state.
 */
function setupNodeBase(parentId, x, y, initialUserText, turn, branch, name, restoreData, type) {
    let nodeData;
    let id;
    if (restoreData) {
        nodeData = restoreData;
        id = nodeData.id;
        nodeData.abortController = null;
        if (typeof erase_thoughts !== 'undefined' && erase_thoughts && nodeData.aiText) nodeData.aiThinking = "";
        nodes.push(nodeData);
    } else {
        nodeData = {
            id: undefined,
            type: type,
            filePayload: null,
            fileName: null,
            userText: initialUserText,
            htmlText: initialUserText,
            aiText: "",
            aiThinking: "",
            parentId, x, y,
            muted: false,
            references: [],
            turn: turn, branch: branch,
            name: name, hasChild: false,
            isCollapsed: false,
            abortController: null
        };
        id = idfy(nodeData);
        nodeData.id = id;
        nodes.push(nodeData);
    }

    const isCollapsed = nodeData.groupId && groups[nodeData.groupId]?.isCollapsed;
    const el = document.createElement('div');

    el.className = `node turn-node ${isCollapsed ? 'collapsed-node' : ''}`;
    if (nodeData.muted) el.classList.add('muted-node');
    el.id = id;
    el.style.transform = `translate(${nodeData.x}px, ${nodeData.y}px)`;
    if (nodeData.nodeWidth) el.style.width = `${nodeData.nodeWidth}px`;

    return { id, nodeData, el, isCollapsed };
}

/**
 * Attaches common drag-to-move, resizing, and selection event listeners to a base node element.
 * @param {string} id - The node ID.
 * @param {HTMLElement} el - The node's DOM element.
 * @param {Object|null} restoreData - Whether this node is being restored from a save.
 */
function attachBaseListeners(id, el, restoreData) {
    nodesLayer.appendChild(el);

    setTimeout(() => {
        const header = el.querySelector('.node-header');
        if (header) {
            header.addEventListener('mousedown', (e) => {
                e.stopPropagation();

                const startX = e.clientX;
                const startY = e.clientY;
                const nodeData = nodes.find(n => n.id === id);
                if (!nodeData) return;

                const startNodeX = nodeData.x;
                const startNodeY = nodeData.y;

                function onMouseMove(moveEvent) {
                    const dx = (moveEvent.clientX - startX) / camera.zoom;
                    const dy = (moveEvent.clientY - startY) / camera.zoom;

                    const snapX = Math.round((startNodeX + dx) / GRID_SIZE) * GRID_SIZE;
                    const snapY = Math.round((startNodeY + dy) / GRID_SIZE) * GRID_SIZE;

                    nodeData.x = snapX;
                    nodeData.y = snapY;

                    el.style.transform = `translate(${snapX}px, ${snapY}px)`;
                    if(typeof drawEdges === 'function') drawEdges();
                }

                function onMouseUp() {
                    window.removeEventListener('mousemove', onMouseMove);
                    window.removeEventListener('mouseup', onMouseUp);
                    if(typeof saveState === 'function') saveState();
                }

                window.addEventListener('mousemove', onMouseMove);
                window.addEventListener('mouseup', onMouseUp);
            });
        }
    }, 0);

    if (typeof nodeResizeObserver !== 'undefined') {
        nodeResizeObserver.observe(el);
    }

    const resizer = el.querySelector('.resize-handle');
    if (resizer) {
        resizer.addEventListener('mousedown', (e) => {
            e.stopPropagation();

            const startMouseX = e.clientX;
            const startWidth = el.offsetWidth;
            const nodeData = nodes.find(n => n.id === id);
            if (!nodeData) return;
            const startNodeX = nodeData.x;

            function onMouseMove(moveEvent) {
                const deltaX = (moveEvent.clientX - startMouseX) / camera.zoom;
                let rawWidth = Math.max(300, startWidth + deltaX * 2);
                let snappedWidth = Math.round(rawWidth / GRID_SIZE) * GRID_SIZE;
                el.style.width = `${snappedWidth}px`;

                const widthDiff = snappedWidth - startWidth;
                nodeData.x = startNodeX - (widthDiff / 2);
                nodeData.nodeWidth = snappedWidth;
                el.style.transform = `translate(${nodeData.x}px, ${nodeData.y}px)`;

                clearTimeout(layoutDebounceTimeout);
                layoutDebounceTimeout = setTimeout(() => {
                    if(typeof drawEdges === 'function') drawEdges();
                }, 15);
            }

            function onMouseUp() {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                if(typeof saveState === 'function') saveState();
            }

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    if (!restoreData) {
        selectNode(id);
    }
}

/**
 * Main factory function to dynamically spawn either a Chat, Image, or Document node based on parameters.
 * @returns {string} The ID of the newly created node.
 */
function createNode(parentId = null, x = 408, y = 216, initialUserText = "", turn = 1, branch = 0, name = "Master_Node", restoreData = null, type = "chat") {
    if (restoreData) type = restoreData.type || 'chat';

    if (type === 'image') return createImageNode(parentId, x, y, initialUserText, turn, branch, name, restoreData);
    if (type === 'document') return createDocumentNode(parentId, x, y, initialUserText, turn, branch, name, restoreData);
    return createChatNode(parentId, x, y, initialUserText, turn, branch, name, restoreData);
}

/**
 * Creates an Image file node capable of dragging/dropping image files to be used as context.
 */
function createImageNode(parentId, x, y, initialUserText, turn, branch, name, restoreData) {
    return _createFileNode(parentId, x, y, initialUserText, turn, branch, name, restoreData, 'image');
}

/**
 * Creates a Document file node capable of dragging/dropping text/code files to be used as context.
 */
function createDocumentNode(parentId, x, y, initialUserText, turn, branch, name, restoreData) {
    return _createFileNode(parentId, x, y, initialUserText, turn, branch, name, restoreData, 'document');
}

/**
 * Internal helper function to construct the DOM layout and file-drop events for Image and Document nodes.
 */
function _createFileNode(parentId, x, y, initialUserText, turn, branch, name, restoreData, type) {
    const { id, nodeData, el, isCollapsed } = setupNodeBase(parentId, x, y, initialUserText, turn, branch, name, restoreData, type);
    el.classList.add('file-node');

    el.innerHTML = `
        <div class="node-header">
            <span class="node-id" title="Shift+Click to insert reference" onmousedown="if(event.shiftKey) event.preventDefault();" onclick="handleIdClick(event, '${id}')">${id}</span>
            <div>
                <a class="delete-btn" title="Delete">✖</a>
            </div>
        </div>
        
        <div class="file-dropzone" id="drop_${id}">
            <div class="drop-text" style="${nodeData.filePayload ? 'display:none;' : ''}">
                📥 Drag ${type === 'image' ? 'Image' : 'Document'} Here<br><small>(or click to browse)</small>
            </div>
            <img class="file-preview" id="preview_${id}" src="${type === 'image' && nodeData.filePayload ? nodeData.filePayload : ''}" style="${type === 'image' && nodeData.filePayload ? 'display:block;' : ''}" />
            <input type="file" id="input_${id}" style="display: none;" multiple accept="${type === 'image' ? 'image/*' : '.txt,.js,.py,.html,.css,.json,.md,.csv,.log'}" />
        </div>
        
        <div class="handle handle-out"></div>
        <div class="resize-handle"></div>
    `;

    setTimeout(() => {
        const deleteBtn = el.querySelector('.delete-btn');
        const dropzone = document.getElementById(`drop_${id}`);
        const fileInput = document.getElementById(`input_${id}`);
        const preview = document.getElementById(`preview_${id}`);
        const dropText = el.querySelector('.drop-text');

        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteNode(el.id, e.shiftKey);
        });

        dropzone.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length) processMultipleFiles(e.target.files);
        });

        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        });

        dropzone.addEventListener('dragleave', () => {
            dropzone.classList.remove('dragover');
        });

        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            if (e.dataTransfer.files.length) processMultipleFiles(e.dataTransfer.files);
        });

        function processMultipleFiles(fileList) {
            const data = nodes.find(n => n.id === el.id);
            if (!data) return;

            const files = Array.from(fileList);
            if (files.length === 0) return;

            processFile(files[0], data, el, dropText, preview);

            for (let i = 1; i < files.length; i++) {
                const newX = data.x + (i * 360);
                const newId = createNode(data.parentId, newX, data.y, '', data.turn, data.branch + i, data.name + `_file_${i}`, null, data.type);

                setTimeout(() => {
                    const newEl = document.getElementById(newId);
                    const newData = nodes.find(n => n.id === newId);
                    if (!newEl || !newData) return;

                    const newDropText = newEl.querySelector('.drop-text');
                    const newPreview = document.getElementById(`preview_${newId}`);
                    processFile(files[i], newData, newEl, newDropText, newPreview);
                }, 50);
            }
        }

        function processFile(file, targetData = null, targetEl = null, targetDropText = null, targetPreview = null) {
            const data = nodes.find(n => n.id === el.id);
            targetData = targetData || data;
            targetEl = targetEl || el;
            targetDropText = targetDropText || dropText;
            targetPreview = targetPreview || preview;

            if (!targetData) return;

            const isImageNode = targetData.type === 'image';

            if (isImageNode && !file.type.startsWith('image/')) {
                alert("Please upload an image file for this node.");
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                const result = e.target.result;

                if (targetData) {
                    targetData.filePayload = result;
                    targetData.fileName = file.name;
                }

                targetDropText.style.display = 'none';
                if (isImageNode) {
                    targetPreview.src = result;
                    targetPreview.style.display = 'block';
                } else {
                    targetPreview.style.display = 'none';
                    targetDropText.innerHTML = `📄 ${file.name}<br><small>(${Math.round(file.size / 1024)} KB)</small>`;
                    targetDropText.style.display = 'block';
                }

                if(typeof saveState === 'function') saveState();
            };

            if (isImageNode) {
                reader.readAsDataURL(file);
            } else {
                reader.readAsText(file);
            }
        }

        el.addEventListener('click', (e) => {
            if (!e.target.closest('input')) selectNode(el.id, e.shiftKey);
        });
    }, 0);

    attachBaseListeners(id, el, restoreData);
    return id;
}

/**
 * Creates a Chat node with interactive text areas, LLM execution controls, and branching capabilities.
 * @returns {string} The ID of the created Chat node.
 */
function createChatNode(parentId, x, y, initialUserText, turn, branch, name, restoreData) {
    const { id, nodeData, el, isCollapsed } = setupNodeBase(parentId, x, y, initialUserText, turn, branch, name, restoreData, 'chat');

    const runStyle = nodeData.aiText || nodeData.aiThinking ? 'display: none;' : '';
    const inputContent = restoreData ? (nodeData.htmlText || nodeData.userText) : initialUserText;
    const isEditable = restoreData && nodeData.aiText ? 'false' : 'true';

    el.innerHTML = `
        <div class="handle handle-in ${nodeData.parentId ? '' : 'hidden'}"></div>
        <div class="node-header">
            <span class="node-id" title="Shift+Click to insert reference" onmousedown="if(event.shiftKey) event.preventDefault();" onclick="handleIdClick(event, '${id}')">${id}</span>
            <div>
                <a class="toggle-btn" title="Toggle Summary" style="cursor: pointer; ${nodeData.summaryText ? 'display: inline-block;' : 'display: none;'}" onclick="event.stopPropagation(); if(typeof toggleNodeState === 'function') toggleNodeState('${id}')">${nodeData.isCollapsed ? '🔍' : '📂'}</a>
                <a class="duplicate-btn" title="Duplicate Branch">📄</a>
                <a class="delete-btn" title="Delete">✖</a>
            </div>
        </div>
        <div class="user-section">
            <div contenteditable="${isEditable}" class="node-input" spellcheck="true" placeholder="Type prompt here...">${inputContent}</div>
            <div class="button-row" style="${runStyle}">
                <button class="run-btn">Run ➔</button>
                <button class="stop-btn" style="display: none; background: #ff5555; color: white;">Stop ⏹</button>
            </div>
        </div>
        <div class="ai-section">
            <div class="think-content" style="${nodeData.aiThinking ? 'display:flex;' : 'display:none;'}">${nodeData.aiThinking.trim() == '' ? 'Thinking...' : nodeData.aiThinking}</div>
            <div class="ai-content">${nodeData.aiText}</div>
        </div>
        <div class="node-summary-display">${nodeData.summaryText || ''}</div>
        <div class="handle handle-out"></div>
        <button class="add-child-btn ${nodeData.aiText ? '' : 'hidden'}" title="Branch">+</button>
        <div class="resize-handle"></div>
    `;

    setTimeout(() => {
        const runBtn = el.querySelector('.run-btn');
        const textarea = el.querySelector('.node-input');
        const addBtn = el.querySelector('.add-child-btn');
        const dupBtn = el.querySelector('.duplicate-btn');
        const stopBtn = el.querySelector('.stop-btn');
        const deleteBtn = el.querySelector('.delete-btn');

        stopBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const data = nodes.find(n => n.id === el.id);
            if (data && data.abortController) {
                data.abortController.abort();
            }
        });

        runBtn.addEventListener('click', () => {
            if(typeof runUserNode === 'function') runUserNode(el.id);
        });

        textarea.addEventListener('focus', () => {
            lastFocusedInput = textarea;
        });

        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if(typeof runUserNode === 'function') runUserNode(el.id);
            }
        });

        textarea.addEventListener('keyup', (e) => {
            if (e.key === ' ') {
                const selection = window.getSelection();
                if (!selection.rangeCount) return;

                const range = selection.getRangeAt(0);
                const textNode = range.startContainer;

                if (textNode.nodeType === Node.TEXT_NODE) {
                    const text = textNode.textContent;
                    const cursorOffset = range.startOffset;

                    const textBeforeCursor = text.slice(0, cursorOffset);
                    const refRegex = /@([\w()-]+)\s$/;
                    const match = textBeforeCursor.match(refRegex);

                    if (match) {
                        const refName = match[1];
                        let isGroup = false;
                        let targetId = null;

                        const refNode = nodes.find(n => n.id === refName);
                        if (refNode && refNode.id !== el.id) {
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

                            insertChipAtRange(textarea, newRange, targetId, isGroup);
                        }
                    }
                }
            }
        });

        textarea.addEventListener('input', () => {
            const nodeData = nodes.find(n => n.id === el.id);
            if (!nodeData) return;
            const chips = Array.from(textarea.querySelectorAll('.reference-node'));
            nodeData.references = chips.map(chip => chip.getAttribute('data-ref'));
            if(typeof drawEdges === 'function') drawEdges();
        });

        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            forkOffsetCounter += 1;

            const data = nodes.find(n => n.id === el.id);
            const bottomY = data.y + el.offsetHeight;
            const snappedBottomY = Math.ceil(bottomY / GRID_SIZE) * GRID_SIZE;

            const forkX = data.x;
            const forkY = snappedBottomY + (GRID_SIZE * 3);

            const existingChildren = nodes.filter(n => n.parentId === data.id);
            const newTurn = data.turn + 1;
            const newBranch = data.branch + existingChildren.length;
            const newName = data.name;

            createNode(data.id, forkX, forkY, "", newTurn, newBranch, newName);
        });

        dupBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            forkOffsetCounter += 1;

            const data = nodes.find(n => n.id === el.id);
            const forkX = data.x + 360;

            createNode(data.parentId, forkX, data.y, textarea.innerHTML, data.turn, data.branch, data.name);
        });

        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteNode(el.id, e.shiftKey);
        });

        el.addEventListener('click', (e) => {
            if (!e.target.closest('button') && !e.target.closest('textarea')) {
                selectNode(el.id, e.shiftKey);
            }
        });
    }, 0);

    attachBaseListeners(id, el, restoreData);
    return id;
}

/**
 * Deletes a target node from the canvas. Optionally deletes its entire descendant branch.
 * @param {string} nodeId - The target node ID.
 * @param {boolean} deleteBranch - If true, deletes all children recursively. If false, reconnects children to parent.
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
            createNode();
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
function selectNode(id, isShiftClick = false) {
    if (isShiftClick && activeNodeId && activeNodeId !== id) {
        const path = getLineagePath(activeNodeId, id);

        if (path) {
            path.forEach(nodeId => selectedNodes.add(nodeId));
            activeNodeId = path[path.length - 1];
        } else {
            console.warn("Cannot group: Nodes must be in the same direct lineage.");
            return;
        }
    } else {
        selectedNodes.clear();
        selectedNodes.add(id);
        activeNodeId = id;
    }

    const lineage = new Set();
    let curr = activeNodeId;
    while (curr) {
        lineage.add(curr);
        const n = nodes.find(item => item.id === curr);
        curr = n ? n.parentId : null;
    }

    document.querySelectorAll('.node').forEach(el => {
        el.classList.toggle('active-branch', lineage.has(el.id));
        el.classList.toggle('multi-selected', selectedNodes.size > 1 && selectedNodes.has(el.id));
    });

    if(typeof drawEdges === 'function') drawEdges(lineage);
    if(typeof updateThermometer === 'function') updateThermometer(activeNodeId);
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

    if (isGroup) {
        if (!groups[refId]) return;
        const groupObj = groups[refId];
        const gNodes = nodes.filter(n => n.groupId === refId);

        if (groupObj.isCollapsed) {
            chipLabel = `Summary of ${groupObj.name}`;
            gNodes.forEach((n, idx) => {
                if (n.summaryText && n.summaryText !== "Summary unavailable.") {
                    refText += `[NODE_${idx}] SUMMARY: ${n.summaryText}\n\n`;
                }
            });
        } else {
            chipLabel = `${groupObj.name}`;
            gNodes.forEach((n, idx) => {
                if (n.aiText && n.aiText.trim() !== '') {
                    refText += `[NODE_${idx}]\nUSER: ${n.userText}\nAssistant: ${n.aiText}\n\n`;
                }
            });
        }

        if (!refText) return;
    } else {
        const refData = nodes.find(n => n.id === refId);
        if (!refData) return;

        if (refData.type === 'image' && refData.filePayload !== null && refData.filePayload !== undefined) {
            chipLabel = `🖼️ ${refData.fileName || refId}`;
            refText = `[IMAGE_ATTACHED: ${refData.fileName || refId}]`;
        } else if (refData.type === 'document' && refData.filePayload !== null && refData.filePayload !== undefined) {
            chipLabel = `📄 ${refData.fileName || refId}`;
            refText = `[DOCUMENT_ATTACHED: ${refData.fileName || refId}]`;
        } else if (refData.isCollapsed && refData.summaryText && refData.summaryText !== "Summary unavailable.") {
            chipLabel = `Summary of ${refId}`;
            refText = `SUMMARY: ${refData.summaryText}`;
        } else {
            if (!refData.aiText || refData.aiText.trim() === '') return;
            chipLabel = `${refId}`;
            refText = `USER: ${refData.userText} \n Assistant: ${refData.aiText}`;
        }
    }

    const chip = document.createElement('span');
    chip.className = 'reference-node';
    chip.contentEditable = 'false';
    chip.setAttribute('data-id', chipLabel);
    chip.setAttribute('data-ref', refId);

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
}

/**
 * Handles clicks on node ID headers. Copies ID to clipboard, or if shift-clicked, drops a reference chip into the active text box.
 * @param {Event} event - The click event.
 * @param {string} id - The ID of the node or group.
 * @param {boolean} isGroup - True if the ID belongs to a group.
 */
function handleIdClick(event, id, isGroup = false) {
    if (event.shiftKey && lastFocusedInput && lastSelectionRange) {
        event.stopPropagation();
        insertChipAtRange(lastFocusedInput, lastSelectionRange, id, isGroup);
    } else {
        if(typeof copy_text === 'function') copy_text(isGroup ? groups[id].name : id);
    }
}

document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (sel.rangeCount > 0 && lastFocusedInput && lastFocusedInput.contains(sel.anchorNode)) {
        lastSelectionRange = sel.getRangeAt(0).cloneRange();
    }
});

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
        if (!nodeData.files) nodeData.files = [];
        if (nodeData.filePayload && nodeData.files.length === 0) {
            nodeData.files.push({
                name: nodeData.fileName || 'File',
                payload: nodeData.filePayload
            });
        }
        if (typeof erase_thoughts !== 'undefined' && erase_thoughts && nodeData.aiText) nodeData.aiThinking = "";
        nodes.push(nodeData);
    } else {
        nodeData = {
            id: undefined,
            type: type,
            files: [],
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

    const isCollapsed = nodeData.isCollapsed;
    const el = document.createElement('div');

    el.className = `node turn-node ${isCollapsed ? 'collapsed-node' : ''}`;
    if (nodeData.muted) el.classList.add('muted-node');
    el.id = id;
    el.style.transform = `translate(${nodeData.x}px, ${nodeData.y}px)`;
    if (nodeData.nodeWidth) el.style.width = `${nodeData.nodeWidth}px`;
    el.style.zIndex = highestZIndex++;

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
                if (e.button === 1) return; // Allow middle-click to bubble
                e.preventDefault();
                e.stopPropagation();
                el.style.zIndex = highestZIndex++;

                const startX = e.clientX;
                const startY = e.clientY;
                const nodeData = nodes.find(n => n.id === el.id);
                if (!nodeData) return;

                const startNodeX = nodeData.x;
                const startNodeY = nodeData.y;

                const isShiftDrag = e.shiftKey;
                const isMultiSelect = selectedNodes.has(el.id);
                const draggedNodes = [];

                if (isMultiSelect) {
                    selectedNodes.forEach(selId => {
                        const selData = nodes.find(n => n.id === selId);
                        const selEl = document.getElementById(selId);
                        if (selData && selEl) {
                            draggedNodes.push({ node: selData, startX: selData.x, startY: selData.y, el: selEl });
                        }
                    });
                } else {
                    draggedNodes.push({ node: nodeData, startX: nodeData.x, startY: nodeData.y, el: el });
                }

                const descendants = [];
                if (isShiftDrag) {
                    const queue = draggedNodes.map(dn => dn.node.id);
                    const seen = new Set(queue);

                    while (queue.length > 0) {
                        const currentId = queue.shift();
                        const children = nodes.filter(n => n.parentId === currentId);
                        children.forEach(child => {
                            if (!seen.has(child.id)) {
                                seen.add(child.id);
                                descendants.push({
                                    node: child,
                                    startX: child.x,
                                    startY: child.y,
                                    el: document.getElementById(child.id)
                                });
                                queue.push(child.id);
                            }
                        });
                    }
                }

                let hasMovedNode = false;

                function onMouseMove(moveEvent) {
                    const dx = (moveEvent.clientX - startX) / camera.zoom;
                    const dy = (moveEvent.clientY - startY) / camera.zoom;
                    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMovedNode = true;

                    let primaryTargetX = startNodeX + dx;
                    let primaryTargetY = startNodeY + dy;

                    if (moveEvent.altKey) {
                        primaryTargetX = Math.round(primaryTargetX / GRID_SIZE) * GRID_SIZE;
                        primaryTargetY = Math.round(primaryTargetY / GRID_SIZE) * GRID_SIZE;
                    }

                    const actualDx = primaryTargetX - startNodeX;
                    const actualDy = primaryTargetY - startNodeY;

                    draggedNodes.forEach(dn => {
                        dn.node.x = dn.startX + actualDx;
                        dn.node.y = dn.startY + actualDy;
                        if (dn.el) dn.el.style.transform = `translate(${dn.node.x}px, ${dn.node.y}px)`;
                    });

                    if (isShiftDrag) {
                        descendants.forEach(desc => {
                            desc.node.x = desc.startX + actualDx;
                            desc.node.y = desc.startY + actualDy;
                            if (desc.el) desc.el.style.transform = `translate(${desc.node.x}px, ${desc.node.y}px)`;
                        });
                    }

                    if (typeof drawEdges === 'function') drawEdges();
                    if (typeof drawGroups === 'function') drawGroups();
                }

                function onMouseUp() {
                    window.removeEventListener('mousemove', onMouseMove);
                    window.removeEventListener('mouseup', onMouseUp);
                    if (hasMovedNode) {
                        el.dataset.dragged = 'true';
                        setTimeout(() => delete el.dataset.dragged, 0);
                    }
                    if (typeof saveState === 'function') saveState();
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
            if (e.button === 1) return; // Allow middle-click to bubble
            e.preventDefault();
            e.stopPropagation();

            const startMouseX = e.clientX;
            const nodeData = nodes.find(n => n.id === el.id);
            if (!nodeData) return;

            const targetStartWidth = el.offsetWidth;

            const isMultiSelect = selectedNodes.has(el.id);
            const nodesToResize = [];

            if (isMultiSelect) {
                selectedNodes.forEach(selId => {
                    const selData = nodes.find(n => n.id === selId);
                    const selEl = document.getElementById(selId);
                    if (selData && selEl) {
                        nodesToResize.push({
                            data: selData,
                            el: selEl,
                            startWidth: selEl.offsetWidth,
                            startNodeX: selData.x
                        });
                    }
                });
            } else {
                nodesToResize.push({
                    data: nodeData,
                    el: el,
                    startWidth: targetStartWidth,
                    startNodeX: nodeData.x
                });
            }

            function onMouseMove(moveEvent) {
                const deltaX = (moveEvent.clientX - startMouseX) / camera.zoom;
                const isSymmetrical = moveEvent.ctrlKey || moveEvent.metaKey;

                let snappedWidth;
                if (isSymmetrical) {
                    const diff = Math.round((deltaX * 2) / (GRID_SIZE * 2)) * (GRID_SIZE * 2);
                    snappedWidth = Math.max(300, targetStartWidth + diff);
                } else {
                    const diff = Math.round(deltaX / GRID_SIZE) * GRID_SIZE;
                    snappedWidth = Math.max(300, targetStartWidth + diff);
                }

                nodesToResize.forEach(item => {
                    item.el.style.width = `${snappedWidth}px`;

                    const widthDiff = snappedWidth - item.startWidth;

                    if (isSymmetrical) {
                        item.data.x = item.startNodeX - (widthDiff / 2);
                    } else {
                        item.data.x = item.startNodeX;
                    }

                    item.data.nodeWidth = snappedWidth;
                    item.el.style.transform = `translate(${item.data.x}px, ${item.data.y}px)`;
                });

                clearTimeout(layoutDebounceTimeout);
                layoutDebounceTimeout = setTimeout(() => {
                    if (typeof drawEdges === 'function') drawEdges();
                    if (typeof drawGroups === 'function') drawGroups();
                }, 15);
            }

            function onMouseUp() {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                if (typeof saveState === 'function') saveState();
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
        <div class="handle handle-in"></div>
        <div class="node-header">
            <span class="node-id" title="Shift+Click to insert reference" onmousedown="if(event.shiftKey) event.preventDefault();" onclick="handleIdClick(event, '${id}')">${id}</span>
            <div>
                <a class="delete-btn" title="Delete"><img src="${getIconpath('close')}" class="file-icon"></a>
            </div>
        </div>
        
        <div class="files-container" id="files_${id}"></div>

        <div class="file-dropzone" id="drop_${id}">
            <div class="drop-text">Drag ${type === 'image' ? 'Image' : 'Document'}(s) Here<br><small>(or click to browse)</small></div>
            <input type="file" id="input_${id}" style="display: none;" multiple accept="${type === 'image' ? 'image/*' : '.txt,.js,.py,.html,.css,.json,.md,.csv,.log'}" />
        </div>
        
        <div class="handle handle-out"></div>
        <button class="add-child-btn" title="Branch">+</button>
        <div class="resize-handle"></div>
    `;

    setTimeout(() => {
        const deleteBtn = el.querySelector('.delete-btn');
        const dropzone = el.querySelector('.file-dropzone');
        const fileInput = el.querySelector('input[type="file"]');
        const addBtn = el.querySelector('.add-child-btn');

        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            forkOffsetCounter += 1;

            const data = nodes.find(n => n.id === el.id);
            const bottomY = data.y + el.offsetHeight;
            const snappedBottomY = Math.ceil(bottomY / GRID_SIZE) * GRID_SIZE;

            let childWidth = 336; // default chat node width
            const parentWidth = el.offsetWidth;
            const q_p = Math.round(parentWidth / GRID_SIZE);
            const q_c_default = Math.round(childWidth / GRID_SIZE);
            if (q_p % 2 !== q_c_default % 2) {
                childWidth += GRID_SIZE;
            }

            const forkX = data.x + (parentWidth - childWidth) / 2;
            const forkY = snappedBottomY + (GRID_SIZE * 3);

            const existingChildren = nodes.filter(n => n.parentId === data.id);
            const newTurn = data.turn + 1;
            const newBranch = data.branch + existingChildren.length;
            const newName = data.name;

            const newId = createNode(data.id, forkX, forkY, "", newTurn, newBranch, newName);
            
            const newEl = document.getElementById(newId);
            const newData = nodes.find(n => n.id === newId);
            if (newEl && newData) {
                newData.nodeWidth = childWidth;
                newEl.style.width = childWidth + 'px';
            }
        });

        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (selectedNodes.has(el.id) && selectedNodes.size > 1) {
                Array.from(selectedNodes).forEach(id => deleteNode(id, e.shiftKey));
                selectedNodes.clear();
            } else {
                deleteNode(el.id, e.shiftKey);
            }
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

        function renderFiles() {
            const data = nodes.find(n => n.id === el.id);
            if (!data) return;
            const container = el.querySelector('.files-container');
            const dropzone = el.querySelector('.file-dropzone');
            if (!container) return;

            container.innerHTML = '';

            data.files.forEach((f, idx) => {
                const item = document.createElement('div');
                item.className = 'file-item';

                if (data.type === 'image') {
                    item.innerHTML = `
                        <img src="${f.payload}" class="file-preview" style="display:block; max-width: 100%; max-height: 180px; border-radius: 8px;" />
                        <a class="remove-file-btn" data-idx="${idx}"><img src="${getIconpath('close')}" class="file-icon"></a>
                    `;
                } else {
                    const src = getIconpath(f.name.split('.').pop().toLowerCase());
                    item.innerHTML = `<img src="${src}" class="file-icon"> ${f.name} <a class="remove-file-btn" data-idx="${idx}"><img src="${getIconpath('close')}" class="file-icon"></a>`;
                }

                container.appendChild(item);
            });

            if (dropzone) {
                if (data.files.length > 0) {
                    dropzone.classList.add('minimized');
                    const dt = dropzone.querySelector('.drop-text');
                    if (dt) dt.innerHTML = `<img src="${getIconpath('upload')}" class="file-icon" style="margin: 4px 0px 0px 0px;">`;
                } else {
                    dropzone.classList.remove('minimized');
                    const dt = dropzone.querySelector('.drop-text');
                    if (dt) dt.innerHTML = `Drag ${data.type === 'image' ? 'Image' : 'Document'}(s) Here<br><small>(or click to browse)</small>`;
                }
            }

            container.querySelectorAll('.remove-file-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const idx = parseInt(btn.getAttribute('data-idx'));
                    data.files.splice(idx, 1);
                    renderFiles();
                    if (typeof saveState === 'function') saveState();
                });
            });

            if (typeof drawGroups === 'function') drawGroups();
            if (typeof drawEdges === 'function') drawEdges();
        }

        el.renderFiles = renderFiles;

        function processMultipleFiles(fileList) {
            const data = nodes.find(n => n.id === el.id);
            if (!data) return;
            const files = Array.from(fileList);
            files.forEach(f => processFile(f, data));
        }

        function processFile(file, data) {
            if (!data) return;
            const isImageNode = data.type === 'image';
            if (isImageNode && !file.type.startsWith('image/')) {
                window.customAlert("Please upload an image file for this node.");
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                data.files.push({
                    name: file.name,
                    payload: e.target.result
                });
                renderFiles();
                if (typeof saveState === 'function') saveState();
            };

            if (isImageNode) {
                reader.readAsDataURL(file);
            } else {
                reader.readAsText(file);
            }
        }

        el.addEventListener('click', (e) => {
            if (el.dataset.dragged) return;
            if (!e.target.closest('input') && !e.target.closest('.remove-file-btn')) selectNode(el.id, e.shiftKey, e.ctrlKey || e.metaKey);
        });

        renderFiles();
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
        <div class="handle handle-in"></div>
        <div class="node-header">
            <span class="node-id" title="Shift+Click to insert reference" onmousedown="if(event.shiftKey) event.preventDefault();" onclick="handleIdClick(event, '${id}')">${id}</span>
            <div>
                <a class="toggle-btn" title="Toggle Summary" style="cursor: pointer; ${nodeData.summaryText ? 'display: flex;' : 'display: none;'}" onclick="event.stopPropagation(); if(typeof toggleNodeState === 'function') toggleNodeState('${id}')">${nodeData.isCollapsed ? '<img src="/static/icons/expand.svg" class="file-icon">' : '<img src="/static/icons/collapse.svg" class="file-icon">'}</a>
                <a class="duplicate-btn" title="Duplicate Branch"><img src="${getIconpath('file')}" class="file-icon"></a>
                <a class="delete-btn" title="Delete"><img src="${getIconpath('close')}" class="file-icon"></a>
            </div>
        </div>
        <div class="user-section">
            <div contenteditable="${isEditable}" class="node-input" spellcheck="true" placeholder="Type prompt here...">${inputContent}</div>
            <div class="button-row" style="${runStyle}">
                <button class="run-btn"><img src="${getIconpath('send')}" class="file-icon" style="margin:0px"> Send</button>
                <button class="stop-btn" style="display: none; background: #ff5555; color: white;"><img src="${getIconpath('stop')}" class="file-icon" style="margin:0px"> Stop</button>
            </div>
        </div>
        <div class="ai-section">
            <div class="think-content" style="${nodeData.aiThinking ? 'display:flex;' : 'display:none;'}">${nodeData.aiThinking.trim() == '' ? 'Thinking...' : nodeData.aiThinking}</div>
            <div class="ai-content">${nodeData.aiText ? (typeof renderMarkdown === 'function' ? renderMarkdown(nodeData.aiText) : nodeData.aiText) : ''}</div>
        </div>
        <div class="node-summary-display">${nodeData.summaryText ? (typeof renderMarkdown === 'function' ? renderMarkdown(nodeData.summaryText) : nodeData.summaryText) : ''}</div>
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
            if (typeof runUserNode === 'function') runUserNode(el.id);
        });

        textarea.addEventListener('focus', () => {
            lastFocusedInput = textarea;
        });

        textarea.addEventListener('blur', () => {
            lastFocusedInput = null;
        });

        textarea.addEventListener('drop', async (e) => {
            const data = e.dataTransfer.getData('text/plain');
            if (!data) return;
            try {
                const parsed = JSON.parse(data);
                if (Array.isArray(parsed)) {
                    e.preventDefault();
                    e.stopPropagation();

                    const selection = window.getSelection();
                    let range = null;
                    if (document.caretRangeFromPoint) {
                        range = document.caretRangeFromPoint(e.clientX, e.clientY);
                    } else if (e.rangeParent) {
                        range = document.createRange();
                        range.setStart(e.rangeParent, e.rangeOffset);
                    }

                    if (range) {
                        selection.removeAllRanges();
                        selection.addRange(range);
                    }

                    lastFocusedInput = textarea;

                    const filteredPaths = parsed.filter(p => {
                        return !parsed.some(other => other !== p && p.startsWith(other + '/'));
                    });

                    for (const filepath of filteredPaths) {
                        if (typeof handleSandboxFileShiftClick === 'function') {
                            await handleSandboxFileShiftClick(filepath);
                        }
                    }
                }
            } catch (err) {
                // Not JSON, just let the native drop behavior or paste handler deal with it
            }
        });

        textarea.addEventListener('paste', (e) => {
            e.preventDefault();
            const text = (e.originalEvent || e).clipboardData.getData('text/plain');
            document.execCommand('insertText', false, text);
        });

        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (typeof runUserNode === 'function') runUserNode(el.id);
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
            if (typeof drawEdges === 'function') drawEdges();
        });

        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            forkOffsetCounter += 1;

            const data = nodes.find(n => n.id === el.id);
            const bottomY = data.y + el.offsetHeight;
            const snappedBottomY = Math.ceil(bottomY / GRID_SIZE) * GRID_SIZE;

            let childWidth = 336; // default chat node width
            const parentWidth = el.offsetWidth;
            const q_p = Math.round(parentWidth / GRID_SIZE);
            const q_c_default = Math.round(childWidth / GRID_SIZE);
            if (q_p % 2 !== q_c_default % 2) {
                childWidth += GRID_SIZE;
            }

            const forkX = data.x + (parentWidth - childWidth) / 2;
            const forkY = snappedBottomY + (GRID_SIZE * 3);

            const existingChildren = nodes.filter(n => n.parentId === data.id);
            const newTurn = data.turn + 1;
            const newBranch = data.branch + existingChildren.length;
            const newName = data.name;

            const newId = createNode(data.id, forkX, forkY, "", newTurn, newBranch, newName);
            
            const newEl = document.getElementById(newId);
            const newData = nodes.find(n => n.id === newId);
            if (newEl && newData) {
                newData.nodeWidth = childWidth;
                newEl.style.width = childWidth + 'px';
            }
        });

        dupBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            forkOffsetCounter += 1;

            const data = nodes.find(n => n.id === el.id);
            const forkX = data.x + 360;

            const newId = createNode(data.parentId, forkX, data.y, textarea.innerHTML, data.turn, data.branch, data.name);
            
            const newEl = document.getElementById(newId);
            const newData = nodes.find(n => n.id === newId);
            if (newEl && newData && data.nodeWidth) {
                newData.nodeWidth = data.nodeWidth;
                newEl.style.width = data.nodeWidth + 'px';
            }
        });

        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (selectedNodes.has(el.id) && selectedNodes.size > 1) {
                Array.from(selectedNodes).forEach(id => deleteNode(id, e.shiftKey));
                selectedNodes.clear();
            } else {
                deleteNode(el.id, e.shiftKey);
            }
        });

        el.addEventListener('click', (e) => {
            if (el.dataset.dragged) return;
            if (!e.target.closest('button') && !e.target.closest('textarea')) {
                selectNode(el.id, e.shiftKey, e.ctrlKey || e.metaKey);
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

    if (isGroup) {
        if (!groups[refId]) return false;
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

        if (!refText) return false;
    } else {
        const refData = nodes.find(n => n.id === refId);
        if (!refData) return false;

        if (refData.type === 'image' && refData.files && refData.files.length > 0) {
            chipLabel = `<img src="${getIconpath('image')}" class="file-icon"> ${refData.files.map(f => f.name).join(', ')}`;
            refText = `[IMAGE_ATTACHED: ${refData.files.map(f => f.name).join(', ')}]`;
        } else if (refData.type === 'document' && refData.files && refData.files.length > 0) {
            if (refId.endsWith('/*')) {
                const folderName = refId.split('/').slice(1, -1).join('/');
                chipLabel = `<img src="${getIconpath('folder')}" class="file-icon"> ${folderName}/*`;
                refText = `[FOLDER_ATTACHED: ${folderName}]\n`;
                refData.files.forEach(f => {
                    refText += `--- START OF ${f.name} ---\n${f.payload}\n--- END OF ${f.name} ---\n\n`;
                });
            } else {
                let src = getIconpath(refData.files[0].name.split('.').pop().toLowerCase())
                src = refData.files.length > 1 ? getIconpath('') : src;
                chipLabel = `<img src="${src}" class="file-icon"> ${refData.files.map(f => f.name).join(', ')}`;
                refText = `[DOCUMENT_ATTACHED: ${refData.files.map(f => f.name).join(', ')}]`;
            }
        } else if (refData.isCollapsed && refData.summaryText && refData.summaryText !== "Summary unavailable.") {
            chipLabel = `<img src="${getIconpath('node')}" class="file-icon"> Summary of ${refId}`;
            refText = `SUMMARY: ${refData.summaryText}`;
        } else {
            if (!refData.aiText || refData.aiText.trim() === '') return false;
            chipLabel = `<img src="${getIconpath('node')}" class="file-icon"> ${refId}`;
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
    labelSpan.innerHTML = chipLabel;
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

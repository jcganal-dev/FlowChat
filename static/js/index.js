const $ = (id) => document.getElementById(id)
const $make = (tag) => document.createElement(tag)
const erase_thoughts = true
const viewport = $('viewport')
const nodesLayer = $('nodes-layer')
let selectedNodes = new Set();
let camera = { x: 0, y: 0, zoom: 1 }
const GRID_SIZE = 24
let nodes = []
let activeNodeId = null
const edgesLayer = $('edges-layer')
const promptInput = $('prompt-input')
const sendBtn = $('send-btn')
const CONTEXT_LIMIT = 4096;
let targetNodeIdForMenu = null;
let groups = {};
let forkOffsetCounter = 0;
const contextMenu = $make('div');
let isPanning = false;
let startPanX = 0, startPanY = 0;
let layoutDebounceTimeout;
let lastFocusedInput = null;
let lastSelectionRange = null;

contextMenu.id = 'context-menu';
contextMenu.innerHTML = `
    <div class="context-item" id="menu-add-node">📝 Add Chat Node</div>
    <div class="context-item" id="menu-add-image">🖼️ Add Image Node</div>
    <div class="context-item" id="menu-add-file">📄 Add Document Node</div>
    <div class="context-item" id="menu-rename">✏️ Rename Branch</div>
    <div class="context-item" id="menu-group">📦 Group Selected Nodes</div>
    <div class="context-item" id="menu-ungroup">🔓 Ungroup Node</div>
    <div class="context-item" id="menu-summarize">✨ Summarize Node</div>
`;
document.body.appendChild(contextMenu);

function updateCanvas() {
    const bgSize = GRID_SIZE * camera.zoom
    const bgX = camera.x % bgSize
    const bgY = camera.y % bgSize

    viewport.style.backgroundPosition = `${bgX}px ${bgY}px`
    viewport.style.backgroundSize = `${bgSize}px ${bgSize}px`

    nodesLayer.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
}

viewport.addEventListener('mousedown', (e) => {
    // Only block panning if the click hit a node or a button/input
    if (e.target.closest('.node') || e.target.closest('#controls')) return;

    isPanning = true;
    startPanX = e.clientX - camera.x;
    startPanY = e.clientY - camera.y;
});

window.addEventListener('mousemove', (e) => {
    if (isPanning) {
        camera.x = e.clientX - startPanX;
        camera.y = e.clientY - startPanY;
        updateCanvas();
    }
});

window.addEventListener('mouseup', () => isPanning = false);

viewport.addEventListener('wheel', (e) => {
    e.preventDefault();

    const zoomSensitivity = 0.001;
    const delta = e.deltaY * -zoomSensitivity;
    let newZoom = camera.zoom * Math.exp(delta);

    // Clamp zoom between 10% and 300%
    newZoom = Math.max(0.1, Math.min(newZoom, 3));

    const rect = viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    camera.x = mouseX - (mouseX - camera.x) * (newZoom / camera.zoom);
    camera.y = mouseY - (mouseY - camera.y) * (newZoom / camera.zoom);
    camera.zoom = newZoom;

    updateCanvas();
}, { passive: false });


///////////////////////////////////////////////////////////////////////////////

document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (sel.rangeCount > 0 && lastFocusedInput && lastFocusedInput.contains(sel.anchorNode)) {
        lastSelectionRange = sel.getRangeAt(0).cloneRange();
    }
});

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

        if (!refText) return; // Group had no valid text yet
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

function handleIdClick(event, id, isGroup = false) {
    if (event.shiftKey && lastFocusedInput && lastSelectionRange) {
        event.stopPropagation();
        insertChipAtRange(lastFocusedInput, lastSelectionRange, id, isGroup);
    } else {
        copy_text(isGroup ? groups[id].name : id);
    }
}

function idfy(nodeData) {
    const name = nodeData.name
    const turn = nodeData.turn
    const branch = nodeData.branch
    let new_id = undefined
    let dupe_count = 0
    do {
        new_id = `${name}${dupe_count > 0 ? '(' + dupe_count + ')' : ''}_turn-${turn}${branch > 0 ? '_branch-' + branch : ''}`
        dupe_count += 1
    } while (nodes.find(n => n.id === new_id))
    return new_id
}

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
                    drawEdges();
                }

                function onMouseUp() {
                    window.removeEventListener('mousemove', onMouseMove);
                    window.removeEventListener('mouseup', onMouseUp);
                    saveState();
                }

                window.addEventListener('mousemove', onMouseMove);
                window.addEventListener('mouseup', onMouseUp);
            });
        }
    }, 0);

    nodeResizeObserver.observe(el);

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
                // Double the delta to scale symmetrically
                let rawWidth = Math.max(300, startWidth + deltaX * 2);
                let snappedWidth = Math.round(rawWidth / GRID_SIZE) * GRID_SIZE;
                el.style.width = `${snappedWidth}px`;

                const widthDiff = snappedWidth - startWidth;
                nodeData.x = startNodeX - (widthDiff / 2);
                nodeData.nodeWidth = snappedWidth;
                el.style.transform = `translate(${nodeData.x}px, ${nodeData.y}px)`;

                clearTimeout(layoutDebounceTimeout);
                layoutDebounceTimeout = setTimeout(() => drawEdges(), 15);
            }

            function onMouseUp() {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                saveState();
            }

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }


    if (!restoreData) {
        selectNode(id);
    }
}

function createNode(parentId = null, x = 408, y = 216, initialUserText = "", turn = 1, branch = 0, name = "Master_Node", restoreData = null, type = "chat") {
    if (restoreData) type = restoreData.type || 'chat';

    if (type === 'image') return createImageNode(parentId, x, y, initialUserText, turn, branch, name, restoreData);
    if (type === 'document') return createDocumentNode(parentId, x, y, initialUserText, turn, branch, name, restoreData);
    return createChatNode(parentId, x, y, initialUserText, turn, branch, name, restoreData);
}

function createImageNode(parentId, x, y, initialUserText, turn, branch, name, restoreData) {
    return _createFileNode(parentId, x, y, initialUserText, turn, branch, name, restoreData, 'image');
}

function createDocumentNode(parentId, x, y, initialUserText, turn, branch, name, restoreData) {
    return _createFileNode(parentId, x, y, initialUserText, turn, branch, name, restoreData, 'document');
}

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


                saveState();
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
                <a class="toggle-btn" title="Toggle Summary" style="cursor: pointer; ${nodeData.summaryText ? 'display: inline-block;' : 'display: none;'}" onclick="event.stopPropagation(); toggleNodeState('${id}')">${nodeData.isCollapsed ? '🔍' : '📂'}</a>
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

        runBtn.addEventListener('click', () => runUserNode(el.id));

        textarea.addEventListener('focus', () => {
            lastFocusedInput = textarea;
        });

        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                runUserNode(el.id);
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
            drawEdges();
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

function drawEdges(activeLineage = null) {
    if (!activeLineage) {
        activeLineage = new Set();
        let curr = typeof activeNodeId !== 'undefined' ? activeNodeId : null;
        while (curr) {
            activeLineage.add(curr);
            const n = nodes.find(item => item.id === curr);
            curr = n ? n.parentId : null;
        }
    }

    edgesLayer.innerHTML = '';

    nodes.forEach(node => {
        if (!node.parentId) return;
        const parent = nodes.find(n => n.id === node.parentId);
        if (!parent) return;

        const parentEl = document.getElementById(parent.id);
        const childEl = document.getElementById(node.id);
        if (!parentEl || !childEl) return;

        const parentOut = parentEl.querySelector('.handle-out');
        const childIn = childEl.querySelector('.handle-in');
        const pRect = parentOut.getBoundingClientRect();
        const cRect = childIn.getBoundingClientRect();
        const nlRect = nodesLayer.getBoundingClientRect();

        const startX = (pRect.left + pRect.width / 2 - nlRect.left) / camera.zoom;
        const startY = (pRect.top + pRect.height / 2 - nlRect.top) / camera.zoom;
        const endX = (cRect.left + cRect.width / 2 - nlRect.left) / camera.zoom;
        const endY = (cRect.top + cRect.height / 2 - nlRect.top) / camera.zoom;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${startX} ${startY} C ${startX} ${startY + 60}, ${endX} ${endY - 60}, ${endX} ${endY}`);

        let edgeClass = 'edge-path';
        if (activeLineage.has(node.id) && activeLineage.has(parent.id)) edgeClass += ' active';
        if (node.muted || parent.muted) edgeClass += ' muted';
        path.setAttribute('class', edgeClass);

        edgesLayer.appendChild(path);
    });
}

async function runUserNode(nodeId) {
    const nodeEl = document.getElementById(nodeId);
    const textarea = nodeEl.querySelector('.node-input');
    const usertext = textarea.textContent.trim();
    if (!usertext) return;
    const text = `[System Reminder] 1. Do not overthing, determine the task, immidiately stop thinking after you arrive at an answer. [End System Reminder] ${usertext}`
    const nodeData = nodes.find(n => n.id === nodeId);

    // 1. Extract references from DOM chips (Regex is obsolete for named IDs)
    const chips = Array.from(nodeEl.querySelectorAll('.reference-node'));
    const refs = chips.map(chip => chip.getAttribute('data-ref')).filter(id => id);
    nodeData.references = refs; // Save for drawing

    // 1. Update data model
    nodeData.userText = text;
    nodeData.aiText = "";      // Clear previous run if re-running
    nodeData.aiThinking = "";

    nodeData.abortController = new AbortController();
    const signal = nodeData.abortController.signal;

    // 2. Lock UI
    const aiContentEl = nodeEl.querySelector('.ai-content');
    const aiThinkEl = nodeEl.querySelector('.think-content');
    const runBtn = nodeEl.querySelector('.run-btn');
    const stopBtn = nodeEl.querySelector('.stop-btn');

    aiContentEl.innerHTML = '';
    aiThinkEl.innerHTML = "";
    aiThinkEl.style.display = "none";
    textarea.contentEditable = false;

    runBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'inline-block';

    forkOffsetCounter = 0;

    // 3. Gather history (including the prompt we just typed)
    const history = walkContext(nodeId);
    updateThermometer(nodeId);

    // 2. INJECT REFERENCED CONTEXT AS A SYSTEM OVERRIDE
    if (refs.length > 0) {
        let systemDirectives = "STRICT INSTRUCTIONS FROM REFERENCED NODES:\n";
        let hasImageRefs = false;
        const imageContents = [];
        let hasTextRefs = false;

        refs.forEach(rId => {
            const rNode = nodes.find(n => n.id === rId);
            if (rNode) {
                if (rNode.type === 'image' && rNode.filePayload) {
                    hasImageRefs = true;
                    imageContents.push({
                        type: "image_url",
                        image_url: { url: rNode.filePayload }
                    });
                } else if (rNode.type === 'document' && rNode.filePayload) {
                    hasTextRefs = true;
                    systemDirectives += `\n[DOCUMENT ATTACHED: ${rNode.fileName}]\n${rNode.filePayload}\n`;
                } else {
                    hasTextRefs = true;
                    systemDirectives += `\nRule: ${rNode.userText}\nStatus: ${rNode.aiText}\n`;
                }
            }
        });

        if (hasTextRefs) {
            // Check if a system message already exists at the start
            if (history.length > 0 && history[0].role === 'system') {
                history[0].content += "\n\n" + systemDirectives;
            } else {
                // Unshift puts the system message at the very beginning of the array
                history.unshift({ role: 'system', content: systemDirectives });
            }
        }

        // Inject images into the latest user prompt
        if (hasImageRefs && history.length > 0) {
            const lastMsg = history[history.length - 1];
            if (lastMsg.role === 'user') {
                const originalText = lastMsg.content;
                lastMsg.content = [
                    { type: "text", text: originalText },
                    ...imageContents
                ];
            }
        }
    }

    // 4. Fetch and Stream
    let aborted = false
    try {
        const response = await fetch('http://127.0.0.1:5000/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: history,
                max_tokens: 1000
            }),
            signal: signal // <--- Add this line
        });

        if (!response.body) throw new Error("No readable stream available.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');

        aiContentEl.innerHTML = "";
        let buffer = "";

        // hide button and disable editing
        textarea.contentEditable = false;
        textarea.style.border = "none";
        textarea.style.background = "transparent";
        textarea.style.height = "auto";
        textarea.style.color = "#eee";

        // 2. Hide the run button row
        // const btnRow = nodeEl.querySelector('.button-row');
        // if (btnRow) btnRow.style.display = 'none';

        let erased_thoughts = false
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const deltaObj = JSON.parse(line);
                    if (deltaObj.content) {
                        if (!erased_thoughts) {
                            if (erase_thoughts) {
                                aiThinkEl.innerHTML = '';
                                nodeData.aiThinking = '';
                            }
                            erased_thoughts = true
                        }
                        aiContentEl.innerHTML += deltaObj.content;
                        nodeData.aiText += deltaObj.content;
                    }
                    else if (deltaObj.reasoning_content) {
                        aiThinkEl.style.display = "flex";
                        aiThinkEl.innerHTML += deltaObj.reasoning_content;
                        nodeData.aiThinking += deltaObj.reasoning_content;
                    }
                } catch (e) {
                    console.error("Failed to parse buffered line:", line, e);
                }
            }
            drawEdges();
            updateThermometer(nodeId);
        }

        nodeEl.querySelector('.add-child-btn').classList.remove('hidden');
        nodeEl.querySelector('.add-child-btn').click();

    } catch (error) {
        // 4. Handle the Abort Error gracefully
        if (error.name === 'AbortError') {
            aborted = true
            aiContentEl.innerHTML += `<br><br><span style="color: #ffb86c; font-size: 12px;">[Stopped by User]</span>`;
            // Reveal the branch button so you can continue the conversation from the stopped point
            // nodeEl.querySelector('.add-child-btn').classList.remove('hidden');
            textarea.contentEditable = true;
            textarea.style.border = "";
            textarea.style.background = "";
            runBtn.style.display = 'inline-block';
            stopBtn.style.display = 'none';
        } else {
            aiContentEl.innerHTML = `<span style="color: #ff5555;">Error: ${error.message}</span>`;
        }
    } finally {
        // 5. Hide the entire button row now that the run is finished or stopped
        // const btnRow = nodeEl.querySelector('.button-row');
        // if (btnRow) btnRow.style.display = 'none';
        if (!aborted) {
            const btnRow = nodeEl.querySelector('.button-row');
            if (btnRow) btnRow.style.display = 'none';
        }

        if (!textarea.disabled) {
            textarea.disabled = false;
        }

        updateThermometer(nodeId);
    }
}

function walkContext(leafNodeId) {
    const history = [];
    let currentId = leafNodeId;

    while (currentId) {
        const node = nodes.find(n => n.id === currentId);
        if (!node) break;

        if (node.isCollapsed) {
            if (node.summaryText) {
                history.push({ role: 'system', content: `[COMPRESSED HISTORY]: ${node.summaryText}` });
            }
        } else if (!node.muted) {
            if (node.aiText) history.push({ role: 'assistant', content: node.aiText });
            if (node.userText) history.push({ role: 'user', content: node.userText });
        }
        currentId = node.parentId;
    }
    history.reverse();
    return history;
}

function estimateTokens(messages) {
    const totalChars = messages.reduce((acc, msg) => acc + (msg.content ? msg.content.length : 0), 0);
    return Math.ceil(totalChars / 4);
}

function updateThermometer(nodeId) {
    if (!nodeId) return;
    const history = walkContext(nodeId);
    const tokens = estimateTokens(history);
    const pct = Math.min(100, Math.round((tokens / CONTEXT_LIMIT) * 100));

    const counter = document.getElementById('token-counter');
    const fill = document.getElementById('meter-fill');

    if (counter && fill) {
        counter.textContent = `${tokens.toLocaleString()} / ${CONTEXT_LIMIT.toLocaleString()} tokens (${pct}%)`;
        fill.style.width = `${pct}%`;
        fill.className = pct > 85 ? 'danger' : pct > 65 ? 'warning' : '';
    }
}

function selectNode(id, isShiftClick = false) {
    if (isShiftClick && activeNodeId && activeNodeId !== id) {
        // 1. Try to find a direct path between the active node and the clicked node
        const path = getLineagePath(activeNodeId, id);

        if (path) {
            // Valid lineage! Add all nodes in the path to the selection set
            path.forEach(nodeId => selectedNodes.add(nodeId));

            // The lowest node in the path must become the active node so that 
            // lineage calculation and token counting include the entire selection.
            activeNodeId = path[path.length - 1];
        } else {
            // Invalid selection (e.g., trying to group two parallel branches)
            console.warn("Cannot group: Nodes must be in the same direct lineage.");
            return;
        }
    } else {
        // Normal click: Clear multi-selection and select just this one
        selectedNodes.clear();
        selectedNodes.add(id);
        activeNodeId = id;
    }

    // 2. Visual Updates
    // Keep your existing lineage highlighting code here...
    const lineage = new Set();
    let curr = activeNodeId;
    while (curr) {
        lineage.add(curr);
        const n = nodes.find(item => item.id === curr);
        curr = n ? n.parentId : null;
    }

    document.querySelectorAll('.node').forEach(el => {
        // Highlight active bloodline
        el.classList.toggle('active-branch', lineage.has(el.id));

        // ADD THIS: Add a distinct styling class for selected nodes in a group range
        el.classList.toggle('multi-selected', selectedNodes.has(el.id));
    });

    drawEdges(lineage);
    updateThermometer(activeNodeId);
}

function toggleMute(nodeId, e) {
    if (e) e.stopPropagation();
    const nodeData = nodes.find(n => n.id === nodeId);
    if (!nodeData) return;

    nodeData.muted = !nodeData.muted;
    const el = document.getElementById(nodeId);
    if (el) el.classList.toggle('muted-node', nodeData.muted);

    if (activeNodeId) {
        selectNode(activeNodeId); // Re-runs edge drawing and thermometer updates
    }
}

async function copy_text(text) {
    try {
        // 2. Write the text to the system clipboard
        await navigator.clipboard.writeText(text);
    } catch (err) {
        console.error('Failed to copy text: ', err);
    }
}

function getDescendants(nodeId) {
    let descendants = [];
    let children = nodes.filter(n => n.parentId === nodeId);
    for (let child of children) {
        descendants.push(child.id);
        descendants = descendants.concat(getDescendants(child.id));
    }
    return descendants;
}

function deleteNode(nodeId, deleteBranch) {
    const nodeIndex = nodes.findIndex(n => n.id === nodeId);
    if (nodeIndex === -1) return;
    const nodeData = nodes[nodeIndex];

    let idsToRemove = [nodeId];

    if (deleteBranch) {
        // Shift+Click: Delete this node and everything below it
        idsToRemove = idsToRemove.concat(getDescendants(nodeId));
    } else {
        // Normal Click: Reconnect children to the deleted node's parent
        const children = nodes.filter(n => n.parentId === nodeId);
        children.forEach(child => {
            child.parentId = nodeData.parentId;
        });
    }

    // Remove from DOM and Data Array
    idsToRemove.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
        nodes = nodes.filter(n => n.id !== id);
    });

    // Handle Active Node Reset
    if (idsToRemove.includes(activeNodeId)) {
        if (nodeData.parentId && nodes.find(n => n.id === nodeData.parentId)) {
            selectNode(nodeData.parentId); // Fall back to parent
        } else if (nodes.length > 0) {
            selectNode(nodes[nodes.length - 1].id); // Fall back to newest existing node
        } else {
            activeNodeId = null;
            updateThermometer(null);
            edgesLayer.innerHTML = '';
        }
    } else {
        selectNode(activeNodeId); // Re-calculate lineage and redraw edges
    }
    if (nodes.length === 0) {
        setTimeout(() => {
            createNode();
        }, 20)
    } else {

    }
}

function autoLayout() {


    const HORIZONTAL_GAP = GRID_SIZE * 4;
    let currentRootX = 400;
    const childrenMap = {};
    const roots = [];

    // Map parent/child relationships
    nodes.forEach(n => {
        if (n.parentId && nodes.some(p => p.id === n.parentId)) {
            if (!childrenMap[n.parentId]) childrenMap[n.parentId] = [];
            childrenMap[n.parentId].push(n);
        } else {
            roots.push(n);
        }
    });

    // PASS 1: Calculate the exact "lane" width needed for each subtree
    function calculateSubtreeMetrics(nodeData) {
        const children = childrenMap[nodeData.id] || [];
        const el = document.getElementById(nodeData.id);

        const nodeWidth = el ? el.offsetWidth : 380;
        const nodeHeight = el ? el.offsetHeight : 200;

        nodeData.nodeWidth = nodeWidth;
        nodeData.nodeHeight = nodeHeight;

        // Separate children by group affiliation
        let groupedChildren = children.filter(c => nodeData.groupId && c.groupId === nodeData.groupId);
        let otherChildren = children.filter(c => !(nodeData.groupId && c.groupId === nodeData.groupId));

        if (children.length === 0) {
            nodeData.subtreeWidth = nodeWidth;
            return nodeData.subtreeWidth;
        }

        if (groupedChildren.length > 0) {
            // Group Lineage Logic: Create a main column for the group
            let groupedWidth = 0;
            groupedChildren.forEach((child, index) => {
                groupedWidth += calculateSubtreeMetrics(child);
                if (index < groupedChildren.length - 1) groupedWidth += HORIZONTAL_GAP;
            });

            let otherWidth = 0;
            otherChildren.forEach((child, index) => {
                otherWidth += calculateSubtreeMetrics(child);
                if (index < otherChildren.length - 1) otherWidth += HORIZONTAL_GAP;
            });

            // The main column must accommodate the widest grouped node
            let mainColumnWidth = Math.max(nodeWidth, groupedWidth);
            nodeData.mainColumnWidth = mainColumnWidth;

            // Total lane width pushes ungrouped children safely to the right
            nodeData.subtreeWidth = mainColumnWidth + (otherWidth > 0 ? HORIZONTAL_GAP + otherWidth : 0);
            nodeData.isGroupColumn = true;
        } else {
            // Standard Logic: Treat all children equally
            let childrenTotalWidth = 0;
            children.forEach((child, index) => {
                childrenTotalWidth += calculateSubtreeMetrics(child);
                if (index < children.length - 1) childrenTotalWidth += HORIZONTAL_GAP;
            });

            nodeData.subtreeWidth = Math.max(nodeWidth, childrenTotalWidth);
            nodeData.isGroupColumn = false;
        }

        return nodeData.subtreeWidth;
    }

    // PASS 2: Place nodes inside their designated lanes
    function placeSubtree(nodeData, startX, currentY) {
        const children = childrenMap[nodeData.id] || [];

        if (nodeData.isGroupColumn) {
            // Group logic: Parent centers strictly over the main column, other branches push right
            nodeData.x = startX + (nodeData.mainColumnWidth / 2) - (nodeData.nodeWidth / 2);
            nodeData.y = currentY;

            let groupedChildren = children.filter(c => nodeData.groupId && c.groupId === nodeData.groupId);
            let otherChildren = children.filter(c => !(nodeData.groupId && c.groupId === nodeData.groupId));

            // Place grouped children directly underneath
            let currentGroupedX = startX;
            groupedChildren.forEach(child => {
                let tightDrop = nodeData.nodeHeight + 20;
                placeSubtree(child, currentGroupedX, currentY + tightDrop);
                currentGroupedX += child.subtreeWidth + HORIZONTAL_GAP;
            });

            // Forcibly push ungrouped children right of the main column's bounding box
            let currentOtherX = startX + nodeData.mainColumnWidth + HORIZONTAL_GAP;
            otherChildren.forEach(child => {
                let standardDrop = nodeData.nodeHeight + (GRID_SIZE * 3);
                placeSubtree(child, currentOtherX, currentY + standardDrop);
                currentOtherX += child.subtreeWidth + HORIZONTAL_GAP;
            });

        } else {
            // Standard logic: Parent centers over ALL children
            nodeData.x = startX + (nodeData.subtreeWidth / 2) - (nodeData.nodeWidth / 2);
            nodeData.y = currentY;

            let childrenTotalWidth = 0;
            children.forEach((c, index) => {
                childrenTotalWidth += c.subtreeWidth;
                if (index < children.length - 1) childrenTotalWidth += HORIZONTAL_GAP;
            });

            let currentChildX = startX + (nodeData.subtreeWidth / 2) - (childrenTotalWidth / 2);

            children.forEach(child => {
                let standardDrop = nodeData.nodeHeight + (GRID_SIZE * 3);
                placeSubtree(child, currentChildX, currentY + standardDrop);
                currentChildX += child.subtreeWidth + HORIZONTAL_GAP;
            });
        }
    }

    // 1. PRE-PASS: Toggle CSS classes so DOM heights update instantly
    nodes.forEach(n => {
        const el = document.getElementById(n.id);
        if (el) {
            if (n.isCollapsed) {
                el.classList.add('collapsed-node');
            } else {
                el.classList.remove('collapsed-node');
            }
        }
    });

    // Execute the 2-pass engine for every root on the canvas
    roots.forEach(root => {
        calculateSubtreeMetrics(root);
        placeSubtree(root, currentRootX, 200);
        currentRootX += root.subtreeWidth + HORIZONTAL_GAP;
    });

    // Apply the newly calculated transforms
    nodes.forEach(nodeData => {
        const el = document.getElementById(nodeData.id);
        if (el) {
            el.style.zIndex = '10';
            el.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';

            if (nodeData.groupId && groups[nodeData.groupId]?.isCollapsed) {
                // Nodes must remain visible when collapsed so we can read the summary
                el.style.opacity = '1';
                el.style.pointerEvents = 'auto';
            } else {
                el.style.opacity = '1';
                el.style.pointerEvents = 'auto';
            }

            el.style.transform = `translate(${nodeData.x}px, ${nodeData.y}px)`;
            setTimeout(() => el.style.transition = 'none', 400);
        }
    });

    // Animate the cables dynamically
    let startTimestamp = null;
    function animateEdges(timestamp) {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = timestamp - startTimestamp;

        drawEdges();
        drawGroups();

        if (progress < 400) {
            requestAnimationFrame(animateEdges);
        } else {
            drawEdges();
            drawGroups();
        }
    }
    requestAnimationFrame(animateEdges);
    saveState();
}

async function triggerSummarize(groupId) {
    const group = groups[groupId];
    if (!group) return;

    const groupNodes = nodes.filter(n => n.groupId === groupId);
    let rawText = "";
    groupNodes.forEach((n, idx) => {
        rawText += `[NODE_${idx}]\nUser: ${n.userText}\nAI: ${n.aiText}\n\n`;
    });

    const btn = document.querySelector(`#box_${groupId} .summarize-btn`);
    if (btn) btn.textContent = "⏳ Summarizing...";

    const payload = {
        messages: [
            { role: "system", content: "You are a quick and precise summarizer. The user will provide a conversation segment broken into distinct [NODE_X] parts. For EACH node, write a summary as concise as possible without it lossing its meaning. You MUST separate each summary with the exact string '|||'. Do not include the node labels in your output. [System Reminder] Do not overthink, immediately stop thinking after you arrive at an answer. [End System Reminder]" },
            { role: "user", content: rawText }
        ],
        max_tokens: 500
    };

    try {
        const response = await fetch('http://127.0.0.1:5000/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let summary = "";
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const deltaObj = JSON.parse(line);
                    if (deltaObj.content) {
                        summary += deltaObj.content;
                    } else if (deltaObj.reasoning_content && btn && summary === "") {
                        btn.textContent = "⏳ Thinking...";
                    }
                } catch (e) {
                    console.error("Summarize parse error:", e, line);
                }
            }
        }

        // Split the output and assign it to individual nodes
        const summaries = summary.split('|||').map(s => s.trim()).filter(s => s);
        groupNodes.forEach((n, idx) => {
            n.summaryText = summaries[idx] || "Summary unavailable.";
            n.isCollapsed = true;
            const el = document.getElementById(n.id);
            if (el) {
                const sumEl = el.querySelector('.node-summary-display');
                if (sumEl) sumEl.textContent = n.summaryText;

                const toggleBtn = el.querySelector('.toggle-btn');
                if (toggleBtn) {
                    toggleBtn.style.display = 'inline-block';
                    toggleBtn.textContent = '🔍';
                }
            }
        });

        group.isCollapsed = true;

        updateThermometer(activeNodeId);

    } catch (e) {
        console.error("Summarize failed:", e);
        if (btn) btn.textContent = "❌ Error";
    }
}

function toggleGroupState(groupId) {
    const group = groups[groupId];
    group.isCollapsed = !group.isCollapsed;

    nodes.forEach(n => {
        if (n.groupId === groupId) {
            n.isCollapsed = group.isCollapsed;
            const el = document.getElementById(n.id);
            if (el) {
                const btn = el.querySelector('.toggle-btn');
                if (btn) btn.textContent = n.isCollapsed ? '🔍' : '📂';
            }
        }
    });


    drawGroups();
    updateThermometer(activeNodeId);
}

function toggleNodeState(nodeId) {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    node.isCollapsed = !node.isCollapsed;

    const el = document.getElementById(nodeId);
    if (el) {
        const btn = el.querySelector('.toggle-btn');
        if (btn) btn.textContent = node.isCollapsed ? '🔍' : '📂';
    }


    drawGroups();
    updateThermometer(activeNodeId);
}

async function triggerSingleSummarize(nodeId) {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    let rawText = `User: ${node.userText}\nAI: ${node.aiText}`;

    const el = document.getElementById(node.id);
    if (el) {
        const sumEl = el.querySelector('.node-summary-display');
        if (sumEl) {
            sumEl.style.display = 'block';
            sumEl.textContent = "⏳ Summarizing...";
        }
    }

    const payload = {
        messages: [
            { role: "system", content: "You are a quick and precise summarizer. Write a summary as concise as possible without it lossing the meaning of the conversation segment. Do NOT include formatting, tags, or labels. [System Reminder] Do not overthink, immediately stop thinking after you arrive at an answer. [End System Reminder]" },
            { role: "user", content: rawText }
        ],
        max_tokens: 150
    };

    try {
        const response = await fetch('http://127.0.0.1:5000/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let summary = "";
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const deltaObj = JSON.parse(line);
                    if (deltaObj.content) {
                        summary += deltaObj.content;
                        if (sumEl) sumEl.textContent = summary;
                    } else if (deltaObj.reasoning_content && sumEl && summary === "") {
                        sumEl.textContent = "⏳ Thinking...";
                    }
                } catch (e) {
                    console.error("Summarize parse error:", e, line);
                }
            }
        }

        node.summaryText = summary.trim() || "Summary unavailable.";
        node.isCollapsed = true;

        if (el) {
            const sumEl = el.querySelector('.node-summary-display');
            if (sumEl) {
                sumEl.textContent = node.summaryText;
                sumEl.style.display = ''; // Reset, let .collapsed-node CSS handle it
            }
            const toggleBtn = el.querySelector('.toggle-btn');
            if (toggleBtn) {
                toggleBtn.style.display = 'inline-block';
                toggleBtn.textContent = '📂';
            }
        }


        drawGroups();
        updateThermometer(activeNodeId);
        saveState();

    } catch (e) {
        console.error("Single Summarize failed:", e);
        if (el) {
            const sumEl = el.querySelector('.node-summary-display');
            if (sumEl) sumEl.textContent = "❌ Error";
        }
    }
}

window.addEventListener('contextmenu', (e) => {
    // Let the default right-click menu work if clicking inside the text editor
    if (e.target.closest('.node-input')) return;

    // Only show canvas right-click menu if clicking inside the viewport
    if (!e.target.closest('#viewport')) return;

    const nodeEl = e.target.closest('.node');
    if (nodeEl) {
        e.preventDefault();
        targetNodeIdForMenu = nodeEl.id;

        const nodeData = nodes.find(n => n.id === targetNodeIdForMenu);
        const groupItem = document.getElementById('menu-group');
        const ungroupItem = document.getElementById('menu-ungroup');

        if (selectedNodes.size > 1) {
            groupItem.style.opacity = '1';
            groupItem.style.pointerEvents = 'auto';
        } else {
            groupItem.style.opacity = '0.4';
            groupItem.style.pointerEvents = 'none';
        }

        if (nodeData && nodeData.groupId) {
            ungroupItem.style.opacity = '1';
            ungroupItem.style.pointerEvents = 'auto';
        } else {
            ungroupItem.style.opacity = '0.4';
            ungroupItem.style.pointerEvents = 'none';
        }

        document.getElementById('menu-add-node').style.display = 'none';
        document.getElementById('menu-add-image').style.display = 'none';
        document.getElementById('menu-add-file').style.display = 'none';
        document.getElementById('menu-rename').style.display = 'block';
        document.getElementById('menu-group').style.display = 'block';
        document.getElementById('menu-ungroup').style.display = 'block';
        document.getElementById('menu-summarize').style.display = 'block';

        contextMenu.style.display = 'block';
        contextMenu.style.left = `${e.clientX}px`;
        contextMenu.style.top = `${e.clientY}px`;
    } else {
        e.preventDefault();
        targetNodeIdForMenu = null;
        document.getElementById('menu-add-node').style.display = 'block';
        document.getElementById('menu-add-image').style.display = 'block';
        document.getElementById('menu-add-file').style.display = 'block';
        document.getElementById('menu-rename').style.display = 'none';
        document.getElementById('menu-group').style.display = 'none';
        document.getElementById('menu-ungroup').style.display = 'none';
        document.getElementById('menu-summarize').style.display = 'none';

        const rect = viewport.getBoundingClientRect();
        contextMenu.dataset.clickX = (e.clientX - rect.left - camera.x) / camera.zoom;
        contextMenu.dataset.clickY = (e.clientY - rect.top - camera.y) / camera.zoom;

        contextMenu.style.display = 'block';
        contextMenu.style.left = `${e.clientX}px`;
        contextMenu.style.top = `${e.clientY}px`;
    }
});

$('menu-add-node').addEventListener('click', () => {
    contextMenu.style.display = 'none';
    const x = parseFloat(contextMenu.dataset.clickX || camera.x + 100);
    const y = parseFloat(contextMenu.dataset.clickY || camera.y + 100);
    createNode(null, x, y, '', 1, 0, 'New_Node', null, 'chat');
});

$('menu-add-image').addEventListener('click', () => {
    contextMenu.style.display = 'none';
    const x = parseFloat(contextMenu.dataset.clickX || camera.x + 100);
    const y = parseFloat(contextMenu.dataset.clickY || camera.y + 100);
    createNode(null, x, y, '', 1, 0, 'Image_Node', null, 'image');
});

$('menu-add-file').addEventListener('click', () => {
    contextMenu.style.display = 'none';
    const x = parseFloat(contextMenu.dataset.clickX || camera.x + 100);
    const y = parseFloat(contextMenu.dataset.clickY || camera.y + 100);
    createNode(null, x, y, '', 1, 0, 'Document_Node', null, 'document');
});

window.addEventListener('click', (e) => {
    if (!e.target.closest('#context-menu')) {
        contextMenu.style.display = 'none';
    }
});

$('menu-summarize').addEventListener('click', () => {
    contextMenu.style.display = 'none';
    if (targetNodeIdForMenu) {
        triggerSingleSummarize(targetNodeIdForMenu);
    }
});

$('menu-rename').addEventListener('click', () => {
    contextMenu.style.display = 'none';
    if (!targetNodeIdForMenu) return;

    const newName = prompt("Enter new base name for this branch (e.g., Code_Refactor):");
    if (!newName || newName.trim() === "") return;

    // Format the name cleanly
    const safeName = newName.trim().replace(/\s+/g, '_');

    // The getDescendants function naturally returns top-down order, 
    // which is perfect because we must rename parents before children.
    const nodesToUpdate = [targetNodeIdForMenu, ...getDescendants(targetNodeIdForMenu)];
    const idMap = {}; // Tracks { oldId: newId } so we can rewire cables

    nodesToUpdate.forEach(oldId => {
        const nodeData = nodes.find(n => n.id === oldId);
        if (!nodeData) return;

        nodeData.name = safeName;

        // If its parent just got a new ID in a previous loop iteration, update it
        if (idMap[nodeData.parentId]) {
            nodeData.parentId = idMap[nodeData.parentId];
        }

        // Temporarily clear its ID so idfy doesn't trip on itself, then generate the new one
        nodeData.id = undefined;
        const newId = idfy(nodeData);

        idMap[oldId] = newId;
        nodeData.id = newId;

        // Update DOM element ID and visual label
        const el = document.getElementById(oldId);
        if (el) {
            el.id = newId;
            const idLabel = el.querySelector('.node-id');
            if (idLabel) {
                idLabel.textContent = newId;
                idLabel.setAttribute('onclick', `copy_text('${newId}')`);
            }
        }
    });

    // 4. Global Reference Sweeper
    // Go through every node on the canvas and update yellow cables if they reference the old IDs
    nodes.forEach(node => {
        let changed = false;

        // Update the internal reference array
        node.references = node.references.map(ref => {
            if (idMap[ref]) {
                changed = true;
                return idMap[ref];
            }
            return ref;
        });

        if (changed) {
            const nodeEl = document.getElementById(node.id);
            if (nodeEl) {
                // Find physical DOM chips and update their payload/attributes
                const chips = nodeEl.querySelectorAll('.reference-node');
                chips.forEach(chip => {
                    const oldRef = chip.getAttribute('data-ref');
                    if (idMap[oldRef]) {
                        chip.setAttribute('data-ref', idMap[oldRef]);
                        chip.setAttribute('data-id', `@${idMap[oldRef]}`);

                        // Fix the hidden payload string
                        const hiddenSpan = chip.querySelector('.ref-text');
                        if (hiddenSpan) {
                            hiddenSpan.textContent = hiddenSpan.textContent.replace(oldRef, idMap[oldRef]);
                        }
                    }
                });
            }
        }
    });

    // Clean up UI state
    drawEdges();
    if (activeNodeId && idMap[activeNodeId]) {
        selectNode(idMap[activeNodeId]);
    }
});

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

$('menu-group').addEventListener('click', () => {
    contextMenu.style.display = 'none';
    if (selectedNodes.size < 2) {
        alert("Shift-click to select multiple nodes in a lineage first.");
        return;
    }

    const groupName = prompt("Enter a name for this group (e.g., 'Debugging TTS'):", "Group");
    if (!groupName) return;

    // Generate a unique ID for the group wrapper
    const groupId = 'group_' + Date.now();

    // Create the group metadata
    groups[groupId] = {
        id: groupId,
        name: groupName,
        nodes: Array.from(selectedNodes) // Store the IDs of nodes in this group
    };

    // Assign the group ID to the individual node objects in your main array
    selectedNodes.forEach(id => {
        const nodeData = nodes.find(n => n.id === id);
        if (nodeData) nodeData.groupId = groupId;
    });

    // console.log("Group created:", groups[groupId]);

    // Clear selection state visually
    selectedNodes.clear();
    selectNode(activeNodeId);

});

$('menu-ungroup').addEventListener('click', () => {
    contextMenu.style.display = 'none';
    if (!targetNodeIdForMenu) return;

    const nodeData = nodes.find(n => n.id === targetNodeIdForMenu);
    if (!nodeData || !nodeData.groupId) return;

    const groupId = nodeData.groupId;

    // Strip the groupId from all nodes that belonged to it
    nodes.forEach(n => {
        if (n.groupId === groupId) delete n.groupId;
    });


    delete groups[groupId];
});

function drawGroups() {
    let groupsLayer = $('groups-layer');
    if (!groupsLayer) {
        groupsLayer = document.createElement('div');
        groupsLayer.id = 'groups-layer';
        nodesLayer.prepend(groupsLayer);
    }
    groupsLayer.innerHTML = '';

    Object.values(groups).forEach(group => {
        const groupNodes = nodes.filter(n => n.groupId === group.id);
        if (groupNodes.length === 0) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        groupNodes.forEach(n => {
            const el = document.getElementById(n.id);
            if (!el) return;
            const width = el.offsetWidth || 380;
            const height = el.offsetHeight || 200;

            minX = Math.min(minX, n.x);
            minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x + width);
            maxY = Math.max(maxY, n.y + height);
        });

        const padding = 24;
        const box = document.createElement('div');
        box.className = 'group-container';
        box.id = `box_${group.id}`;

        box.style.left = `${minX - padding}px`;
        box.style.top = `${minY - padding}px`;
        box.style.width = `${(maxX - minX) + (padding * 2)}px`;
        box.style.height = `${(maxY - minY) + (padding * 2)}px`;
        box.style.background = 'rgba(30, 30, 46, 0.6)'; // Always transparent now

        const hasSummary = groupNodes.some(n => n.summaryText && n.summaryText !== "Summary unavailable.");

        let btnHtml = '';
        if (group.isCollapsed) {
            btnHtml = `<button class="summarize-btn" onclick="toggleGroupState('${group.id}')">🔍 Expand</button>`;
        } else if (hasSummary) {
            btnHtml = `
                <button class="summarize-btn" onclick="toggleGroupState('${group.id}')">📂 Collapse</button>
                <button class="summarize-btn" onclick="triggerSummarize('${group.id}')">🔄 Re-Summarize</button>
            `;
        } else {
            btnHtml = `<button class="summarize-btn" onclick="triggerSummarize('${group.id}')">✨ Summarize</button>`;
        }

        box.innerHTML = `
            <div class="group-header">
                📦 <span class="node-id" style="cursor:copy;" title="Shift+Click to insert reference" onmousedown="if(event.shiftKey) event.preventDefault();" onclick="handleIdClick(event, '${group.id}', true)">${group.name}</span>
                ${btnHtml}
            </div>
        `;
        groupsLayer.appendChild(box);
    });
}

const nodeResizeObserver = new ResizeObserver(() => {
    clearTimeout(layoutDebounceTimeout);
    layoutDebounceTimeout = setTimeout(() => {
        drawEdges();
        drawGroups();
    }, 30);
});

async function saveState() {
    // Capture live HTML from inputs to preserve visual @reference chips
    nodes.forEach(n => {
        const el = document.getElementById(n.id);
        if (el) {
            const textarea = el.querySelector('.node-input');
            if (textarea) n.htmlText = textarea.innerHTML;
            n.nodeWidth = el.offsetWidth;
        }
    });

    const state = {
        nodes: nodes,
        groups: groups,
        camera: camera,
        activeNodeId: activeNodeId,
        forkOffsetCounter: forkOffsetCounter
    };

    try {
        await fetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: state })
        });
    } catch (e) {
        console.error("SQLite save failed:", e);
    }
}

async function loadState() {
    try {
        const response = await fetch('/api/load');
        const data = await response.json();

        if (data.status === 'empty' || !data.state || !data.state.nodes || data.state.nodes.length === 0) {
            return false;
        }

        const state = data.state;

        // Reset current memory variables
        nodes = [];
        groups = state.groups || {};
        camera = state.camera || { x: 0, y: 0, zoom: 1 };
        activeNodeId = state.activeNodeId || null;
        forkOffsetCounter = state.forkOffsetCounter || 0;

        // Wipe canvas elements before reconstruction
        nodesLayer.querySelectorAll('.node').forEach(el => el.remove());
        let groupsLayer = $('groups-layer');
        if (groupsLayer) groupsLayer.innerHTML = '';

        // Restore each node
        state.nodes.forEach(savedNode => {
            if (savedNode.isVirtual) {
                virtualFileNodes[savedNode.id] = savedNode;
                nodes.push(savedNode);
            } else {
                // Pass the saved object as the 8th parameter to createNode
                createNode(null, null, null, null, null, null, null, savedNode);
            }
        });

        updateCanvas();

        if (activeNodeId) selectNode(activeNodeId);
        return true;
    } catch (e) {
        console.error("SQLite load failed:", e);
        return false;
    }
}

async function wipeState() {
    if (confirm("Are you sure you want to delete all saved nodes and start fresh?")) {
        await fetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: { nodes: [] } })
        });
        location.reload();
    }
}

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
updateCanvas();
window.addEventListener('DOMContentLoaded', async () => {


    fetchSandboxFiles();
    const loaded = await loadState();
    if (!loaded) {
        createNode();
    }
});

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// SANDBOX SIDEBAR
let virtualFileNodes = {};

async function fetchSandboxFiles() {
    const res = await fetch('/api/sandbox/files');
    if (!res.ok) return;
    const data = await res.json();
    const tree = document.getElementById('file-tree');
    if (!tree) return;

    tree.innerHTML = '';
    data.files.forEach(filepath => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.textContent = '📄 ' + filepath;
        item.title = 'Click to open in new tab. Shift+Click to reference in focused node.';

        item.addEventListener('mousedown', (e) => {
            if (e.shiftKey) {
                e.preventDefault(); // Prevents focus loss from text editor
            }
        });

        item.addEventListener('click', (e) => {
            if (e.shiftKey) {
                e.preventDefault();
                handleSandboxFileShiftClick(filepath);
            } else {
                window.open('/sandbox/' + filepath, '_blank');
            }
        });

        tree.appendChild(item);
    });
}

async function uploadSandboxFiles(event) {
    const files = event.target.files;
    if (!files.length) return;

    const formData = new FormData();
    for (let file of files) {
        formData.append('files', file);
    }

    const res = await fetch('/api/sandbox/upload', {
        method: 'POST',
        body: formData
    });

    if (res.ok) {
        fetchSandboxFiles();
    } else {
        alert('Upload failed!');
    }
    // Reset so same file can be uploaded again if needed
    event.target.value = '';
}

async function handleSandboxFileShiftClick(filepath) {
    if (!lastFocusedInput) {
        alert('Please focus on a text input box first by clicking it!');
        return;
    }

    const isImage = filepath.match(/\.(png|jpg|jpeg|gif|webp)$/i);
    const virtualId = 'sandbox/' + filepath;

    if (!virtualFileNodes[virtualId]) {
        const res = await fetch('/sandbox/' + filepath);
        if (!res.ok) {
            alert('Failed to load file content.');
            return;
        }

        let payload = null;
        let type = 'document';

        if (isImage) {
            type = 'image';
            const blob = await res.blob();
            payload = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            });
        } else {
            type = 'document';
            payload = await res.text();
        }

        const nodeData = {
            id: virtualId,
            type: type,
            filePayload: payload,
            fileName: filepath,
            userText: '',
            htmlText: '',
            aiText: ' ',
            aiThinking: '',
            references: [],
            hasChild: false,
            isCollapsed: false,
            isVirtual: true
        };
        virtualFileNodes[virtualId] = nodeData;

        // Check if it already exists in nodes before pushing (for hot reloading)
        if (!nodes.find(n => n.id === virtualId)) {
            nodes.push(nodeData);
        }
    }

    const selection = window.getSelection();
    let range;

    if (selection.rangeCount > 0 && lastFocusedInput.contains(selection.getRangeAt(0).commonAncestorContainer)) {
        range = selection.getRangeAt(0);
    } else {
        // If they clicked away, append to the end of the text box
        range = document.createRange();
        range.selectNodeContents(lastFocusedInput);
        range.collapse(false);
    }

    insertChipAtRange(lastFocusedInput, range, virtualId, false);
}

// Sidebar Toggle and Resizer
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const resizer = document.getElementById('sidebar-resizer');
    sidebar.classList.toggle('hidden');
    const isHidden = sidebar.classList.contains('hidden');
    if (isHidden) {
        resizer.style.display = 'none';
    } else {
        resizer.style.display = 'block';
    }
    localStorage.setItem('sidebarHidden', isHidden);
    // Re-draw edges because layout changed
    requestAnimationFrame(() => drawEdges());
}

window.addEventListener('DOMContentLoaded', () => {
    const resizer = document.getElementById('sidebar-resizer');
    const sidebar = document.getElementById('sidebar');
    let isResizingSidebar = false;

    // Restore saved state
    const savedHidden = localStorage.getItem('sidebarHidden');
    if (savedHidden === 'true') {
        sidebar.classList.add('hidden');
        resizer.style.display = 'none';
    }
    const savedWidth = localStorage.getItem('sidebarWidth');
    if (savedWidth) {
        sidebar.style.width = savedWidth;
    }

    resizer.addEventListener('mousedown', (e) => {
        isResizingSidebar = true;
        resizer.classList.add('resizing');
        document.body.style.cursor = 'ew-resize';
    });

    window.addEventListener('mousemove', (e) => {
        if (!isResizingSidebar) return;

        let newWidth = e.clientX;
        // Clamp width between 150px and 600px
        if (newWidth < 150) newWidth = 150;
        if (newWidth > 600) newWidth = 600;

        sidebar.style.width = newWidth + 'px';
        localStorage.setItem('sidebarWidth', sidebar.style.width);
        drawEdges(); // Live update SVG connections
    });

    window.addEventListener('mouseup', () => {
        if (isResizingSidebar) {
            isResizingSidebar = false;
            resizer.classList.remove('resizing');
            document.body.style.cursor = 'default';
        }
    });
});
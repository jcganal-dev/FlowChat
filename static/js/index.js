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

contextMenu.id = 'context-menu';
contextMenu.innerHTML = `
    <div class="context-item" id="menu-rename">✏️ Rename Branch</div>
    <div class="context-item" id="menu-group">📦 Group Selected Nodes</div>
    <div class="context-item" id="menu-ungroup">🔓 Ungroup Node</div>
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

    const mouseX = e.clientX;
    const mouseY = e.clientY;
    camera.x = mouseX - (mouseX - camera.x) * (newZoom / camera.zoom);
    camera.y = mouseY - (mouseY - camera.y) * (newZoom / camera.zoom);
    camera.zoom = newZoom;

    updateCanvas();
}, { passive: false });


///////////////////////////////////////////////////////////////////////////////



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

function createNode(parentId = null, x = 408, y = 216, initialUserText = "", turn = 1, branch = 0, name = "Master_Node", restoreData = null) {

    let nodeData;
    let id;

    if (restoreData) {
        nodeData = restoreData;
        id = nodeData.id;
        nodeData.abortController = null; // Cannot serialize AbortControllers
        if (erase_thoughts && nodeData.aiText) nodeData.aiThinking = "";
        nodes.push(nodeData);
    } else {
        nodeData = {
            id: undefined,
            userText: initialUserText,
            htmlText: initialUserText,
            aiText: "",
            aiThinking: "",
            parentId, x, y,
            muted: false,
            references: [],
            turn: turn, branch: branch,
            name: name, hasChild: false,
            abortController: null
        };
        id = idfy(nodeData);
        nodeData.id = id;
        nodes.push(nodeData);
    }

    const isCollapsed = nodeData.groupId && groups[nodeData.groupId]?.isCollapsed;
    const el = document.createElement('div');

    // Restore CSS classes and inline styles
    el.className = `node turn-node ${isCollapsed ? 'collapsed-node' : ''}`;
    if (nodeData.muted) el.classList.add('muted-node');
    el.id = id;
    el.style.transform = `translate(${nodeData.x}px, ${nodeData.y}px)`;
    if (nodeData.nodeWidth) el.style.width = `${nodeData.nodeWidth}px`;

    // Restore visual UI states
    const runStyle = nodeData.aiText || nodeData.aiThinking ? 'display: none;' : '';
    const inputContent = restoreData ? (nodeData.htmlText || nodeData.userText) : initialUserText;
    const isEditable = restoreData && nodeData.aiText ? 'false' : 'true';

    el.innerHTML = `
        <div class="handle handle-in ${nodeData.parentId ? '' : 'hidden'}"></div>
        <div class="node-header">
            <span class="node-id" onclick="copy_text('${id}')">${id}</span>
            <div>
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
            <div class="think-content" style="${nodeData.aiThinking ? 'display:flex;' : 'display:none;'}">${nodeData.aiThinking}</div>
            <div class="ai-content">${nodeData.aiText}</div>
        </div>
        <div class="node-summary-display">${nodeData.summaryText || ''}</div>
        <div class="handle handle-out"></div>
        <button class="add-child-btn" title="Branch">+</button>
        <div class="resize-handle"></div>
    `;

    setTimeout(() => {
        const runBtn = el.querySelector('.run-btn');
        const textarea = el.querySelector('.node-input');
        const addBtn = el.querySelector('.add-child-btn');
        const dupBtn = el.querySelector('.duplicate-btn');
        const stopBtn = el.querySelector('.stop-btn');
        const deleteBtn = el.querySelector('.delete-btn');
        const resizer = el.querySelector('.resize-handle');

        resizer.addEventListener('mousedown', (e) => {
            e.stopPropagation(); // Prevent canvas panning

            const startX = e.clientX;
            const startWidth = el.offsetWidth;

            function onMouseMove(moveEvent) {
                // Calculate distance moved and scale it by camera zoom
                const deltaX = (moveEvent.clientX - startX) / camera.zoom;
                el.style.width = `${Math.max(300, startWidth + deltaX)}px`;

                // Fire autoLayout smoothly so sibling nodes push out of the way
                clearTimeout(layoutDebounceTimeout);
                layoutDebounceTimeout = setTimeout(() => autoLayout(), 15);
            }

            function onMouseUp() {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                autoLayout(); // Final snap to ensure perfect alignment
            }

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });

        // if (!initialUserText) textarea.focus();

        stopBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const data = nodes.find(n => n.id === el.id);
            if (data && data.abortController) {
                data.abortController.abort();
            }
        });

        runBtn.addEventListener('click', () => runUserNode(el.id));

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

                // Only parse if we are typing in a raw text node
                if (textNode.nodeType === Node.TEXT_NODE) {
                    const text = textNode.textContent;
                    const cursorOffset = range.startOffset;

                    // 1. Extract the text strictly up to the blinking cursor
                    const textBeforeCursor = text.slice(0, cursorOffset);
                    const textAfterCursor = text.slice(cursorOffset);

                    // 2. Check if the text right before the cursor ends with a tag + space
                    const refRegex = /@([\w()-]+)\s$/;
                    const match = textBeforeCursor.match(refRegex);

                    if (match) {
                        const refId = match[1];
                        const refData = nodes.find(n => n.id === refId);

                        if (refData && refId !== el.id && refData['aiText'].trim() !== '') {
                            const refText = `USER: ${refData.userText} \n Assistant: ${refData.aiText}`;

                            // 3. Keep the original text BEFORE the @ symbol in the current node
                            textNode.textContent = textBeforeCursor.slice(0, match.index);

                            // 4. Create the visual chip
                            const chip = document.createElement('span');
                            chip.className = 'reference-node';
                            chip.contentEditable = 'false';
                            chip.setAttribute('data-id', `@${refId}`);
                            chip.setAttribute('data-ref', refId);

                            // 5. Insert the hidden context payload
                            const hiddenText = document.createElement('span');
                            hiddenText.className = 'ref-text';
                            hiddenText.textContent = `\n\n[START CONTEXT FROM ${refId}]:\n${refText}\n[END CONTEXT]\n\n`;
                            chip.appendChild(hiddenText);

                            // 6. Create a NEW text node containing a space + any text that was originally AFTER the cursor
                            const afterTextNode = document.createTextNode('\u00A0' + textAfterCursor);

                            // 7. Stitch it all together in the DOM
                            if (textNode.nextSibling) {
                                textNode.parentNode.insertBefore(chip, textNode.nextSibling);
                                textNode.parentNode.insertBefore(afterTextNode, chip.nextSibling);
                            } else {
                                textNode.parentNode.appendChild(chip);
                                textNode.parentNode.appendChild(afterTextNode);
                            }

                            // 8. Place the blinking cursor perfectly inside the new text node, right after the space
                            range.setStart(afterTextNode, 1);
                            range.setEnd(afterTextNode, 1);
                            selection.removeAllRanges();
                            selection.addRange(range);

                            // 9. Trigger a scan to draw the yellow reference cable instantly
                            textarea.dispatchEvent(new Event('input'));
                        }
                    }
                }
            }
        });

        textarea.addEventListener('input', () => {
            const nodeData = nodes.find(n => n.id === el.id);
            if (!nodeData) return;
            // Find all chips currently inside this specific textarea
            const chips = Array.from(textarea.querySelectorAll('.reference-node'));
            nodeData.references = chips.map(chip => chip.getAttribute('data-ref'));
            drawEdges(); // Instantly draw or remove cables based on DOM state
        });

        // Branch down (Next turn in conversation)
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            forkOffsetCounter += 1;

            const data = nodes.find(n => n.id === el.id);

            // 1. Calculate the true canvas Y of the node's bottom edge
            const bottomY = data.y + el.offsetHeight;

            // 2. Snap that canvas Y to the nearest grid line
            const snappedBottomY = Math.ceil(bottomY / GRID_SIZE) * GRID_SIZE;

            // 3. Apply your layout spacing
            // Using forkOffsetCounter on X prevents overlapping if you click + multiple times
            const forkX = data.x;
            // const forkX = x + (forkOffsetCounter * 350); 
            const forkY = snappedBottomY + (GRID_SIZE * 3);
            createNode(el.id, forkX, forkY, "", data.hasChild ? turn : turn += 1, data.hasChild ? branch += 1 : branch);
            data.hasChild = true
        });

        // Branch sideways (Duplicate current turn to try again)
        dupBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            forkOffsetCounter += 1;
            const forkX = x + 360;
            createNode(undefined, forkX, y, textarea.innerHTML);
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

    nodesLayer.appendChild(el);

    nodeResizeObserver.observe(el);

    // ONLY trigger layout if creating a single new node, not batch-restoring
    if (!restoreData) {
        setTimeout(() => autoLayout(), 10);
        selectNode(id);
    }
    return id;
} // End of createNode

function drawEdges(activeLineage = new Set()) {
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

        const startX = (pRect.left + pRect.width / 2 - camera.x) / camera.zoom;
        const startY = (pRect.top + pRect.height / 2 - camera.y) / camera.zoom;
        const endX = (cRect.left + cRect.width / 2 - camera.x) / camera.zoom;
        const endY = (cRect.top + cRect.height / 2 - camera.y) / camera.zoom;

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

    // 1. Scan for references using Regex
    const refRegex = /@(node-\d+)/g;
    const refs = [];
    let match;
    while ((match = refRegex.exec(text)) !== null) {
        refs.push(match[1]);
    }
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
        refs.forEach(rId => {
            const rNode = nodes.find(n => n.id === rId);
            if (rNode) {
                systemDirectives += `\nRule: ${rNode.userText}\nStatus: ${rNode.aiText}\n`;
            }
        });

        // Check if a system message already exists at the start
        if (history.length > 0 && history[0].role === 'system') {
            history[0].content += "\n\n" + systemDirectives;
        } else {
            // Unshift puts the system message at the very beginning of the array
            history.unshift({ role: 'system', content: systemDirectives });
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
        autoLayout();
        updateThermometer(nodeId);
    }
}

function walkContext(leafNodeId) {
    const history = [];
    let currentId = leafNodeId;

    while (currentId) {
        const node = nodes.find(n => n.id === currentId);
        if (!node) break;

        if (node.groupId && groups[node.groupId]?.isCollapsed) {
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
        autoLayout();
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
            if (n.groupId && groups[n.groupId]?.isCollapsed) {
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
                el.style.opacity = '0';
                el.style.pointerEvents = 'none';
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
            { role: "system", content: "You are a precise summarizer. The user will provide a conversation segment broken into distinct [NODE_X] parts. For EACH node, write exactly ONE concise sentence summarizing it. You MUST separate each summary with the exact string '|||'. Do not include the node labels in your output." },
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

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const lines = decoder.decode(value, { stream: true }).split('\n');
            for (const line of lines) {
                if (line.startsWith("data: ") && line !== "data: [DONE]") {
                    try {
                        const chunk = JSON.parse(line.slice(6));
                        if (chunk.choices[0].delta.content) {
                            summary += chunk.choices[0].delta.content;
                        }
                    } catch (e) { }
                }
            }
        }

        // Split the output and assign it to individual nodes
        const summaries = summary.split('|||').map(s => s.trim()).filter(s => s);
        groupNodes.forEach((n, idx) => {
            n.summaryText = summaries[idx] || "Summary unavailable.";
            const el = document.getElementById(n.id);
            if (el) {
                const sumEl = el.querySelector('.node-summary-display');
                if (sumEl) sumEl.textContent = n.summaryText;
            }
        });

        group.isCollapsed = true;
        autoLayout();
        updateThermometer(activeNodeId);

    } catch (e) {
        console.error("Summarize failed:", e);
        if (btn) btn.textContent = "❌ Error";
    }
}

function toggleGroupState(groupId) {
    groups[groupId].isCollapsed = false;
    autoLayout();
    updateThermometer(activeNodeId);
}

window.addEventListener('contextmenu', (e) => {
    // Let the default right-click menu work if clicking inside the text editor
    if (e.target.closest('.node-input')) return;

    const nodeEl = e.target.closest('.node');
    if (nodeEl) {
        e.preventDefault();
        targetNodeIdForMenu = nodeEl.id;
        contextMenu.style.display = 'block';
        contextMenu.style.left = `${e.clientX}px`;
        contextMenu.style.top = `${e.clientY}px`;
    } else {
        contextMenu.style.display = 'none';
    }
});

window.addEventListener('click', (e) => {
    if (!e.target.closest('#context-menu')) {
        contextMenu.style.display = 'none';
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
    autoLayout()
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

    autoLayout()
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

        box.innerHTML = `
            <div class="group-header">
                📦 ${group.name}
                <button class="summarize-btn" onclick="${group.isCollapsed ? `toggleGroupState('${group.id}')` : `triggerSummarize('${group.id}')`}">${group.isCollapsed ? '🔍 Expand' : '✨ Summarize'}</button>
            </div>
        `;
        groupsLayer.appendChild(box);
    });
}

const nodeResizeObserver = new ResizeObserver(() => {
    clearTimeout(layoutDebounceTimeout);
    layoutDebounceTimeout = setTimeout(() => {
        // Only trigger layout if we actually have nodes to organize
        if (nodes.length > 0) autoLayout();
    }, 30);
});

function saveState() {
    // Capture live HTML from inputs to preserve visual @reference chips
    nodes.forEach(n => {
        const el = document.getElementById(n.id);
        if (el) {
            const textarea = el.querySelector('.node-input');
            if (textarea) n.htmlText = textarea.innerHTML;
        }
    });

    const state = {
        nodes: nodes,
        groups: groups,
        camera: camera,
        activeNodeId: activeNodeId,
        forkOffsetCounter: forkOffsetCounter
    };
    localStorage.setItem('flowchat_state', JSON.stringify(state));
}

function loadState() {
    const saved = localStorage.getItem('flowchat_state');
    if (!saved) return false;

    try {
        const state = JSON.parse(saved);
        if (!state.nodes || state.nodes.length === 0) return false;

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
            // Pass the saved object as the 8th parameter to createNode
            createNode(null, null, null, null, null, null, null, savedNode);
        });

        updateCanvas();
        autoLayout();
        if (activeNodeId) selectNode(activeNodeId);
        return true;
    } catch (e) {
        console.error("Save state corrupted:", e);
        return false;
    }
}

function wipeState() {
    if (confirm("Are you sure you want to delete all saved nodes and start fresh?")) {
        localStorage.removeItem('flowchat_state');
        location.reload();
    }
}

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
updateCanvas();
window.addEventListener('DOMContentLoaded', () => {
    if (!loadState()) {
        createNode();
    }
});
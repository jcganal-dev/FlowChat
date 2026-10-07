const $ = (id) => document.getElementById(id)
const $make = (tag) => document.createElement(tag)
const erase_thoughts = true
const viewport = $('viewport')
const nodesLayer = $('nodes-layer')
let selectedNodes = new Set();
let camera = { x:0, y:0, zoom: 1}
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

// --- NODE DRAGGING LOGIC ---
// let draggedNode = null;
// let nodeStartX = 0, nodeStartY = 0;

// nodesLayer.addEventListener('mousedown', (e) => {
//     if (e.target.classList.contains('node-header')) {
//         draggedNode = e.target.closest('.node');
        
//         // Extract the current translate(X, Y) from the node's CSS
//         const style = window.getComputedStyle(draggedNode);
//         const matrix = new DOMMatrixReadOnly(style.transform);
        
//         // Calculate mouse offset relative to the node's origin
//         nodeStartX = (e.clientX - camera.x) / camera.zoom - matrix.m41;
//         nodeStartY = (e.clientY - camera.y) / camera.zoom - matrix.m42;
        
//         draggedNode.style.zIndex = 1000; // Bring to front
//     }
// });

// window.addEventListener('mousemove', (e) => {
//     if (draggedNode) {
//         // Calculate the raw target position in canvas coordinates
//         const rawX = (e.clientX - camera.x) / camera.zoom - nodeStartX;
//         const rawY = (e.clientY - camera.y) / camera.zoom - nodeStartY;

//         // Snap coordinates to the nearest grid interval
//         const snappedX = Math.round(rawX / GRID_SIZE) * GRID_SIZE;
//         const snappedY = Math.round(rawY / GRID_SIZE) * GRID_SIZE;

//         draggedNode.style.transform = `translate(${snappedX}px, ${snappedY}px)`;

//         // Update state andd redraw cables
//         const data = nodes.find(n => n.id === draggedNode.id);
//         if (data) { 
//             data.x = snappedX; 
//             data.y = snappedY; 
//             drawEdges(); 
//         }
//     }
// });

// window.addEventListener('mouseup', () => {
//     if (draggedNode) {
//         draggedNode.style.zIndex = '';
//         draggedNode = null;
//     }
// });


///////////////////////////////////////////////////////////////////////////////



function idfy(nodeData) {
    const name = nodeData.name
    const turn = nodeData.turn
    const branch = nodeData.branch
    let new_id = undefined
    let dupe_count = 0
    do {
        new_id = `${name}${dupe_count>0?'('+dupe_count+')':''}_turn-${turn}${branch>0?'_branch-'+branch:''}`
        dupe_count += 1
    } while (nodes.find(n => n.id === new_id))
    return new_id
}

function createNode(parentId=null, x=408, y=216, initialUserText = "", turn = 1, branch = 0, name="Master_Node") {

    // Data Model now holds both halves of the turn
    const nodeData = { 
        id:undefined, 
        userText: initialUserText, 
        aiText: "", 
        aiThinking: "", 
        parentId, 
        x, 
        y,
        muted: false,
        references: [],
        turn:turn,
        branch:branch,
        name:name,
        hasChild:false
    };

    const id = idfy(nodeData)
    nodeData.id = id

    nodes.push(nodeData);

    const el = document.createElement('div');
    el.className = `node turn-node`;
    el.id = id;
    el.style.transform = `translate(${x}px, ${y}px)`;
    
    el.innerHTML = `
        <div class="handle handle-in hidden"></div>
        <div class="node-header">
            <span class="node-id" onclick="copy_text('${id}')">${id}</span>
            <div>
                <a class="duplicate-btn" title="Duplicate Branch">📄</a>
                <a class="delete-btn" title="Delete (Shift+Click to delete branch)">✖</a>
            </div>
        </div>
        <div class="user-section">
            <div contenteditable="true" class="node-input" spellcheck="true" placeholder="Type prompt here...">${initialUserText}</div>
            <div class="button-row">
                <button class="run-btn">Run ➔</button>
            </div>
        </div>
        <div class="ai-section">
            <div class="think-content" style="display: none;"></div>
            <div class="ai-content"></div>
        </div>
        <div class="handle handle-out"></div>
        <button class="add-child-btn" title="Branch">+</button>
    `;
    if (nodeData.parentId) el.querySelector('.handle-in').classList.remove('hidden')
    setTimeout(() => {
        const runBtn = el.querySelector('.run-btn');
        const textarea = el.querySelector('.node-input');
        const addBtn = el.querySelector('.add-child-btn');
        const dupBtn = el.querySelector('.duplicate-btn');
        const deleteBtn = el.querySelector('.delete-btn');

        // if (!initialUserText) textarea.focus();

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
            createNode(el.id, forkX, forkY, "", data.hasChild?turn:turn+=1, data.hasChild?branch+=1:branch);
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
    // drawEdges();
    setTimeout(() => autoLayout(), 10);
    selectNode(id); 
    return id;
}

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
    
    // 2. Lock UI
    const aiContentEl = nodeEl.querySelector('.ai-content');
    const aiThinkEl = nodeEl.querySelector('.think-content');
    const runBtn = nodeEl.querySelector('.run-btn');
    
    aiContentEl.innerHTML = '';
    aiThinkEl.innerHTML = "";
    aiThinkEl.style.display = "none";
    textarea.contentEditable = false;
    runBtn.disabled = true;

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
    try {
        const response = await fetch('http://127.0.0.1:5000/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: history,
                max_tokens: 1000
            })
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
        const btnRow = nodeEl.querySelector('.button-row');
        if (btnRow) btnRow.style.display = 'none';
        
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
                            aiThinkEl.innerHTML = erase_thoughts? '': aiThinkEl.innerHTML;
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

        nodeEl.querySelector('.add-child-btn').classList.remove('hidden')
        nodeEl.querySelector('.add-child-btn').click()

    } catch (error) {
        aiContentEl.innerHTML = `<span style="color: #ff5555;">Error: ${error.message}</span>`;
    } finally {
        if (!textarea.disabled) {
            textarea.disabled = false;
            runBtn.disabled = false;
        }
        // drawEdges();
        autoLayout();
        updateThermometer(nodeId);
    }
}

function walkContext(leafNodeId) {
    const history = [];
    let currentId = leafNodeId;
    let skippedGroupIds = new Set(); 

    while (currentId) {
        const node = nodes.find(n => n.id === currentId);
        if (!node) break;

        if (node.groupId && groups[node.groupId]?.isCollapsed) {
            const gId = node.groupId;
            // If we haven't added this group's summary yet, inject it
            if (!skippedGroupIds.has(gId)) {
                history.push({
                    role: 'system',
                    content: `[COMPRESSED HISTORY SUMMARY]: ${groups[gId].summaryText}`
                });
                skippedGroupIds.add(gId);
            }
            // We skip pushing the raw user/ai text to save VRAM!
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
        setTimeout(()=>{
            createNode();
        },20)
    } else {
        autoLayout();
    }
}

function autoLayout() {
    const HORIZONTAL_SPACING = GRID_SIZE*17;
    const STANDARD_VERTICAL_SPACING = GRID_SIZE*15;
    const GROUP_VERTICAL_SPACING = GRID_SIZE*6; 

    let currentLeafX = 400;
    const childrenMap = {};
    const roots = [];

    nodes.forEach(n => {
        if (n.parentId && nodes.some(p => p.id === n.parentId)) {
            if (!childrenMap[n.parentId]) childrenMap[n.parentId] = [];
            childrenMap[n.parentId].push(n);
        } else {
            roots.push(n);
        }
    });

    function calculatePositions(nodeData, currentY) {
        const children = childrenMap[nodeData.id] || [];

        if (children.length === 0) {
            const x = currentLeafX;
            currentLeafX += HORIZONTAL_SPACING;
            nodeData.x = x;
            nodeData.y = currentY;
            return x;
        }

        let minX = Infinity;
        let maxX = -Infinity;

        children.forEach(child => {
            const isSameGroup = nodeData.groupId && child.groupId === nodeData.groupId;
            let tightDrop;
            
            if (isSameGroup) {
                // If the group is collapsed, stack them with 0 vertical drop
                if (groups[nodeData.groupId]?.isCollapsed) {
                    tightDrop = 0; 
                } else {
                    tightDrop = document.getElementById(nodeData.id)?.offsetHeight + 20 || 150;
                }
            }
            
            const nextY = isSameGroup ? currentY + tightDrop : currentY + STANDARD_VERTICAL_SPACING;
            
            const childX = calculatePositions(child, nextY);
            minX = Math.min(minX, childX);
            maxX = Math.max(maxX, childX);
        });

        const centeredX = (minX + maxX) / 2;
        nodeData.x = centeredX;
        nodeData.y = currentY;
        return centeredX;
    }

    roots.forEach(root => {
        calculatePositions(root, 200);
        currentLeafX += HORIZONTAL_SPACING;
    });

    nodes.forEach(nodeData => {
        const el = document.getElementById(nodeData.id);
        if (el) {
            el.style.zIndex = '10'; 
            el.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
            
            // ADD THIS: Fade out the nodes if their group is collapsed
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

    let startTimestamp = null;
    function animateEdges(timestamp) {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = timestamp - startTimestamp;
        
        drawEdges();
        drawGroups(); // Animate boxes resizing in real-time
        
        if (progress < 400) {
            requestAnimationFrame(animateEdges);
        } else {
            drawEdges();
            drawGroups();
        }
    }
    requestAnimationFrame(animateEdges);
}

async function triggerSummarize(groupId) {
    const group = groups[groupId];
    if (!group) return;

    // 1. Gather all raw text in chronological order
    const groupNodes = nodes.filter(n => n.groupId === groupId);
    let rawText = "Conversation Segment:\n";
    groupNodes.forEach(n => {
        rawText += `User: ${n.userText}\nAI: ${n.aiText}\n\n`;
    });

    // 2. Visual Loading State
    const btn = document.querySelector(`#box_${groupId} .summarize-btn`);
    if (btn) btn.textContent = "⏳ Summarizing...";

    // 3. The Backend Request
    const payload = {
        messages: [
            { role: "system", content: "You are a summarizer. Summarize the following conversation segment into exactly 3 concise sentences. Focus on the main technical context. Do NOT output any preamble." },
            { role: "user", content: rawText }
        ],
        max_tokens: 250
    };

    try {
        const response = await fetch('http://127.0.0.1:5000/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // Silently consume the stream in the background
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
                    } catch(e) {}
                }
            }
        }

        // 4. Update state and visually compress
        group.summaryText = summary.trim();
        group.isCollapsed = true;
        
        autoLayout(); // Trigger the crush animation
        updateThermometer(activeNodeId); // Watch your token usage drop!
        
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

    console.log("Group created:", groups[groupId]);
    
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

    // Delete the group metadata
    delete groups[groupId];
    console.log(`Group ${groupId} removed.`);
});

function drawGroups() {
    // Ensure the layer exists
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
            
            // Read live height to account for varying text lengths
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
        if (group.isCollapsed) {
            box.style.width = '420px';
            box.style.height = 'auto'; // Let the text dictate height
            box.style.background = '#282a36'; // Solid background for readability
            box.innerHTML = `
                <div class="group-header">
                    📦 ${group.name}
                    <button class="summarize-btn" onclick="toggleGroupState('${group.id}')">🔍 Expand</button>
                </div>
                <div style="padding: 15px; padding-top: 25px; color: #f8f8f2; font-size: 14px; line-height: 1.4;">
                    ${group.summaryText}
                </div>
            `;
        } else {
            box.style.background = 'rgba(30, 30, 46, 0.6)';
            box.innerHTML = `
                <div class="group-header">
                    📦 ${group.name}
                    <button class="summarize-btn" onclick="triggerSummarize('${group.id}')">✨ Summarize</button>
                </div>
            `;
        }
        
        groupsLayer.appendChild(box);
    });
}

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
updateCanvas();
window.addEventListener('DOMContentLoaded', () => {
    createNode();
});
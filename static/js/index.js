const $ = (id) => document.getElementById(id)
const $make = (tag) => document.createElement(tag)

const viewport = $('viewport')
const nodesLayer = $('nodes-layer')

let camera = { x:0, y:0, zoom: 1}
const GRID_SIZE = 24

function updateCanvas() {
    const bgSize = GRID_SIZE * camera.zoom
    const bgX = camera.x % bgSize
    const bgY = camera.y % bgSize

    viewport.style.backgroundPosition = `${bgX}px ${bgY}px`
    viewport.style.backgroundSize = `${bgSize}px ${bgSize}px`

    nodesLayer.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
}


// PANNING
let isPanning = false;
let startPanX = 0, startPanY = 0;

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


// --- ZOOM LOGIC ---
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
let draggedNode = null;
let nodeStartX = 0, nodeStartY = 0;

nodesLayer.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('node-header')) {
        draggedNode = e.target.closest('.node');
        
        // Extract the current translate(X, Y) from the node's CSS
        const style = window.getComputedStyle(draggedNode);
        const matrix = new DOMMatrixReadOnly(style.transform);
        
        // Calculate mouse offset relative to the node's origin
        nodeStartX = (e.clientX - camera.x) / camera.zoom - matrix.m41;
        nodeStartY = (e.clientY - camera.y) / camera.zoom - matrix.m42;
        
        draggedNode.style.zIndex = 1000; // Bring to front
    }
});

window.addEventListener('mousemove', (e) => {
    if (draggedNode) {
        // Calculate the raw target position in canvas coordinates
        const rawX = (e.clientX - camera.x) / camera.zoom - nodeStartX;
        const rawY = (e.clientY - camera.y) / camera.zoom - nodeStartY;

        // Snap coordinates to the nearest grid interval
        const snappedX = Math.round(rawX / GRID_SIZE) * GRID_SIZE;
        const snappedY = Math.round(rawY / GRID_SIZE) * GRID_SIZE;

        draggedNode.style.transform = `translate(${snappedX}px, ${snappedY}px)`;

        // Update state andd redraw cables
        const data = nodes.find(n => n.id === draggedNode.id);
        if (data) { 
            data.x = snappedX; 
            data.y = snappedY; 
            drawEdges(); 
        }
    }
});

window.addEventListener('mouseup', () => {
    if (draggedNode) {
        draggedNode.style.zIndex = '';
        draggedNode = null;
    }
});


///////////////////////////////////////////////////////////////////////////////


let nodes = []; // Master Array
let activeNodeId = null
const edgesLayer = $('edges-layer')
const promptInput = $('prompt-input')
const sendBtn = $('send-btn')

// Add a global counter for spacing out siblings when forking
let forkOffsetCounter = 0;

function createNode(parentId, x, y, initialUserText = "") {
    let id = 'node-' + Date.now();
    while ($(id) != undefined) {
        id += 1;
    }

    // Data Model now holds both halves of the turn
    const nodeData = { 
        id, 
        userText: initialUserText, 
        aiText: "", 
        aiThinking: "", 
        parentId, 
        x, 
        y,
        muted: false
    };
    nodes.push(nodeData);

    const el = document.createElement('div');
    el.className = `node turn-node`;
    el.id = id;
    el.style.transform = `translate(${x}px, ${y}px)`;
    
    el.innerHTML = `
        <div class="handle handle-in"></div>
        <div class="node-header" style="display:flex; justify-content:space-between; padding:8px; background:#111; border-radius:8px 8px 0 0;">
            <span onclick="copy_text('${id}')">${id}</span>
            <div>
                <button class="duplicate-btn" title="Duplicate Branch">📄</button>
                <button class="delete-btn" title="Delete (Shift+Click to delete branch)">🗑️</button>
            </div>
        </div>
        <div class="user-section">
            <div contenteditable="true" class="node-input" placeholder="Type prompt here...">${initialUserText}</div>
            <div class="button-row">
                <button class="run-btn">Run ➔</button>
            </div>
        </div>
        <div class="ai-section">
            <div class="think-content" style="display: none;"></div>
            <div class="ai-content"></div>
        </div>
        <div class="handle handle-out"></div>
        <button class="add-child-btn hidden" title="Branch">+</button>
    `;

    setTimeout(() => {
        const runBtn = el.querySelector('.run-btn');
        const textarea = el.querySelector('.node-input');
        const addBtn = el.querySelector('.add-child-btn');
        const dupBtn = el.querySelector('.duplicate-btn');
        const muteBtn = el.querySelector('.mute-btn');

        if (!initialUserText) textarea.focus();

        runBtn.addEventListener('click', () => runUserNode(id));
        
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                runUserNode(id);
            }
        });

        // Branch down (Next turn in conversation)
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            forkOffsetCounter += 1;
            const forkX = x + (forkOffsetCounter * 350); 
            const forkY = y + el.offsetHeight + 60;
            createNode(id, forkX, forkY);
        });

        // Branch sideways (Duplicate current turn to try again)
        dupBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            forkOffsetCounter += 1;
            const forkX = x + 350; 
            createNode(parentId, forkX, y, textarea.value);
        });

        const deleteBtn = el.querySelector('.delete-btn');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteNode(id, e.shiftKey);
        });

        // muteBtn.addEventListener('click', (e) => toggleMute(id, e));
        
        el.addEventListener('click', (e) => {
            if (!e.target.closest('button') && !e.target.closest('textarea')) {
                selectNode(id);
            }
        });
    }, 0);

    nodesLayer.appendChild(el);
    drawEdges();
    selectNode(id); 
    return id;
}

// DRAWING THE CABLES
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

// SEND BUTTON
async function runUserNode(nodeId) {
    const nodeEl = document.getElementById(nodeId);
    const textarea = nodeEl.querySelector('.node-input');
    const text = textarea.textContent.trim();
    if (!text) return;

    const nodeData = nodes.find(n => n.id === nodeId);
    
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

        aiThinkEl.innerHTML = ''
        nodeEl.querySelector('.add-child-btn').classList.remove('hidden')
        
        // 3. Calculate dynamic offset based on how tall the AI response got
        const forkX = nodeData.x;
        const forkY = nodeData.y + nodeEl.offsetHeight + 80; 

        // 4. Spawn the next node automatically
        createNode(nodeId, forkX, forkY);

    } catch (error) {
        aiContentEl.innerHTML = `<span style="color: #ff5555;">Error: ${error.message}</span>`;
    } finally {
        // Remove the disabled resets from finally, because we want it to STAY locked on success.
        // If it failed, we unlock it so the user can try again.
        if (!textarea.disabled) {
            textarea.disabled = false;
            runBtn.disabled = false;
        }
        drawEdges();
        updateThermometer(nodeId);
    }
}


function walkContext(leafNodeId) {
    const history = [];
    let currentId = leafNodeId;
    while (currentId) {
        const node = nodes.find(n => n.id === currentId);
        if (!node) break;
        
        if (!node.muted) {
            // We are walking backwards up the tree.
            // AI response happened AFTER the User prompt, so push it first.
            if (node.aiText) {
                history.push({ role: 'assistant', content: node.aiText });
            }
            if (node.userText) {
                history.push({ role: 'user', content: node.userText });
            }
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

const CONTEXT_LIMIT = 4096;

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

function selectNode(id) {
    activeNodeId = id;
    
    // 1. Gather all node IDs in this active lineage
    const lineage = new Set();
    let curr = id;
    while (curr) {
        lineage.add(curr);
        const n = nodes.find(item => item.id === curr);
        curr = n ? n.parentId : null;
    }

    // 2. Update visual classes on all nodes
    document.querySelectorAll('.node').forEach(el => {
        el.classList.toggle('active-branch', lineage.has(el.id));
    });

    // 3. Redraw paths so active edges highlight
    drawEdges(lineage);

    // 4. Update the gauge
    updateThermometer(id);
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
}

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
updateCanvas();
window.addEventListener('DOMContentLoaded', () => {
    createNode(null, 400, 200);
});
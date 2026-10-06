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

function createNode(type, text, parentId, x, y) {
    let id = 'node-' + Date.now();
    while ($(id) != undefined) {
        id += 1;
    }
    const nodeData = { id, type, text, parentId, x, y };
    nodes.push(nodeData);

    const el = document.createElement('div');
    el.className = `node ${type}-node`;
    el.id = id;
    el.style.transform = `translate(${x}px, ${y}px)`;

    if (type === 'user') {
        // Editable state for new User Nodes
        el.innerHTML = `
            <div class="handle handle-in"></div>
            <div class="node-header">User Prompt</div>
            <div class="node-content">
                <textarea class="node-input" placeholder="Type prompt here..."></textarea>
                <button class="run-btn">Run ➔</button>
            </div>
            <div class="handle handle-out"></div>
        `;
        
        // Add the event listener for the Run button
        setTimeout(() => {
            const runBtn = el.querySelector('.run-btn');
            const textarea = el.querySelector('.node-input');
            textarea.focus();

            runBtn.addEventListener('click', () => runUserNode(id, textarea.value));
            
            // Allow Shift+Enter for new line, standard Enter to submit
            textarea.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    runUserNode(id, textarea.value);
                }
            });
        }, 0);

    } else {
        // AI Node template with the Fork (+) button
        el.innerHTML = `
            <div class="handle handle-in"></div>
            <div class="node-header">AI Response</div>
            <div class="think-content"></div>
            <div class="node-content">${text}</div>
            <div class="handle handle-out"></div>
            <button class="add-child-btn">+</button>
        `;

        // Add the event listener for branching
        setTimeout(() => {
            const addBtn = el.querySelector('.add-child-btn');
            addBtn.addEventListener('click', () => {
                // Shift X slightly based on how many forks we've made
                forkOffsetCounter += 1;
                const forkX = x + (forkOffsetCounter * 350); 
                const forkY = y + el.offsetHeight + 80;
                
                // Spawn a fresh, editable User Node connected to this AI node
                createNode('user', '', id, forkX, forkY);
            });
        }, 0);
    }

    nodesLayer.appendChild(el);
    drawEdges();
    return id;
}

// DRAWING THE CABLES
function drawEdges() {
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
        edgesLayer.appendChild(path);
    });
}

// SEND BUTTON
async function runUserNode(nodeId, text) {
    if (!text.trim()) return;

    const userNodeEl = document.getElementById(nodeId);
    const userNodeData = nodes.find(n => n.id === nodeId);
    
    // 1. Lock the input (replace textarea with static text)
    userNodeData.text = text;
    userNodeEl.querySelector('.node-content').innerHTML = text;
    
    // 2. Add a '+' button to the user node so you can fork directly from here too
    // const outHandle = userNodeEl.querySelector('.handle-out');
    // outHandle.insertAdjacentHTML('afterend', `<button class="add-child-btn">+</button>`);
    
    // Reset fork offset for this new generation branch
    forkOffsetCounter = 0;

    // 3. Assemble history and spawn AI Node
    const history = walkContext(nodeId);
    const spawnX = userNodeData.x;
    const spawnY = userNodeData.y + userNodeEl.offsetHeight + 80;

    const aiNodeId = createNode('ai', '<span class="loading">Thinking...</span>', nodeId, spawnX, spawnY);
    
    // We get reference to inject text later
    const aiNodeEl = document.getElementById(aiNodeId);
    const aiContentEl = aiNodeEl.querySelector('.node-content');
    const aiThinkEl = aiNodeEl.querySelector('.think-content');
    
    const aiNodeData = nodes.find(n => n.id === aiNodeId);
    aiNodeData.text = ""; // Ensure state text is empty
    aiContentEl.innerHTML = "";

    try {
        // 4. Hit the FastAPI proxy
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
                    
                    // Route actual content
                    if (deltaObj.content) {
                        aiContentEl.innerHTML += deltaObj.content;
                        // ONLY save actual content to state array for the Context Walker
                        aiNodeData.text += deltaObj.content; 
                    } 
                    // Route reasoning content
                    else if (deltaObj.reasoning_content) {
                        aiThinkEl.innerHTML += deltaObj.reasoning_content;
                    }
                } catch (e) {
                    console.error("Failed to parse buffered line:", line, e);
                }
            }

            drawEdges(); 
        }

        drawEdges();
        
    } catch (error) {
        aiContentEl.innerHTML = `<span style="color: #ff5555;">Error: ${error.message}</span>`;
        drawEdges();
    }
}


function walkContext(leafNodeId) {
    const history = [];
    let currentId = leafNodeId;

    while (currentId) {
        const node = nodes.find(n => n.id === currentId);
        if (!node) break;

        if (!node.muted) {
            history.push({
                role: node.type === 'user' ? 'user' : 'assistant',
                content: node.text
            });
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

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
updateCanvas();
window.addEventListener('DOMContentLoaded', () => {
    createNode('user', '', null, 400, 200);
});
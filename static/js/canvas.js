/**
 * Updates the canvas grid background position, size, and applies the camera zoom/pan transform to the nodes layer.
 */
function updateCanvas() {
    const bgSize = GRID_SIZE * camera.zoom;
    const bgX = camera.x % bgSize;
    const bgY = camera.y % bgSize;

    viewport.style.backgroundPosition = `${bgX}px ${bgY}px`;
    viewport.style.backgroundSize = `${bgSize}px ${bgSize}px`;

    nodesLayer.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    nodes.forEach(node => {
        const el = document.getElementById(node.id);
        if (!el) return;

        if (el.style.display !== 'none') {
            node.cachedWidth = el.offsetWidth;
            node.cachedHeight = el.offsetHeight;
        }

        const w = (node.cachedWidth || 336) * camera.zoom;
        const h = (node.cachedHeight || 200) * camera.zoom;
        const screenX = node.x * camera.zoom + camera.x;
        const screenY = node.y * camera.zoom + camera.y;

        const isOffscreen = (screenX + w < 0) || (screenY + h < 0) || (screenX > vw) || (screenY > vh);

        const edgeEl = document.getElementById('edge_' + node.id);

        if (isOffscreen) {
            if (el.style.display !== 'none') el.style.display = 'none';
            if (edgeEl && edgeEl.style.display !== 'none') edgeEl.style.display = 'none';
        } else {
            if (el.style.display === 'none') el.style.display = '';
            if (edgeEl && edgeEl.style.display === 'none') edgeEl.style.display = '';
        }
    });
}

let hasMovedDuringPan = false;
let panStartX = 0;
let panStartY = 0;

viewport.addEventListener('mousedown', (e) => {
    if (e.target.closest('.node') || e.target.closest('#controls')) return;

    isPanning = true;
    hasMovedDuringPan = false;
    panStartX = e.clientX;
    panStartY = e.clientY;
    startPanX = e.clientX - camera.x;
    startPanY = e.clientY - camera.y;
});

window.addEventListener('mousemove', (e) => {
    if (isPanning) {
        if (Math.abs(e.clientX - panStartX) > 3 || Math.abs(e.clientY - panStartY) > 3) {
            hasMovedDuringPan = true;
        }
        camera.x = e.clientX - startPanX;
        camera.y = e.clientY - startPanY;
        updateCanvas();
    }
});

window.addEventListener('mouseup', (e) => {
    if (isPanning) {
        isPanning = false;
        if (!hasMovedDuringPan && !e.target.closest('.node') && !e.target.closest('#controls')) {
            if (typeof selectNode === 'function' && activeNodeId) {
                selectNode(activeNodeId);
            }
        }
    }
});

viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomSensitivity = 0.001;
    const delta = e.deltaY * -zoomSensitivity;
    let newZoom = camera.zoom * Math.exp(delta);
    newZoom = Math.max(0.1, Math.min(newZoom, 3));

    const rect = viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    camera.x = mouseX - (mouseX - camera.x) * (newZoom / camera.zoom);
    camera.y = mouseY - (mouseY - camera.y) * (newZoom / camera.zoom);
    camera.zoom = newZoom;

    updateCanvas();
}, { passive: false });

/**
 * Draws the SVG Bezier curves connecting parent and child nodes to visually represent the conversation tree.
 * Highlights edges that belong to the currently active lineage.
 * @param {Set|null} activeLineage - A set of node IDs representing the currently active branch.
 */
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
        if (!parentOut || !childIn) return;

        const pW = parentEl.offsetWidth || parent.cachedWidth || 336;
        const pH = parentEl.offsetHeight || parent.cachedHeight || 200;
        const cW = childEl.offsetWidth || node.cachedWidth || 336;

        const startX = parent.x + pW / 2;
        const startY = parent.y + pH;
        const endX = node.x + cW / 2;
        const endY = node.y;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.id = 'edge_' + node.id;
        path.setAttribute('d', `M ${startX} ${startY} C ${startX} ${startY + 60}, ${endX} ${endY - 60}, ${endX} ${endY}`);

        let edgeClass = 'edge-path';
        if (activeLineage.has(node.id) && activeLineage.has(parent.id)) edgeClass += ' active';
        if (node.muted || parent.muted) edgeClass += ' muted';
        path.setAttribute('class', edgeClass);

        edgesLayer.appendChild(path);
    });

    if (typeof tempEdgePath !== 'undefined' && tempEdgePath && isDraggingEdge) {
        edgesLayer.appendChild(tempEdgePath);
    }
}

/**
 * Renders bounding boxes around grouped nodes, including expanding/collapsing controls and summary details.
 */
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
        box.style.background = 'rgba(30, 30, 46, 0.6)';

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
                <div class="group-color-proxy" style="background-color: ${group.color || '#a0a0a0'};" onclick="this.nextElementSibling.click()"></div>
                <input type="color" class="group-color-picker" value="${group.color || '#a0a0a0'}" 
                    onchange="changeGroupColor('${group.id}', this.value)" style="display: none;">
                <span class="node-id" style="color: ${group.color || '#a0a0a0'};" title="Shift+Click to insert reference" onmousedown="if(event.shiftKey) event.preventDefault();" onclick="handleIdClick(event, '${group.id}', true)">${group.name}</span>
                ${btnHtml}
            </div>
        `;
        groupsLayer.appendChild(box);

        // Ensure nodes inside this group show the color indicator
        changeGroupColor(group.id, group.color || '#a0a0a0', false);
    });
}

window.changeGroupColor = function (groupId, color, save = true) {
    if (groups[groupId]) {
        groups[groupId].color = color;

        const groupEl = document.getElementById(`box_${groupId}`);
        if (groupEl) {
            const proxy = groupEl.querySelector('.group-color-proxy');
            if (proxy) proxy.style.backgroundColor = color;
            const groupIdText = groupEl.querySelector('.node-id');
            if (groupIdText) groupIdText.style.color = color;
        }

        // Update nodes in this group
        const groupNodes = nodes.filter(n => n.groupId === groupId);
        groupNodes.forEach(n => {
            const el = document.getElementById(n.id);
            if (el) {
                let colorIndicator = el.querySelector('.node-group-color');
                if (!colorIndicator) {
                    const nodeIdEl = el.querySelector('.node-id');
                    if (nodeIdEl) {
                        colorIndicator = document.createElement('span');
                        colorIndicator.className = 'node-group-color';
                        colorIndicator.style.display = 'inline-block';
                        colorIndicator.style.width = '12px';
                        colorIndicator.style.height = '12px';
                        colorIndicator.style.borderRadius = '3px';
                        colorIndicator.style.marginRight = '6px';
                        colorIndicator.style.verticalAlign = 'middle';
                        nodeIdEl.parentNode.insertBefore(colorIndicator, nodeIdEl);
                    }
                }
                if (colorIndicator) {
                    colorIndicator.style.backgroundColor = color;
                }
                const nodeIdEl = el.querySelector('.node-id');
                if (nodeIdEl) {
                    nodeIdEl.style.color = color;
                }
            }
        });

        if (save && typeof saveState === 'function') saveState();
    }
};

/**
 * Automatically organizes the conversation tree into a structured vertical/horizontal layout.
 * Groups nodes logically, resolves overlapping branches, and animates them into their new positions.
 */
function autoLayout() {
    // Unhide all nodes temporarily for accurate layout measurement
    nodes.forEach(n => {
        const el = document.getElementById(n.id);
        if (el && el.style.display === 'none') {
            el.style.display = '';
        }
    });

    const HORIZONTAL_GAP = GRID_SIZE * 4;
    let currentRootX = 400;
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

    function calculateSubtreeMetrics(nodeData) {
        const children = childrenMap[nodeData.id] || [];
        const el = document.getElementById(nodeData.id);

        const nodeWidth = el ? el.offsetWidth : 380;
        const nodeHeight = el ? el.offsetHeight : 200;

        nodeData.nodeWidth = nodeWidth;
        nodeData.nodeHeight = nodeHeight;

        let groupedChildren = children.filter(c => nodeData.groupId && c.groupId === nodeData.groupId);
        let otherChildren = children.filter(c => !(nodeData.groupId && c.groupId === nodeData.groupId));

        if (children.length === 0) {
            nodeData.subtreeWidth = nodeWidth;
            return nodeData.subtreeWidth;
        }

        if (groupedChildren.length === 1) {
            let child = groupedChildren[0];
            calculateSubtreeMetrics(child);

            let otherWidth = 0;
            otherChildren.forEach((c, index) => {
                otherWidth += calculateSubtreeMetrics(c);
                if (index < otherChildren.length - 1) otherWidth += HORIZONTAL_GAP;
            });

            let childMainWidth = child.isGroupColumn ? child.mainColumnWidth : child.nodeWidth;
            let mainColumnWidth = Math.max(nodeWidth, childMainWidth);
            nodeData.mainColumnWidth = mainColumnWidth;

            let offset = (mainColumnWidth - childMainWidth) / 2;
            nodeData.fullGroupedWidth = Math.max(mainColumnWidth, offset + child.subtreeWidth);

            nodeData.subtreeWidth = nodeData.fullGroupedWidth + (otherWidth > 0 ? HORIZONTAL_GAP + otherWidth : 0);
            nodeData.isGroupColumn = true;
        } else {
            let childrenTotalWidth = 0;
            children.forEach((child, index) => {
                childrenTotalWidth += calculateSubtreeMetrics(child);
                if (index < children.length - 1) childrenTotalWidth += HORIZONTAL_GAP;
            });

            nodeData.mainColumnWidth = nodeWidth;
            nodeData.fullGroupedWidth = Math.max(nodeWidth, childrenTotalWidth);
            nodeData.subtreeWidth = Math.max(nodeWidth, childrenTotalWidth);
            nodeData.isGroupColumn = false;
        }

        return nodeData.subtreeWidth;
    }

    function placeSubtree(nodeData, startX, currentY) {
        const children = childrenMap[nodeData.id] || [];

        if (nodeData.isGroupColumn) {
            nodeData.x = startX + (nodeData.mainColumnWidth / 2) - (nodeData.nodeWidth / 2);
            nodeData.y = currentY;

            let groupedChildren = children.filter(c => nodeData.groupId && c.groupId === nodeData.groupId);
            let otherChildren = children.filter(c => !(nodeData.groupId && c.groupId === nodeData.groupId));

            if (groupedChildren.length === 1) {
                let child = groupedChildren[0];
                let tightDrop = nodeData.nodeHeight + 20;
                let childMainWidth = child.isGroupColumn ? child.mainColumnWidth : child.nodeWidth;
                let offset = (nodeData.mainColumnWidth - childMainWidth) / 2;
                placeSubtree(child, startX + offset, currentY + tightDrop);
            }

            let currentOtherX = startX + nodeData.fullGroupedWidth + HORIZONTAL_GAP;
            otherChildren.forEach(child => {
                let standardDrop = nodeData.nodeHeight + (GRID_SIZE * 3);
                placeSubtree(child, currentOtherX, currentY + standardDrop);
                currentOtherX += child.subtreeWidth + HORIZONTAL_GAP;
            });

        } else {
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

            if (children.length > 0) {
                let firstChild = children[0];
                let lastChild = children[children.length - 1];
                let centerOfChildren = (firstChild.x + (firstChild.nodeWidth / 2) + lastChild.x + (lastChild.nodeWidth / 2)) / 2;

                let desiredX = centerOfChildren - (nodeData.nodeWidth / 2);

                if (desiredX < startX) desiredX = startX;
                if (desiredX + nodeData.nodeWidth > startX + nodeData.subtreeWidth) {
                    desiredX = startX + nodeData.subtreeWidth - nodeData.nodeWidth;
                }

                nodeData.x = desiredX;
            } else {
                nodeData.x = startX + (nodeData.subtreeWidth / 2) - (nodeData.nodeWidth / 2);
            }
            nodeData.y = currentY;
        }
    }

    nodes.forEach(n => {
        const el = document.getElementById(n.id);
        if (el) {
            if (n.isCollapsed) {
                el.classList.add('collapsed-node');
            } else {
                el.classList.remove('collapsed-node');
            }

            if (!n.isCollapsed && (!n.groupId || groups[n.groupId]?.isCollapsed === false)) {
                let iterations = 0;
                const minW = (n.type === 'document' || n.type === 'image') ? 260 : 336;
                const maxW = 1200;

                while (iterations < 4) {
                    const w = el.offsetWidth;
                    const h = el.offsetHeight;
                    const currentRatio = w / h;

                    if (Math.abs(currentRatio - 1.25) < 0.05) break;

                    const area = w * h;
                    let targetW = Math.sqrt(area * 1.25);
                    targetW = Math.max(minW, Math.min(targetW, maxW));

                    el.style.width = `${targetW}px`;

                    // Force reflow
                    document.body.offsetHeight;
                    iterations++;
                }

                let finalW = Math.round(el.offsetWidth / GRID_SIZE) * GRID_SIZE;
                finalW = Math.max(minW, Math.min(finalW, maxW));
                el.style.width = `${finalW}px`;
                n.nodeWidth = finalW;
            }
        }
    });

    document.body.offsetHeight;

    roots.forEach(root => {
        calculateSubtreeMetrics(root);
        placeSubtree(root, currentRootX, 200);
        currentRootX += root.subtreeWidth + HORIZONTAL_GAP;
    });

    nodes.forEach(nodeData => {
        const el = document.getElementById(nodeData.id);
        if (el) {
            el.style.zIndex = '10';
            el.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
            el.style.opacity = '1';
            el.style.pointerEvents = 'auto';
            el.style.transform = `translate(${nodeData.x}px, ${nodeData.y}px)`;
            setTimeout(() => el.style.transition = 'none', 400);
        }
    });

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
    updateCanvas();
    if (typeof saveState === 'function') saveState();
}

// --- Edge Dragging Logic ---
let isDraggingEdge = false;
let dragEdgeStartNodeId = null;
let dragEdgeType = null; // 'out' or 'in'
let tempEdgePath = null;

function updateTempEdge(e) {
    if (!tempEdgePath) return;

    const nlRect = nodesLayer.getBoundingClientRect();
    const cursorX = (e.clientX - nlRect.left) / camera.zoom;
    const cursorY = (e.clientY - nlRect.top) / camera.zoom;

    const startNodeEl = document.getElementById(dragEdgeStartNodeId);
    if (!startNodeEl) return;

    let startX, startY, endX, endY;

    const startNode = nodes.find(n => n.id === dragEdgeStartNodeId);
    if (!startNode) return;

    if (dragEdgeType === 'out') {
        startX = startNode.x + startNodeEl.offsetWidth / 2;
        startY = startNode.y + startNodeEl.offsetHeight;
        endX = cursorX;
        endY = cursorY;
    } else {
        endX = startNode.x + startNodeEl.offsetWidth / 2;
        endY = startNode.y;
        startX = cursorX;
        startY = cursorY;
    }

    tempEdgePath.setAttribute('d', `M ${startX} ${startY} C ${startX} ${startY + 60}, ${endX} ${endY - 60}, ${endX} ${endY}`);
}

window.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('handle')) {
        e.stopPropagation();
        const nodeEl = e.target.closest('.node');
        if (!nodeEl) return;
        const nodeId = nodeEl.id;
        const node = nodes.find(n => n.id === nodeId);
        if (!node) return;

        if (e.target.classList.contains('handle-out')) {
            isDraggingEdge = true;
            dragEdgeStartNodeId = nodeId;
            dragEdgeType = 'out';
        } else if (e.target.classList.contains('handle-in')) {
            if (node.parentId) {
                isDraggingEdge = true;
                dragEdgeStartNodeId = node.parentId;
                dragEdgeType = 'out';
                node.parentId = null;
                if (typeof drawEdges === 'function') drawEdges();
            } else {
                isDraggingEdge = true;
                dragEdgeStartNodeId = nodeId;
                dragEdgeType = 'in';
            }
        }

        if (isDraggingEdge) {
            tempEdgePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            tempEdgePath.setAttribute('class', 'edge-path temp-edge');
            tempEdgePath.style.pointerEvents = 'none';
            tempEdgePath.style.strokeDasharray = '5, 5';
            edgesLayer.appendChild(tempEdgePath);
            updateTempEdge(e);
        }
    }
});

window.addEventListener('mousemove', (e) => {
    if (isDraggingEdge) {
        updateTempEdge(e);
    }
});

window.addEventListener('mouseup', (e) => {
    if (isDraggingEdge) {
        isDraggingEdge = false;
        if (tempEdgePath) {
            tempEdgePath.remove();
            tempEdgePath = null;
        }

        let dropTarget = document.elementFromPoint(e.clientX, e.clientY);
        if (dropTarget && dropTarget.classList.contains('add-child-btn')) {
            const nodeEl = dropTarget.closest('.node');
            if (nodeEl) dropTarget = nodeEl.querySelector('.handle-out');
        }

        if (dropTarget && dropTarget.classList.contains('handle')) {
            const targetNodeEl = dropTarget.closest('.node');
            if (targetNodeEl) {
                const targetNodeId = targetNodeEl.id;

                if (dragEdgeType === 'out' && dropTarget.classList.contains('handle-in')) {
                    if (targetNodeId !== dragEdgeStartNodeId) {
                        const targetNode = nodes.find(n => n.id === targetNodeId);
                        if (targetNode) {
                            targetNode.parentId = dragEdgeStartNodeId;
                        }
                    }
                } else if (dragEdgeType === 'in' && dropTarget.classList.contains('handle-out')) {
                    if (targetNodeId !== dragEdgeStartNodeId) {
                        const startNode = nodes.find(n => n.id === dragEdgeStartNodeId);
                        if (startNode) {
                            startNode.parentId = targetNodeId;
                        }
                    }
                }
            }
        }
        if (typeof drawEdges === 'function') drawEdges();
        if (typeof saveState === 'function') saveState();
    }
});

/**
 * Pans and zooms the camera to center exactly on the last active node.
 */
function centerCanvas() {
    if (typeof activeNodeId === 'undefined' || !activeNodeId) return;
    const el = document.getElementById(activeNodeId);
    if (!el) return;
    const nodeData = nodes.find(n => n.id === activeNodeId);
    if (!nodeData) return;

    const vWidth = viewport.clientWidth;
    const vHeight = viewport.clientHeight;

    const nX = nodeData.x;
    const nY = nodeData.y;
    const nWidth = el.offsetWidth;
    const nHeight = el.offsetHeight;

    nodesLayer.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';

    camera.zoom = 1;
    camera.x = vWidth / 2 - (nX + nWidth / 2) * camera.zoom;
    camera.y = vHeight / 2 - (nY + nHeight / 2) * camera.zoom;

    updateCanvas();

    setTimeout(() => {
        nodesLayer.style.transition = 'none';
    }, 300);
}

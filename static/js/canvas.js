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
}

viewport.addEventListener('mousedown', (e) => {
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
                📦 <span class="node-id" style="cursor:copy;" title="Shift+Click to insert reference" onmousedown="if(event.shiftKey) event.preventDefault();" onclick="handleIdClick(event, '${group.id}', true)">${group.name}</span>
                ${btnHtml}
            </div>
        `;
        groupsLayer.appendChild(box);
    });
}

/**
 * Automatically organizes the conversation tree into a structured vertical/horizontal layout.
 * Groups nodes logically, resolves overlapping branches, and animates them into their new positions.
 */
function autoLayout() {
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

        if (groupedChildren.length > 0) {
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

            let mainColumnWidth = Math.max(nodeWidth, groupedWidth);
            nodeData.mainColumnWidth = mainColumnWidth;
            nodeData.subtreeWidth = mainColumnWidth + (otherWidth > 0 ? HORIZONTAL_GAP + otherWidth : 0);
            nodeData.isGroupColumn = true;
        } else {
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

    function placeSubtree(nodeData, startX, currentY) {
        const children = childrenMap[nodeData.id] || [];

        if (nodeData.isGroupColumn) {
            nodeData.x = startX + (nodeData.mainColumnWidth / 2) - (nodeData.nodeWidth / 2);
            nodeData.y = currentY;

            let groupedChildren = children.filter(c => nodeData.groupId && c.groupId === nodeData.groupId);
            let otherChildren = children.filter(c => !(nodeData.groupId && c.groupId === nodeData.groupId));

            let currentGroupedX = startX;
            groupedChildren.forEach(child => {
                let tightDrop = nodeData.nodeHeight + 20;
                placeSubtree(child, currentGroupedX, currentY + tightDrop);
                currentGroupedX += child.subtreeWidth + HORIZONTAL_GAP;
            });

            let currentOtherX = startX + nodeData.mainColumnWidth + HORIZONTAL_GAP;
            otherChildren.forEach(child => {
                let standardDrop = nodeData.nodeHeight + (GRID_SIZE * 3);
                placeSubtree(child, currentOtherX, currentY + standardDrop);
                currentOtherX += child.subtreeWidth + HORIZONTAL_GAP;
            });

        } else {
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
    if (typeof saveState === 'function') saveState();
}

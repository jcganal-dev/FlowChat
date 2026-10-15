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

        const w = (node.cachedWidth || node.nodeWidth || 336) * camera.zoom;
        const h = (node.cachedHeight || node.nodeHeight || 200) * camera.zoom;
        const screenX = node.x * camera.zoom + camera.x;
        const screenY = node.y * camera.zoom + camera.y;

        const isOffscreen = (screenX + w < 0) || (screenY + h < 0) || (screenX > vw) || (screenY > vh);

        // Never cul the node that currently has an input focused — the user is typing in it,
        // and hiding it would make the browser move focus away (to <body>), which breaks
        // shift+click reference insertion (lastFocusedInput gets cleared by the textarea's blur).
        const inputEl = el.querySelector('.node-input');
        const isFocusedInputNode = inputEl && lastFocusedInput && inputEl.contains(lastFocusedInput);

        const edgeEl = document.getElementById('edge_' + node.id);

        if (isOffscreen && !isFocusedInputNode) {
            if (el.style.display !== 'none') el.style.display = 'none';
            if (edgeEl && edgeEl.style.display !== 'none') edgeEl.style.display = 'none';
        } else {
            if (el.style.display === 'none') el.style.display = '';
            if (edgeEl && edgeEl.style.display === 'none') edgeEl.style.display = '';
        }
    });
}

/**
 * Unhides all nodes temporarily to measure their true rendered dimensions and recalculates culling.
 * Prevents large nodes positioned above the viewport from being erroneously culled on reload.
 */
function refreshNodeCulling() {
    nodes.filter(n => !n.isVirtual).forEach(n => {
        const el = document.getElementById(n.id);
        if (el && el.style.display === 'none') {
            el.style.display = '';
        }
    });

    // Force layout reflow so the browser computes actual offsetWidth and offsetHeight
    document.body.offsetHeight;

    nodes.filter(n => !n.isVirtual).forEach(n => {
        const el = document.getElementById(n.id);
        if (el) {
            n.cachedWidth = el.offsetWidth;
            n.cachedHeight = el.offsetHeight;
            n.nodeHeight = el.offsetHeight;
        }
    });

    updateCanvas();
}

let hasMovedDuringPan = false;
let panStartX = 0;
let panStartY = 0;

viewport.addEventListener('mousedown', (e) => {
    if (e.button === 1) { // Middle click
        e.preventDefault();
        isPanning = true;
        hasMovedDuringPan = false;
        panStartX = e.clientX;
        panStartY = e.clientY;
        startPanX = e.clientX - camera.x;
        startPanY = e.clientY - camera.y;
        document.body.classList.add('is-panning');
    } else if (e.button === 0) {
        if (!e.target.closest('.node') && !e.target.closest('#controls')) {
            viewport.dataset.mightDeselect = "true";
        }
    }
});

window.addEventListener('mousemove', (e) => {
    if (isPanning) {
        if (Math.abs(e.clientX - panStartX) > 3 || Math.abs(e.clientY - panStartY) > 3) {
            hasMovedDuringPan = true;
            if (typeof contextMenu !== 'undefined' && contextMenu) contextMenu.style.display = 'none';
            if (typeof sandboxContextMenu !== 'undefined' && sandboxContextMenu) sandboxContextMenu.style.display = 'none';
        }
        camera.x = e.clientX - startPanX;
        camera.y = e.clientY - startPanY;
        updateCanvas();
    }
});

window.addEventListener('mouseup', (e) => {
    if (e.button === 1 && isPanning) {
        isPanning = false;
        document.body.classList.remove('is-panning');
    }

    if (e.button === 0 && viewport.dataset.mightDeselect === "true") {
        viewport.dataset.mightDeselect = "false";
        if (!e.target.closest('.node') && !e.target.closest('#controls')) {
            if (typeof selectNode === 'function' && activeNodeId) {
                selectNode(activeNodeId);
            }
        }
    }
});

viewport.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
});

viewport.addEventListener('drop', async (e) => {
    e.preventDefault();
    const rawData = e.dataTransfer.getData('text/plain');
    if (!rawData) return;

    let filepaths = [];
    try {
        filepaths = JSON.parse(rawData);
    } catch (err) {
        filepaths = [rawData];
    }

    if (!Array.isArray(filepaths) || filepaths.length === 0) return;

    const originalFilepaths = [...filepaths];
    const sandboxData = await apiFetchSandboxFiles();
    if (sandboxData && sandboxData.files) {
        let expanded = new Set();
        for (const fp of filepaths) {
            if (sandboxData.files.includes(fp)) {
                expanded.add(fp);
            } else {
                const prefix = fp + '/';
                let found = false;
                for (const sf of sandboxData.files) {
                    if (sf.startsWith(prefix)) {
                        expanded.add(sf);
                        found = true;
                    }
                }
                if (!found) expanded.add(fp);
            }
        }
        filepaths = Array.from(expanded);
    }

    const rect = viewport.getBoundingClientRect();
    let dropX = (e.clientX - rect.left - camera.x) / camera.zoom;
    let dropY = (e.clientY - rect.top - camera.y) / camera.zoom;

    const targetNodeEl = e.target.closest('.node');

    let filesData = [];
    let skippedFiles = [];

    for (let i = 0; i < filepaths.length; i++) {
        const filepath = filepaths[i];

        const isImage = filepath.match(imageWhitelist);
        const isText = filepath.match(textWhitelist) || filepath.match(exactNameWhitelist);
        
        if (!isImage && !isText) {
            skippedFiles.push(filepath);
            continue;
        }

        const virtualId = 'sandbox/' + filepath;
        let payload = null;
        let nodeData = nodes.find(n => n.id === virtualId);

        if (nodeData && nodeData.files && nodeData.files.length > 0) {
            payload = nodeData.files[0].payload;
        } else {
            const res = await apiFetchSandboxFile(filepath);
            if (!res) {
                window.customAlert(`Failed to load file content for ${filepath}.`);
                continue;
            }
            if (isImage) {
                const blob = await res.blob();
                payload = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                });
            } else {
                payload = await res.text();
            }
        }
        filesData.push({ name: filepath, payload: payload });
    }

    if (skippedFiles.length > 0) {
        const payload = "The following unsupported files are present in the directory structure but their contents were intentionally skipped:\n" + skippedFiles.map(f => "- " + f).join("\n");
        filesData.push({ name: 'unsupported_files.txt', payload: payload });
        window.customAlert(`Skipped ${skippedFiles.length} unsupported files. A reference list was created for the LLM.`);
    }

    if (filesData.length === 0) return;

    if (targetNodeEl) {
        const targetNodeData = nodes.find(n => n.id === targetNodeEl.id);
        if (targetNodeData) {
            if (targetNodeData.type === 'chat') {
                const inputEl = targetNodeEl.querySelector('.node-input');
                if (inputEl) {
                    if (inputEl.contentEditable === 'false' || inputEl.getAttribute('contenteditable') === 'false') {
                        window.customAlert('Cannot add references to a finished node!');
                    } else {
                        filesData.forEach(fd => {
                            const virtualId = 'sandbox/' + fd.name;
                            const range = document.createRange();
                            range.selectNodeContents(inputEl);
                            range.collapse(false);
                            if (typeof insertChipAtRange === 'function') insertChipAtRange(inputEl, range, virtualId, false);
                        });
                    }
                }
            } else {
                const isImageNode = targetNodeData.type === 'image';
                const acceptedFiles = filesData.filter(fd => {
                    if (isImageNode) {
                        return !!fd.name.match(imageWhitelist);
                    }
                    return textWhitelist.test(fd.name) || exactNameWhitelist.test(fd.name);
                });
                const mismatchedCount = filesData.length - acceptedFiles.length;

                if (acceptedFiles.length === 0) {
                    window.customAlert(isImageNode
                        ? 'Unsupported file type for this node. Please drop an image file.'
                        : 'Unsupported file type for this node. Please drop a text-based file.');
                    return;
                }
                if (mismatchedCount > 0) {
                    window.customAlert(`${mismatchedCount} file${mismatchedCount > 1 ? 's' : ''} were dropped but could not be added to a ${targetNodeData.type} node (only ${isImageNode ? 'image' : 'text-based'} files are accepted).`);
                }

                if (!targetNodeData.files) targetNodeData.files = [];
                acceptedFiles.forEach(fd => targetNodeData.files.push(fd));
                if (typeof targetNodeEl.renderFiles === 'function') targetNodeEl.renderFiles();
            }
            if (typeof saveState === 'function') saveState();
        }
    } else {
        const imageFiles = filesData.filter(fd => fd.name.match(imageWhitelist));
        const documentFiles = filesData.filter(fd => !fd.name.match(imageWhitelist));

        const baseTitle = originalFilepaths.length === 1 ? originalFilepaths[0].split('/').pop() : `${filesData.length} items`;

        if (imageFiles.length > 0) {
            const title = imageFiles.length === filesData.length ? baseTitle : `${baseTitle} (Images)`;
            const newId = createNode(null, dropX, dropY, '', 1, 0, title, null, 'image');
            const newNode = nodes.find(n => n.id === newId);
            if (newNode) newNode.files = imageFiles;
            dropX += 300;
        }

        if (documentFiles.length > 0) {
            const title = documentFiles.length === filesData.length ? baseTitle : `${baseTitle} (Docs)`;
            const newId = createNode(null, dropX, dropY, '', 1, 0, title, null, 'document');
            const newNode = nodes.find(n => n.id === newId);
            if (newNode) newNode.files = documentFiles;
        }

        if (typeof saveState === 'function') saveState();
    }
    selectedSandboxFiles.clear();
    lastSelectedSandboxFileIndex = -1;
    if (typeof updateSidebarSelection === 'function') updateSidebarSelection();
    if (typeof updateFocusFileSelection === 'function') updateFocusFileSelection();
});

viewport.addEventListener('wheel', (e) => {
    const targetElement = e.target.closest('.node')
    const targetElementPre = e.target.closest('pre')
    if (targetElement && targetElement.querySelector('.ai-section')) {
        const aiSection = targetElement.querySelector('.ai-section');
        if (targetElement && !e.ctrlKey && aiSection.scrollHeight > aiSection.clientHeight) {
            // do normal scrolling
            return;
        } else if (targetElementPre && !e.ctrlKey && targetElementPre.scrollHeight > targetElementPre.clientHeight) {
            return;
        }
    }
    const targetPre = e.target.closest('pre');
    if (targetPre && !e.shiftKey && targetPre.scrollWidth > targetPre.clientWidth) {
        // do normal scrolling
        return;
    }
    const thinkStream = e.target.closest('.think-stream');
    if (thinkStream && !e.ctrlKey && thinkStream.scrollHeight > thinkStream.clientHeight) {
        // do normal scrolling
        return;
    }
    const userSection = e.target.closest('.user-section');
    if (userSection && !e.ctrlKey && userSection.scrollHeight > userSection.clientHeight) {
        // do normal scrolling
        return;
    }

    e.preventDefault();
    if (typeof contextMenu !== 'undefined' && contextMenu) contextMenu.style.display = 'none';
    if (typeof sandboxContextMenu !== 'undefined' && sandboxContextMenu) sandboxContextMenu.style.display = 'none';
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
            btnHtml = `<button class="summarize-btn" onclick="toggleGroupState('${group.id}')"><img src="/static/icons/expand.svg" class="file-icon" style="width:14px;height:14px;vertical-align:middle;margin-right:4px;"> Expand</button>`;
        } else if (hasSummary) {
            btnHtml = `
                <button class="summarize-btn" onclick="toggleGroupState('${group.id}')"><img src="/static/icons/collapse.svg" class="file-icon" style="width:14px;height:14px;vertical-align:middle;margin-right:4px;"> Collapse</button>
                <button class="summarize-btn" onclick="triggerSummarize('${group.id}')"><img src="/static/icons/bulb.svg" class="file-icon" style="width:14px;height:14px;vertical-align:middle;margin-right:4px;"> Re-Summarize</button>
            `;
        } else {
            btnHtml = `<button class="summarize-btn" onclick="triggerSummarize('${group.id}')"><img src='/static/icons/bulb.svg' class="file-icon" style='margin-bottom: -2px; margin-right:0px;'> Summarize</button>`;
        }

        box.innerHTML = `
            <div class="group-header">
                <div class="group-color-proxy" style="background-color: ${group.color || '#a0a0a0'};" onclick="this.nextElementSibling.click()"></div>
                <input type="color" class="group-color-picker" value="${group.color || '#a0a0a0'}"
                    onchange="changeGroupColor('${group.id}', this.value)" style="position: absolute; opacity: 0; pointer-events: none; width: 0; height: 0;">
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
                // let colorIndicator = el.querySelector('.node-group-color');
                // if (!colorIndicator) {
                //     const nodeIdEl = el.querySelector('.node-id');
                //     if (nodeIdEl) {
                //         colorIndicator = document.createElement('span');
                //         colorIndicator.className = 'node-group-color';
                //         colorIndicator.style.display = 'inline-block';
                //         colorIndicator.style.width = '12px';
                //         colorIndicator.style.height = '12px';
                //         colorIndicator.style.borderRadius = '3px';
                //         colorIndicator.style.marginRight = '6px';
                //         colorIndicator.style.verticalAlign = 'middle';
                //         nodeIdEl.parentNode.insertBefore(colorIndicator, nodeIdEl);
                //     }
                // }
                // if (colorIndicator) {
                //     colorIndicator.style.backgroundColor = color;
                // }
                const nodeIdEl = el.querySelector('.node-id');
                if (nodeIdEl) {
                    nodeIdEl.style.color = color;
                }
                const nodeIcon = el.querySelector('.node-icon');
                if (nodeIcon) {
                    if (n.type === 'document') nodeIcon.innerHTML = documentIcon(color) 
                    if (n.type === 'image') nodeIcon.innerHTML = imageIcon(color) 
                    if (n.type === 'chat') nodeIcon.innerHTML = chatIcon(color) 
                    if (n.type === 'scrape') nodeIcon.innerHTML = scrapeIcon(color) 
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
// function autoLayout(preserveRoots = true) {
//     // Unhide all nodes temporarily for accurate layout measurement
//     nodes.filter(n => !n.isVirtual).forEach(n => {
//         const el = document.getElementById(n.id);
//         if (el && el.style.display === 'none') {
//             el.style.display = '';
//         }
//     });

//     const HORIZONTAL_GAP = GRID_SIZE * 4;
//     let currentRootX = 400;
//     const childrenMap = {};
//     const roots = [];

//     nodes.filter(n => !n.isVirtual).forEach(n => {
//         if (n.parentId && nodes.some(p => p.id === n.parentId && !p.isVirtual)) {
//             if (!childrenMap[n.parentId]) childrenMap[n.parentId] = [];
//             childrenMap[n.parentId].push(n);
//         } else {
//             roots.push(n);
//         }
//     });

//     function calculateSubtreeMetrics(nodeData) {
//         const children = childrenMap[nodeData.id] || [];
//         const el = document.getElementById(nodeData.id);

//         const nodeWidth = el ? el.offsetWidth : 380;
//         const nodeHeight = el ? el.offsetHeight : 200;

//         nodeData.nodeWidth = nodeWidth;
//         nodeData.nodeHeight = nodeHeight;

//         let groupedChildren = children.filter(c => nodeData.groupId && c.groupId === nodeData.groupId);
//         let otherChildren = children.filter(c => !(nodeData.groupId && c.groupId === nodeData.groupId));

//         if (children.length === 0) {
//             nodeData.subtreeWidth = nodeWidth;
//             return nodeData.subtreeWidth;
//         }

//         if (groupedChildren.length === 1) {
//             let child = groupedChildren[0];
//             calculateSubtreeMetrics(child);

//             let otherWidth = 0;
//             otherChildren.forEach((c, index) => {
//                 otherWidth += calculateSubtreeMetrics(c);
//                 if (index < otherChildren.length - 1) otherWidth += HORIZONTAL_GAP;
//             });

//             let childMainWidth = child.isGroupColumn ? child.mainColumnWidth : child.nodeWidth;
//             let mainColumnWidth = Math.max(nodeWidth, childMainWidth);
//             nodeData.mainColumnWidth = mainColumnWidth;

//             let offset = (mainColumnWidth - childMainWidth) / 2;
//             nodeData.fullGroupedWidth = Math.max(mainColumnWidth, offset + child.subtreeWidth);

//             nodeData.subtreeWidth = nodeData.fullGroupedWidth + (otherWidth > 0 ? HORIZONTAL_GAP + otherWidth : 0);
//             nodeData.isGroupColumn = true;
//         } else {
//             let childrenTotalWidth = 0;
//             children.forEach((child, index) => {
//                 childrenTotalWidth += calculateSubtreeMetrics(child);
//                 if (index < children.length - 1) childrenTotalWidth += HORIZONTAL_GAP;
//             });

//             nodeData.mainColumnWidth = nodeWidth;
//             nodeData.fullGroupedWidth = Math.max(nodeWidth, childrenTotalWidth);
//             nodeData.subtreeWidth = Math.max(nodeWidth, childrenTotalWidth);
//             nodeData.isGroupColumn = false;
//         }

//         return nodeData.subtreeWidth;
//     }

//     function placeSubtree(nodeData, startX, currentY) {
//         const children = childrenMap[nodeData.id] || [];

//         if (nodeData.isGroupColumn) {
//             nodeData.x = startX + (nodeData.mainColumnWidth / 2) - (nodeData.nodeWidth / 2);
//             nodeData.y = currentY;

//             let groupedChildren = children.filter(c => nodeData.groupId && c.groupId === nodeData.groupId);
//             let otherChildren = children.filter(c => !(nodeData.groupId && c.groupId === nodeData.groupId));

//             if (groupedChildren.length === 1) {
//                 let child = groupedChildren[0];
//                 let tightDrop = nodeData.nodeHeight + (GRID_SIZE * 2);
//                 let childMainWidth = child.isGroupColumn ? child.mainColumnWidth : child.nodeWidth;
//                 let offset = (nodeData.mainColumnWidth - childMainWidth) / 2;
//                 placeSubtree(child, startX + offset, currentY + tightDrop);
//             }

//             let currentOtherX = startX + nodeData.fullGroupedWidth + HORIZONTAL_GAP;
//             otherChildren.forEach(child => {
//                 let standardDrop = nodeData.nodeHeight + (GRID_SIZE * 3);
//                 placeSubtree(child, currentOtherX, currentY + standardDrop);
//                 currentOtherX += child.subtreeWidth + HORIZONTAL_GAP;
//             });

//         } else {
//             let childrenTotalWidth = 0;
//             children.forEach((c, index) => {
//                 childrenTotalWidth += c.subtreeWidth;
//                 if (index < children.length - 1) childrenTotalWidth += HORIZONTAL_GAP;
//             });

//             let currentChildX = startX + (nodeData.subtreeWidth / 2) - (childrenTotalWidth / 2);

//             children.forEach(child => {
//                 let standardDrop = nodeData.nodeHeight + (GRID_SIZE * 3);
//                 placeSubtree(child, currentChildX, currentY + standardDrop);
//                 currentChildX += child.subtreeWidth + HORIZONTAL_GAP;
//             });

//             if (children.length > 0) {
//                 let firstChild = children[0];
//                 let lastChild = children[children.length - 1];
//                 let centerOfChildren = (firstChild.x + (firstChild.nodeWidth / 2) + lastChild.x + (lastChild.nodeWidth / 2)) / 2;

//                 let desiredX = centerOfChildren - (nodeData.nodeWidth / 2);

//                 if (desiredX < startX) desiredX = startX;
//                 if (desiredX + nodeData.nodeWidth > startX + nodeData.subtreeWidth) {
//                     desiredX = startX + nodeData.subtreeWidth - nodeData.nodeWidth;
//                 }

//                 nodeData.x = desiredX;
//             } else {
//                 nodeData.x = startX + (nodeData.subtreeWidth / 2) - (nodeData.nodeWidth / 2);
//             }
//             nodeData.y = currentY;
//         }
//     }

//     nodes.filter(n => !n.isVirtual).forEach(n => {
//         const el = document.getElementById(n.id);
//         if (el) {
//             if (n.isCollapsed) {
//                 el.classList.add('collapsed-node');
//             } else {
//                 el.classList.remove('collapsed-node');
//             }

//             if (!n.isCollapsed && (!n.groupId || groups[n.groupId]?.isCollapsed !== true)) {

//                 let iterations = 0;
//                 const minW = (n.type === 'document' || n.type === 'image') ? 260 : 336;
//                 const maxW = 1200;

//                 while (iterations < 4) {
//                     const w = el.offsetWidth;
//                     const h = el.offsetHeight;
//                     const currentRatio = w / h;

//                     if (Math.abs(currentRatio - 1.25) < 0.05) break;

//                     const area = w * h;
//                     let targetW = Math.sqrt(area * 1.25);
//                     targetW = Math.max(minW, Math.min(targetW, maxW));

//                     el.style.width = `${targetW}px`;

//                     // Force reflow
//                     document.body.offsetHeight;
//                     iterations++;
//                 }

//                 let q = Math.round(el.offsetWidth / GRID_SIZE);
//                 let minQ = Math.ceil(minW / GRID_SIZE);
//                 let maxQ = Math.floor(maxW / GRID_SIZE);

//                 q = Math.max(minQ, Math.min(q, maxQ));
//                 let finalW = q * GRID_SIZE;

//                 el.style.width = `${finalW}px`;
//                 n.nodeWidth = finalW;
//             }
//         }
//     });

//     document.body.offsetHeight;

//     let placedBounds = [];

//     function shiftSubtree(nodeData, deltaX, deltaY) {
//         nodeData.x += deltaX;
//         nodeData.y += deltaY;
//         const children = childrenMap[nodeData.id] || [];
//         children.forEach(c => shiftSubtree(c, deltaX, deltaY));
//     }

//     function getSubtreeBounds(nodeData) {
//         let bounds = {
//             minX: nodeData.x,
//             maxX: nodeData.x + nodeData.nodeWidth,
//             minY: nodeData.y,
//             maxY: nodeData.y + nodeData.nodeHeight
//         };
//         const children = childrenMap[nodeData.id] || [];
//         children.forEach(c => {
//             let cb = getSubtreeBounds(c);
//             bounds.minX = Math.min(bounds.minX, cb.minX);
//             bounds.maxX = Math.max(bounds.maxX, cb.maxX);
//             bounds.minY = Math.min(bounds.minY, cb.minY);
//             bounds.maxY = Math.max(bounds.maxY, cb.maxY);
//         });
//         return bounds;
//     }

//     roots.forEach(root => {
//         calculateSubtreeMetrics(root);

//         if (preserveRoots) {
//             const originalX = root.x;
//             const originalY = root.y;

//             placeSubtree(root, 0, 0);

//             let deltaX = originalX - root.x;
//             let deltaY = originalY - root.y;
//             shiftSubtree(root, deltaX, deltaY);

//             let bounds = getSubtreeBounds(root);
//             let hasOverlap = true;
//             let safety = 0;
//             while (hasOverlap && safety < 100) {
//                 hasOverlap = false;
//                 for (let pb of placedBounds) {
//                     const pad = GRID_SIZE * 4;
//                     if (
//                         bounds.minX < pb.maxX + pad &&
//                         bounds.maxX + pad > pb.minX &&
//                         bounds.minY < pb.maxY + pad &&
//                         bounds.maxY + pad > pb.minY
//                     ) {
//                         hasOverlap = true;
//                         let shiftAmount = (pb.maxX + pad) - bounds.minX;
//                         shiftSubtree(root, shiftAmount, 0);
//                         bounds = getSubtreeBounds(root);
//                         break;
//                     }
//                 }
//                 safety++;
//             }
//             placedBounds.push(bounds);
//         } else {
//             placeSubtree(root, currentRootX, 200);
//             currentRootX += root.subtreeWidth + HORIZONTAL_GAP;
//         }
//     });

//     if (!preserveRoots && roots.length > 0) {
//         const primaryRoot = roots[0];
//         const deltaX = -primaryRoot.x;
//         const deltaY = -primaryRoot.y;
//         nodes.filter(n => !n.isVirtual).forEach(n => {
//             n.x += deltaX;
//             n.y += deltaY;
//         });
//     }

//     nodes.filter(n => !n.isVirtual).forEach(nodeData => {
//         const el = document.getElementById(nodeData.id);
//         if (el) {
//             nodeData.y = Math.round(nodeData.y / GRID_SIZE) * GRID_SIZE;

//             el.style.zIndex = '10';
//             el.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
//             el.style.opacity = '1';
//             el.style.pointerEvents = 'auto';
//             el.style.transform = `translate(${nodeData.x}px, ${nodeData.y}px)`;
//             setTimeout(() => el.style.transition = 'none', 400);
//         }
//     });

//     let startTimestamp = null;
//     function animateEdges(timestamp) {
//         if (!startTimestamp) startTimestamp = timestamp;
//         const progress = timestamp - startTimestamp;

//         drawEdges();
//         drawGroups();

//         if (progress < 400) {
//             requestAnimationFrame(animateEdges);
//         } else {
//             drawEdges();
//             drawGroups();
//         }
//     }
//     requestAnimationFrame(animateEdges);
//     updateCanvas();
//     if (typeof saveState === 'function') saveState();
// }

// --- Edge Dragging Logic ---

/**
 * Automatically organizes the conversation tree into a structured vertical/horizontal layout.
 * Groups nodes logically, resolves overlapping branches, and animates them into their new positions.
 *
 * @param {boolean} preserveRoots - Full-layout mode: if true, top-level roots stay anchored in place.
 * @param {string|null} [targetNodeId=null] - NEW: if set to a node id, ONLY that node and all of
 *   its descendants are measured, resized, and repositioned. The target node is anchored at its
 *   current position (preserveRoots is implied), and every other node acts as a static obstacle.
 */
function autoLayout(preserveRoots = true, targetNodeId = null) {
    const isTargeted = typeof targetNodeId === 'string' && targetNodeId.length > 0;

    // ------------------------------------------------------------------
    // NEW: determine which nodes are affected by this layout pass
    // ------------------------------------------------------------------
    let targetNode = null;
    let affectedNodes;

    if (isTargeted) {
        targetNode = nodes.find(n => n.id === targetNodeId && !n.isVirtual);
        if (!targetNode) {
            console.warn(`autoLayout: targetNodeId "${targetNodeId}" not found (or is virtual) — aborting layout.`);
            return;
        }

        // Temporary full children map, used only to walk down from the target
        const fullChildrenMap = {};
        nodes.filter(n => !n.isVirtual).forEach(n => {
            if (n.parentId && nodes.some(p => p.id === n.parentId && !p.isVirtual)) {
                if (!fullChildrenMap[n.parentId]) fullChildrenMap[n.parentId] = [];
                fullChildrenMap[n.parentId].push(n);
            }
        });

        // Target node + every descendant (breadth-first, cycle-safe)
        affectedNodes = [];
        const queue = [targetNode];
        const visited = new Set();
        while (queue.length > 0) {
            const current = queue.shift();
            if (visited.has(current.id)) continue;
            visited.add(current.id);
            affectedNodes.push(current);
            (fullChildrenMap[current.id] || []).forEach(child => queue.push(child));
        }
    } else {
        affectedNodes = nodes.filter(n => !n.isVirtual);
    }

    // Unhide affected nodes temporarily for accurate layout measurement
    affectedNodes.forEach(n => {
        const el = document.getElementById(n.id);
        if (el && el.style.display === 'none') {
            el.style.display = '';
        }
    });

    const HORIZONTAL_GAP = GRID_SIZE * 4;
    let currentRootX = 400;
    const childrenMap = {};
    const roots = [];

    affectedNodes.forEach(n => {
        const hasLayoutableParent = n.parentId && nodes.some(p => p.id === n.parentId && !p.isVirtual);

        // NEW: in targeted mode the target itself is the layout root,
        // even though it still has a (non-affected) parent.
        if (hasLayoutableParent && n !== targetNode) {
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
            nodeData.mainColumnCenter = nodeWidth / 2; // NEW: a leaf fills its slot; center = middle
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

            // NEW: the child's main column is NOT at the left edge of its subtree slot —
            // a normal child is centered over its own children, a group-column child is
            // centered in its own grouped block. mainColumnCenter tells us where it is.
            // (The old code assumed left edge via `offset`, which caused the rightward drift.)

            // NEW: where THIS node's main column sits relative to its slot's left edge.
            // The grouped block must contain both the main column and the child's
            // subtree centered on the shared axis:
            nodeData.mainColumnCenter = Math.max(mainColumnWidth / 2, child.mainColumnCenter);

            // NEW: block width = left part + right part around the axis
            nodeData.fullGroupedWidth =
                nodeData.mainColumnCenter +
                Math.max(mainColumnWidth / 2, child.subtreeWidth - child.mainColumnCenter);

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
            nodeData.mainColumnCenter = nodeData.subtreeWidth / 2; // NEW: centered over its children
        }

        return nodeData.subtreeWidth;
    }

    function placeSubtree(nodeData, startX, currentY) {
        const children = childrenMap[nodeData.id] || [];

        if (nodeData.isGroupColumn) {
            // CHANGED: center the main column on the group axis instead of
            // pinning it to the left edge of the slot
            let mainColCenter = startX + nodeData.mainColumnCenter;
            nodeData.x = mainColCenter - nodeData.nodeWidth / 2;
            nodeData.y = currentY;

            let groupedChildren = children.filter(c => nodeData.groupId && c.groupId === nodeData.groupId);
            let otherChildren = children.filter(c => !(nodeData.groupId && c.groupId === nodeData.groupId));

            if (groupedChildren.length === 1) {
                let child = groupedChildren[0];
                let tightDrop = nodeData.nodeHeight + (GRID_SIZE * 2);
                // CHANGED: slot the child so the center of ITS main column lands
                // exactly under ours — this is the line that fixes the drift
                placeSubtree(child, mainColCenter - child.mainColumnCenter, currentY + tightDrop);
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

    // CHANGED: width normalization / aspect-ratio fix only touches affected nodes
    affectedNodes.forEach(n => {
        const el = document.getElementById(n.id);
        if (el) {
            if (n.isCollapsed) {
                el.classList.add('collapsed-node');
            } else {
                el.classList.remove('collapsed-node');
            }

            if (!n.isCollapsed && (!n.groupId || groups[n.groupId]?.isCollapsed !== true)) {

                let iterations = 0;
                const minW = (n.type === 'document' || n.type === 'image') ? 260 : 336;
                const maxW = 1200;

                // NEW: sets width while keeping the node's horizontal center fixed —
                // half the delta extends left, half extends right
                function setWidthCentered(newW) {
                    const oldW = el.offsetWidth;
                    const deltaW = newW - oldW;
                    if (deltaW === 0) return;

                    el.style.width = `${newW}px`;
                    n.x -= deltaW / 2;

                    // Apply the compensating shift immediately (no transition) so the
                    // node visually grows/shrinks around its center, not its left edge
                    el.style.transition = 'none';
                    el.style.transform = `translate(${n.x}px, ${n.y}px)`;
                }

                while (iterations < 4) {
                    const w = el.offsetWidth;
                    const h = el.offsetHeight;
                    const currentRatio = w / h;

                    if (Math.abs(currentRatio - 1.25) < 0.05) break;

                    const area = w * h;
                    let targetW = Math.sqrt(area * 1.25);
                    targetW = Math.max(minW, Math.min(targetW, maxW));

                    setWidthCentered(targetW);

                    // Force reflow
                    document.body.offsetHeight;
                    iterations++;
                }

                let q = Math.round(el.offsetWidth / GRID_SIZE);
                let minQ = Math.ceil(minW / GRID_SIZE);
                let maxQ = Math.floor(maxW / GRID_SIZE);

                q = Math.max(minQ, Math.min(q, maxQ));
                let finalW = q * GRID_SIZE;

                setWidthCentered(finalW);   // CHANGED: was el.style.width = `${finalW}px`
                n.nodeWidth = finalW;
            }
        }
    });

    document.body.offsetHeight;

    let placedBounds = [];

    // NEW: in targeted mode, every node OUTSIDE the subtree is a static obstacle.
    // The target's own ancestors are excluded — the subtree is supposed to sit below them.
    let staticObstacles = [];
    if (isTargeted) {
        const affectedIds = new Set(affectedNodes.map(n => n.id));
        const ancestorIds = new Set();
        let cursor = targetNode;
        while (cursor && cursor.parentId && !ancestorIds.has(cursor.parentId)) {
            ancestorIds.add(cursor.parentId);
            cursor = nodes.find(n => n.id === cursor.parentId);
        }

        nodes.filter(n => !n.isVirtual && !affectedIds.has(n.id) && !ancestorIds.has(n.id)).forEach(n => {
            const el = document.getElementById(n.id);
            let w = n.nodeWidth || 380;
            let h = n.nodeHeight || 200;
            if (el && el.style.display !== 'none') {
                w = el.offsetWidth || w;
                h = el.offsetHeight || h;
            }
            staticObstacles.push({
                minX: n.x,
                maxX: n.x + w,
                minY: n.y,
                maxY: n.y + h
            });
        });
    }

    function shiftSubtree(nodeData, deltaX, deltaY) {
        nodeData.x += deltaX;
        nodeData.y += deltaY;
        const children = childrenMap[nodeData.id] || [];
        children.forEach(c => shiftSubtree(c, deltaX, deltaY));
    }

    function getSubtreeBounds(nodeData) {
        let bounds = {
            minX: nodeData.x,
            maxX: nodeData.x + nodeData.nodeWidth,
            minY: nodeData.y,
            maxY: nodeData.y + nodeData.nodeHeight
        };
        const children = childrenMap[nodeData.id] || [];
        children.forEach(c => {
            let cb = getSubtreeBounds(c);
            bounds.minX = Math.min(bounds.minX, cb.minX);
            bounds.maxX = Math.max(bounds.maxX, cb.maxX);
            bounds.minY = Math.min(bounds.minY, cb.minY);
            bounds.maxY = Math.max(bounds.maxY, cb.maxY);
        });
        return bounds;
    }

    roots.forEach(root => {
        calculateSubtreeMetrics(root);

        // CHANGED: targeted mode always anchors the subtree, regardless of preserveRoots
        if (preserveRoots || isTargeted) {
            const originalX = root.x;
            const originalY = root.y;

            placeSubtree(root, 0, 0);

            let deltaX = originalX - root.x;
            let deltaY = originalY - root.y;
            shiftSubtree(root, deltaX, deltaY);

            let bounds = getSubtreeBounds(root);
            // CHANGED: obstacles are previously-placed roots (full layout)
            // or every static node outside the subtree (targeted layout)
            const obstacles = isTargeted ? staticObstacles : placedBounds;
            let hasOverlap = true;
            let safety = 0;
            while (hasOverlap && safety < 100) {
                hasOverlap = false;
                for (let pb of obstacles) {
                    const pad = GRID_SIZE * 4;
                    if (
                        bounds.minX < pb.maxX + pad &&
                        bounds.maxX + pad > pb.minX &&
                        bounds.minY < pb.maxY + pad &&
                        bounds.maxY + pad > pb.minY
                    ) {
                        hasOverlap = true;
                        let shiftAmount = (pb.maxX + pad) - bounds.minX;
                        shiftSubtree(root, shiftAmount, 0);
                        bounds = getSubtreeBounds(root);
                        break;
                    }
                }
                safety++;
            }
            placedBounds.push(bounds);
        } else {
            placeSubtree(root, currentRootX, 200);
            currentRootX += root.subtreeWidth + HORIZONTAL_GAP;
        }
    });

    // CHANGED: global recentering must never run in targeted mode
    if (!preserveRoots && !isTargeted && roots.length > 0) {
        const primaryRoot = roots[0];
        const deltaX = -primaryRoot.x;
        const deltaY = -primaryRoot.y;
        nodes.filter(n => !n.isVirtual).forEach(n => {
            n.x += deltaX;
            n.y += deltaY;
        });
    }

    // CHANGED: only affected nodes are animated into position
    affectedNodes.forEach(nodeData => {
        const el = document.getElementById(nodeData.id);
        if (el) {
            nodeData.y = Math.round(nodeData.y / GRID_SIZE) * GRID_SIZE;

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
        e.preventDefault();
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
                const parentIndex = nodes.findIndex(n => n.id === node.parentId);
                nodes[parentIndex].hasChild = false
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

window.addEventListener('mousemove', (e) => {
    if (isDraggingEdge) {

        let dropTarget = document.elementFromPoint(e.clientX, e.clientY);
        const nodeEl = dropTarget.closest('.node');
        let addNodeBtn = ''
        if (dropTarget && dropTarget.classList.contains('add-child-btn')) {
            addNodeBtn = dropTarget
            if (nodeEl) dropTarget = nodeEl.querySelector('.handle-out');
        } else {
            addNodeBtn = ''
        }

        if (dropTarget && dropTarget.classList.contains('handle')) {
            const targetNodeEl = dropTarget.closest('.node');
            if (targetNodeEl) {
                const targetNodeId = targetNodeEl.id;

                if (dragEdgeType === 'out') {
                    if (dropTarget.classList.contains('handle-out') || targetNodeId === dragEdgeStartNodeId || addNodeBtn) {
                        dropTarget.classList.remove('handle-active')
                        dropTarget.classList.add('handle-inactive')
                        if (addNodeBtn) {
                            addNodeBtn.classList.remove('add-child-btn-active')
                            addNodeBtn.classList.add('add-child-btn-inactive')
                        }
                        return
                    }
                    if (targetNodeId !== dragEdgeStartNodeId) {


                        const startNode = nodes.find(n => n.id === dragEdgeStartNodeId);
                        
                        let nodeIndex = nodes.findIndex(n => n.id === dragEdgeStartNodeId);
                        let parentNodes = new Set()
                        while (nodes[nodeIndex].parentId) {
                            parentNodes.add(nodes[nodeIndex].parentId)
                            nodeIndex = nodes.findIndex(n => n.id === nodes[nodeIndex].parentId)
                        }
                        
                        if ((startNode.type === 'chat' || startNode.type === 'scrape') && startNode.aiText.trim()=='') {
                            dropTarget.classList.remove('handle-active')
                            dropTarget.classList.add('handle-inactive')
                            return
                        }

                        if (parentNodes.has(targetNodeId)) {
                            dropTarget.classList.remove('handle-active')
                            dropTarget.classList.add('handle-inactive')
                            return
                        }
                        dropTarget.classList.add('handle-active')
                    }
                } 
                else if (dragEdgeType === 'in') {
                    
                    if (dropTarget.classList.contains('handle-in') || targetNodeId === dragEdgeStartNodeId) {
                        dropTarget.classList.remove('handle-active')
                        dropTarget.classList.add('handle-inactive')
                        if (addNodeBtn) {
                            addNodeBtn.classList.remove('add-child-btn-active')
                            addNodeBtn.classList.add('add-child-btn-inactive')
                        }
                        return
                    }
                    if (targetNodeId !== dragEdgeStartNodeId) {
                        const targetNode = nodes.find(n => n.id === targetNodeId);
                        
                        let nodeIndex = nodes.findIndex(n => n.id === targetNodeId);
                        let parentNodes = new Set()
                        while (nodes[nodeIndex].parentId) {
                            parentNodes.add(nodes[nodeIndex].parentId)
                            nodeIndex = nodes.findIndex(n => n.id === nodes[nodeIndex].parentId)
                        }
                        
                        if ((targetNode.type === 'chat' || targetNode.type === 'scrape') && targetNode.aiText.trim()=='') {
                            if (addNodeBtn) {
                                addNodeBtn.classList.remove('add-child-btn-active')
                                addNodeBtn.classList.add('add-child-btn-inactive')
                            }
                            dropTarget.classList.remove('handle-active')
                            dropTarget.classList.add('handle-inactive')
                            return
                        }

                        if (parentNodes.has(dragEdgeStartNodeId)) {
                            if (addNodeBtn) {
                                addNodeBtn.classList.remove('add-child-btn-active')
                                addNodeBtn.classList.add('add-child-btn-inactive')
                            }
                            dropTarget.classList.remove('handle-active')
                            dropTarget.classList.add('handle-inactive')
                            return
                        }
                        if (addNodeBtn) {
                            addNodeBtn.classList.add('add-child-btn-active')
                        }
                        dropTarget.classList.add('handle-active')
                    }
                }
            }
        }
    }
})

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
                        const startNode = nodes.find(n => n.id === dragEdgeStartNodeId);
                        
                        if ((startNode.type === 'chat' || startNode.type === 'scrape') && startNode.aiText.trim()=='') {
                            return
                        }
                        
                        let nodeIndex = nodes.findIndex(n => n.id === dragEdgeStartNodeId);
                        let parentNodes = new Set()
                        while (nodes[nodeIndex].parentId) {
                            parentNodes.add(nodes[nodeIndex].parentId)
                            nodeIndex = nodes.findIndex(n => n.id === nodes[nodeIndex].parentId)
                        }

                        if (parentNodes.has(targetNodeId)) return;
                        if (targetNode) {
                            targetNode.parentId = dragEdgeStartNodeId;
                            startNode.hasChild = true
                        }
                    }
                } else if (dragEdgeType === 'in' && dropTarget.classList.contains('handle-out')) {
                    if (targetNodeId !== dragEdgeStartNodeId) {
                        const startNode = nodes.find(n => n.id === dragEdgeStartNodeId);
                        const targetNode = nodes.find(n => n.id === targetNodeId);
                        
                        if ((targetNode.type === 'chat' || targetNode.type === 'scrape') && targetNode.aiText.trim()=='') {
                            return
                        }
                        
                        let nodeIndex = nodes.findIndex(n => n.id === targetNodeId);
                        let parentNodes = new Set()
                        while (nodes[nodeIndex].parentId) {
                            parentNodes.add(nodes[nodeIndex].parentId)
                            nodeIndex = nodes.findIndex(n => n.id === nodes[nodeIndex].parentId)
                        }

                        if (parentNodes.has(dragEdgeStartNodeId)) return;
                        if (startNode) {
                            startNode.parentId = targetNodeId;
                            nodes.find(n => n.id === targetNodeId).hasChild = true
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

    document.getElementById(activeNodeId).querySelector('.node-input').focus()

    updateCanvas();

    setTimeout(() => {
        nodesLayer.style.transition = 'none';
    }, 300);
}

/**
 * Prevent default zooming when mouse as rightclick ontext menu or project files
 */

const preventZoomElements = [
    'context-menu',
    'sandbox-palette'
]

document.addEventListener('wheel', (e) => {
    preventZoomElements.forEach(className => {
        if (e.target.closest('.' + className) && e.ctrlKey) {
            e.preventDefault();
            viewport.dispatchEvent(new WheelEvent('wheel', e));
            return;
        }
    });
}, { passive: false });
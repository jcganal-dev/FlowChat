/**
 * Extracts the current DOM layout, node contents, and camera position, then posts it to the backend to save.
 */
async function saveState() {
    nodes.forEach(n => {
        const el = document.getElementById(n.id);
        if (el) {
            const textarea = el.querySelector('.node-input');
            if (textarea) n.htmlText = textarea.innerHTML;
            n.nodeWidth = el.offsetWidth || n.cachedWidth || n.nodeWidth;
        }
    });

    const state = {
        nodes: nodes,
        groups: groups,
        camera: camera,
        activeNodeId: activeNodeId,
        forkOffsetCounter: forkOffsetCounter
    };

    await apiSaveState(state);
}

/**
 * Fetches the saved state from the backend and rebuilds the conversation tree, nodes, and groups on the canvas.
 * @returns {boolean} True if state was successfully loaded, false otherwise.
 */
async function loadState() {
    const data = await apiLoadState();
    if (!data || data.status === 'empty' || !data.state || !data.state.nodes || data.state.nodes.length === 0) {
        return false;
    }

    const state = data.state;

    nodes = [];
    groups = state.groups || {};
    camera = state.camera || { x: 0, y: 0, zoom: 1 };
    activeNodeId = state.activeNodeId || null;
    forkOffsetCounter = state.forkOffsetCounter || 0;

    nodesLayer.querySelectorAll('.node').forEach(el => el.remove());
    let groupsLayer = $('groups-layer');
    if (groupsLayer) groupsLayer.innerHTML = '';

    state.nodes.forEach(savedNode => {
        if (savedNode.isVirtual) {
            virtualFileNodes[savedNode.id] = savedNode;
            nodes.push(savedNode);
        } else {
            createNode(null, null, null, null, null, null, null, savedNode);
        }
    });

    if (typeof updateCanvas === 'function') updateCanvas();

    if (activeNodeId) selectNode(activeNodeId);
    return true;
}

/**
 * Deletes all nodes and groups from the saved state database and resets the canvas locally.
 */
async function wipeState() {
    if (await window.customConfirm("Are you sure you want to delete all saved nodes and start fresh?")) {
        await apiSaveState({ nodes: [] });
        location.reload();
    }
}

window.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.node-input')) return;

    if (!e.target.closest('#viewport')) return;

    const nodeEl = e.target.closest('.node');
    if (nodeEl) {
        e.preventDefault();
        targetNodeIdForMenu = nodeEl.id;

        const nodeData = nodes.find(n => n.id === targetNodeIdForMenu);
        const groupItem = document.getElementById('menu-group');
        const ungroupItem = document.getElementById('menu-ungroup');

        let allSameGroup = false;
        if (selectedNodes.size > 1) {
            const groupIds = new Set();
            let anyUngrouped = false;
            selectedNodes.forEach(id => {
                const n = nodes.find(x => x.id === id);
                if (n && n.groupId) {
                    groupIds.add(n.groupId);
                } else {
                    anyUngrouped = true;
                }
            });
            allSameGroup = !anyUngrouped && groupIds.size === 1;
        }

        if (selectedNodes.size > 1 && !allSameGroup) {
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
        document.getElementById('menu-open-palette').style.display = 'none';
        document.getElementById('menu-rename').style.display = 'block';
        document.getElementById('menu-rename-node').style.display = 'block';
        document.getElementById('menu-group').style.display = 'block';
        document.getElementById('menu-ungroup').style.display = 'block';

        const summarizeMenu = document.getElementById('menu-summarize');
        const summarizeSelectedMenu = document.getElementById('menu-summarize-selected');
        const deleteSelectedMenu = document.getElementById('menu-delete-selected');

        if (selectedNodes.size > 1) {
            summarizeSelectedMenu.style.display = 'block';
            deleteSelectedMenu.style.display = 'block';
        } else {
            summarizeSelectedMenu.style.display = 'none';
            deleteSelectedMenu.style.display = 'none';
        }

        if (nodeData && (nodeData.type === 'document' || nodeData.type === 'image')) {
            summarizeMenu.style.display = 'none';
        } else {
            summarizeMenu.style.display = 'block';
            const hasSummary = nodeData && nodeData.nodeSummary && nodeData.nodeSummary.trim() !== "";
            const icon = `<img src="${getIconpath('bulb')}" class="file-icon"></img>`
            summarizeMenu.innerHTML = hasSummary ? icon + 'Re-Summarize Node' : icon + 'Summarize Node';
        }

        contextMenu.style.display = 'block';
        contextMenu.style.left = `${e.clientX}px`;
        contextMenu.style.top = `${e.clientY}px`;
    } else {
        e.preventDefault();
        targetNodeIdForMenu = null;
        document.getElementById('menu-add-node').style.display = 'block';
        document.getElementById('menu-add-image').style.display = 'block';
        document.getElementById('menu-add-file').style.display = 'block';
        document.getElementById('menu-open-palette').style.display = 'block';
        document.getElementById('menu-rename').style.display = 'none';
        document.getElementById('menu-rename-node').style.display = 'none';
        document.getElementById('menu-group').style.display = 'none';
        document.getElementById('menu-ungroup').style.display = 'none';
        document.getElementById('menu-summarize').style.display = 'none';
        document.getElementById('menu-summarize-selected').style.display = 'none';
        document.getElementById('menu-delete-selected').style.display = 'none';

        const rect = viewport.getBoundingClientRect();
        contextMenu.dataset.clickX = (e.clientX - rect.left - camera.x) / camera.zoom;
        contextMenu.dataset.clickY = (e.clientY - rect.top - camera.y) / camera.zoom;

        contextMenu.style.display = 'block';
        contextMenu.style.left = `${e.clientX}px`;
        contextMenu.style.top = `${e.clientY}px`;
    }
});

$('menu-open-palette').addEventListener('click', () => {
    contextMenu.style.display = 'none';
    const palette = document.getElementById('sandbox-palette');
    palette.style.display = 'flex';
    palette.style.left = contextMenu.style.left;
    palette.style.top = contextMenu.style.top;
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

window.addEventListener('keydown', (e) => {
    if (e.altKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        if (typeof wipeState === 'function') wipeState();
    } else if (e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        if (typeof autoLayout === 'function') {
            if (e.ctrlKey || e.metaKey) {
                autoLayout(false);
            } else {
                autoLayout(true);
            }
        }
    } else if (e.altKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        if (typeof centerCanvas === 'function') centerCanvas();
    }
});

$('menu-summarize').addEventListener('click', () => {
    contextMenu.style.display = 'none';
    if (targetNodeIdForMenu) {
        triggerSingleSummarize(targetNodeIdForMenu);
    }
});

$('menu-summarize-selected').addEventListener('click', () => {
    contextMenu.style.display = 'none';
    if (selectedNodes.size > 1) {
        selectedNodes.forEach(id => {
            if (typeof triggerSingleSummarize === 'function') triggerSingleSummarize(id);
        });
    }
});

$('menu-delete-selected').addEventListener('click', () => {
    contextMenu.style.display = 'none';
    if (selectedNodes.size > 1) {
        Array.from(selectedNodes).forEach(id => {
            if (typeof deleteNode === 'function') deleteNode(id, false);
        });
        selectedNodes.clear();
    }
});

$('menu-rename-node').addEventListener('click', () => {
    contextMenu.style.display = 'none';
    if (!targetNodeIdForMenu) return;

    const newName = prompt("Enter new base name for this node (e.g., Summary_Node):");
    if (!newName || newName.trim() === "") return;

    const safeName = newName.trim().replace(/\s+/g, '_');

    const nodeData = nodes.find(n => n.id === targetNodeIdForMenu);
    if (!nodeData) return;

    const oldId = nodeData.id;
    nodeData.name = safeName;
    nodeData.id = undefined; // trigger idfy recalculation without the old id
    const newId = idfy(nodeData);

    nodeData.id = newId;

    const el = document.getElementById(oldId);
    if (el) {
        el.id = newId;
        const idLabel = el.querySelector('.node-id');
        if (idLabel) {
            idLabel.textContent = newId;
            idLabel.setAttribute('onclick', `handleIdClick(event, '${newId}')`);
        }
        const toggleBtn = el.querySelector('.toggle-btn');
        if (toggleBtn) {
            toggleBtn.setAttribute('onclick', `event.stopPropagation(); if(typeof toggleNodeState === 'function') toggleNodeState('${newId}')`);
        }
    }

    // Update children's parentId
    nodes.forEach(child => {
        if (child.parentId === oldId) {
            child.parentId = newId;
        }
    });

    if (activeNodeId === oldId) activeNodeId = newId;
    if (selectedNodes.has(oldId)) {
        selectedNodes.delete(oldId);
        selectedNodes.add(newId);
    }

    nodes.forEach(node => {
        let changed = false;
        node.references = node.references.map(ref => {
            if (ref === oldId) {
                changed = true;
                return newId;
            }
            return ref;
        });

        if (changed) {
            const nodeEl = document.getElementById(node.id);
            if (nodeEl) {
                const chips = nodeEl.querySelectorAll('.reference-node');
                chips.forEach(chip => {
                    const oldRef = chip.getAttribute('data-ref');
                    if (oldRef === oldId) {
                        chip.setAttribute('data-ref', newId);
                        chip.setAttribute('data-id', `@${newId}`);
                        const hiddenSpan = chip.querySelector('.ref-text');
                        if (hiddenSpan) {
                            hiddenSpan.textContent = hiddenSpan.textContent.replace(oldId, newId);
                        }
                        const labelSpan = chip.querySelector('.chip-label');
                        if (labelSpan && labelSpan.textContent.includes(oldId)) {
                            labelSpan.textContent = labelSpan.textContent.replace(oldId, newId);
                        }
                    }
                });
            }
        }
    });

    if (typeof drawEdges === 'function') drawEdges();
    if (typeof saveState === 'function') saveState();
});

$('menu-rename').addEventListener('click', () => {
    contextMenu.style.display = 'none';
    if (!targetNodeIdForMenu) return;

    const newName = prompt("Enter new base name for this branch (e.g., Code_Refactor):");
    if (!newName || newName.trim() === "") return;

    const safeName = newName.trim().replace(/\s+/g, '_');

    const nodesToUpdate = [targetNodeIdForMenu, ...getDescendants(targetNodeIdForMenu)];
    const idMap = {};

    nodesToUpdate.forEach(oldId => {
        const nodeData = nodes.find(n => n.id === oldId);
        if (!nodeData) return;

        nodeData.name = safeName;

        if (idMap[nodeData.parentId]) {
            nodeData.parentId = idMap[nodeData.parentId];
        }

        nodeData.id = undefined;
        const newId = idfy(nodeData);

        idMap[oldId] = newId;
        nodeData.id = newId;

        const el = document.getElementById(oldId);
        if (el) {
            el.id = newId;
            const idLabel = el.querySelector('.node-id');
            if (idLabel) {
                idLabel.textContent = newId;
                idLabel.setAttribute('onclick', `handleIdClick(event, '${newId}')`);
            }
            const toggleBtn = el.querySelector('.toggle-btn');
            if (toggleBtn) {
                toggleBtn.setAttribute('onclick', `event.stopPropagation(); if(typeof toggleNodeState === 'function') toggleNodeState('${newId}')`);
            }
        }
    });

    nodes.forEach(node => {
        let changed = false;

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
                const chips = nodeEl.querySelectorAll('.reference-node');
                chips.forEach(chip => {
                    const oldRef = chip.getAttribute('data-ref');
                    if (idMap[oldRef]) {
                        chip.setAttribute('data-ref', idMap[oldRef]);
                        chip.setAttribute('data-id', `@${idMap[oldRef]}`);

                        const hiddenSpan = chip.querySelector('.ref-text');
                        if (hiddenSpan) {
                            hiddenSpan.textContent = hiddenSpan.textContent.replace(oldRef, idMap[oldRef]);
                        }
                    }
                });
            }
        }
    });

    if (typeof drawEdges === 'function') drawEdges();
    if (activeNodeId && idMap[activeNodeId]) {
        selectNode(idMap[activeNodeId]);
    }
});

$('menu-group').addEventListener('click', async () => {
    contextMenu.style.display = 'none';
    if (selectedNodes.size < 2) {
        window.customAlert("Shift-click to select multiple nodes in a lineage first.");
        return;
    }

    const existingGroupIds = new Set();
    selectedNodes.forEach(id => {
        const nodeData = nodes.find(n => n.id === id);
        if (nodeData && nodeData.groupId) {
            existingGroupIds.add(nodeData.groupId);
        }
    });

    if (existingGroupIds.size > 1) {
        window.customAlert("Selected nodes belong to multiple different groups. Please ungroup them first.");
        return;
    }

    let targetGroupId = null;
    if (existingGroupIds.size === 1) {
        targetGroupId = Array.from(existingGroupIds)[0];
    }

    if (targetGroupId) {
        // Add all selected nodes to the existing group
        const group = groups[targetGroupId];
        if (group) {
            selectedNodes.forEach(id => {
                const nodeData = nodes.find(n => n.id === id);
                if (nodeData) {
                    nodeData.groupId = targetGroupId;
                    if (!group.nodes.includes(id)) {
                        group.nodes.push(id);
                    }
                }
            });
        }
    } else {
        const groupResult = await window.customGroupPrompt("Enter a name for this group (e.g., 'Debugging TTS'):", "Group");
        if (!groupResult || !groupResult.name) return;

        const groupName = groupResult.name;
        const groupColor = groupResult.color || '#a0a0a0';

        const groupId = 'group_' + Date.now();
        groups[groupId] = {
            id: groupId,
            name: groupName,
            color: groupColor,
            nodes: Array.from(selectedNodes)
        };

        selectedNodes.forEach(id => {
            const nodeData = nodes.find(n => n.id === id);
            if (nodeData) nodeData.groupId = groupId;
        });
    }

    selectedNodes.clear();
    selectNode(activeNodeId);
    if (typeof saveState === 'function') saveState();
    autoLayout();
});

$('menu-ungroup').addEventListener('click', () => {
    contextMenu.style.display = 'none';
    if (!targetNodeIdForMenu) return;

    const nodeData = nodes.find(n => n.id === targetNodeIdForMenu);
    if (!nodeData || !nodeData.groupId) return;

    const groupId = nodeData.groupId;

    nodes.forEach(n => {
        if (n.groupId === groupId) {
            delete n.groupId;
            const el = document.getElementById(n.id);
            if (el) {
                const colorIndicator = el.querySelector('.node-group-color');
                if (colorIndicator) colorIndicator.style.display = 'none';

                const nodeIdEl = el.querySelector('.node-id');
                if (nodeIdEl) nodeIdEl.style.color = '';
            }
        }
    });

    delete groups[groupId];
    if (typeof drawGroups === 'function') drawGroups();
    if (typeof saveState === 'function') saveState();
});

window.addEventListener('DOMContentLoaded', async () => {
    if (typeof updateCanvas === 'function') updateCanvas();
    if (typeof fetchSandboxFiles === 'function') fetchSandboxFiles();

    const loaded = await loadState();
    if (!loaded) {
        if (typeof createNode === 'function') createNode();
    }
});

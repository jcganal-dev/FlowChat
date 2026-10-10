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

function createNode(parentId = null, x = 408, y = 216, initialUserText = "", turn = 1, branch = 0, name = "Master_Node", restoreData = null, type = "chat") {
    if (restoreData) type = restoreData.type || 'chat';
    const config = { parentId, x, y, initialUserText, turn, branch, name, restoreData, type };
    let nodeInstance;
    if (type === 'image' || type === 'document') nodeInstance = new FileNode(config);
    else if (type === 'tool') nodeInstance = new ToolNode(config);
    else nodeInstance = new ChatNode(config);
    return nodeInstance.id;
}

/**
 * Creates a Chat node with interactive text areas, LLM execution controls, and branching capabilities.
 * @returns {string} The ID of the created Chat node.
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
    labelSpan.innerHTML = chipLabel.replaceAll('_', ' ');
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

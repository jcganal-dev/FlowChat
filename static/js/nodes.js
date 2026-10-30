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

/**
 * Checks if a set of nodes all belong to the same lineage (a single ancestry path).
 * @param {Set<string>} nodeIds - The set of node IDs to check.
 * @returns {boolean} True if they form a single lineage path, false otherwise.
 */
function areNodesInSameLineage(nodeIds) {
    if (nodeIds.size <= 1) return true;

    let deepestNode = null;
    let maxDepth = -1;

    const nodesArray = Array.from(nodeIds).map(id => nodes.find(n => n.id === id)).filter(Boolean);
    if (nodesArray.length !== nodeIds.size) return false;

    nodesArray.forEach(n => {
        let depth = 0;
        let curr = n.parentId;
        while (curr) {
            depth++;
            const parent = nodes.find(x => x.id === curr);
            curr = parent ? parent.parentId : null;
        }
        if (depth > maxDepth) {
            maxDepth = depth;
            deepestNode = n;
        }
    });

    let hitCount = 0;
    let curr = deepestNode ? deepestNode.id : null;
    while (curr) {
        if (nodeIds.has(curr)) hitCount++;
        const n = nodes.find(x => x.id === curr);
        curr = n ? n.parentId : null;
    }

    return hitCount === nodeIds.size;
}

function createNode(parentId = null, x = 0, y = 0, initialUserText = "", turn = 1, branch = 0, name = "Chat_Node", restoreData = null, type = "chat", inheritedModel = null) {
    if (restoreData) type = restoreData.type || 'chat';
    const config = { parentId, x, y, initialUserText, turn, branch, name, restoreData, type, inheritedModel };
    let nodeInstance;
    if (type === 'image' || type === 'document') nodeInstance = new FileNode(config);
    else if (type === 'scrape') nodeInstance = new ScrapeNode(config);
    else nodeInstance = new ChatNode(config);
    // Register the new node on its parent's child id list.
    // When restoring, the parent link comes from the saved data instead of the argument.
    const effectiveParentId = restoreData ? (restoreData.parentId || null) : parentId;
    addChildNodeId(effectiveParentId, nodeInstance.id);
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
            // Children are promoted to the deleted node's parent.
            setNodeParent(child.id, nodeData.parentId);
        });
    }

    // Drop the deleted node from its parent's child id list.
    removeChildNodeId(nodeData.parentId, nodeId);

    // P0 Fix: Abort any in-flight requests for nodes being deleted
    idsToRemove.forEach(id => {
        const nodeToDelete = nodes.find(n => n.id === id);
        if (nodeToDelete && nodeToDelete.abortController) {
            nodeToDelete.abortController.abort();
            nodeToDelete.abortController = null;
        }
        // P0 Fix: Call cleanup on node instance to remove event listeners
        const el = document.getElementById(id);
        if (el && el.__nodeInstance && typeof el.__nodeInstance.cleanup === 'function') {
            el.__nodeInstance.cleanup();
        }
    });

    idsToRemove.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
        nodes = nodes.filter(n => n.id !== id);
    });

    // Clean up groups: remove deleted node IDs from group nodes arrays
    // and delete any groups that are now empty
    const idsToRemoveSet = new Set(idsToRemove);
    Object.keys(groups).forEach(groupId => {
        const group = groups[groupId];
        if (group && Array.isArray(group.nodes)) {
            // Filter out deleted nodes
            group.nodes = group.nodes.filter(nid => !idsToRemoveSet.has(nid));
            // If group is now empty, delete it
            if (group.nodes.length === 0) {
                delete groups[groupId];
            }
        }
    });

    if (idsToRemove.includes(activeNodeId)) {
        if (nodeData.parentId && nodes.find(n => n.id === nodeData.parentId)) {
            selectNode(nodeData.parentId);
        } else if (nodes.length > 0) {
            selectNode(nodes[nodes.length - 1].id);
        } else {
            activeNodeId = null;
            edgesLayer.innerHTML = '';
        }
    } else {
        selectNode(activeNodeId);
    }
    if (nodes.length === 0) {
        setTimeout(() => {
            selectNode(createNode(null, 0, 0));
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
                // console.warn("Cannot group: Nodes must be in the same direct lineage.");
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

    current_active_lineage = Array.from(lineage).reverse()

    document.querySelectorAll('.node').forEach(el => {
        el.classList.toggle('active-branch', lineage.has(el.id));
        const isMulti = selectedNodes.has(el.id) && (selectedNodes.size > 1 || el.id !== activeNodeId || shiftSelectionStartId === el.id);
        el.classList.toggle('multi-selected', isMulti);
    });

    if (typeof drawEdges === 'function') drawEdges(lineage);
}

/**
 * Injects a visual @reference chip into a contenteditable textarea at the current cursor range.
 * @param {HTMLElement} textarea - The target text area.
 * @param {Range} range - The selection range where the chip will be inserted.
 * @param {string} refId - The target ID of the node or group being referenced.
 * @param {boolean} isGroup - True if the reference is pointing to a group of nodes.
 */
function insertChipAtRange(textarea, range, refId, isGroup, prebuilt = null) {
    let refText = '';
    let chipLabel = '';
    let isFile = false

    if (isGroup) {
        if (!groups[refId]) return false;
        const groupObj = groups[refId];
        const gNodes = nodes.filter(n => n.groupId === refId);
        chipLabel = `<span style="color:${groupObj.color};">${groupIcon(groupObj.color)} ${groupObj.name}</span>`;
        gNodes.forEach((n, idx) => {
            if (n.aiText && n.aiText.trim() !== '') {
                refText += `[NODE_${idx}]\nUSER: ${n.userText}\nAssistant: ${nodeAnswerText(n)}\n\n`;
            }
        });

        // Image and document nodes hold no text of their own, so list them here
        // to make the attachment visible in the reference. The payloads
        // themselves are resolved when the prompt is sent (resolveReferencePayload).
        gNodes.forEach((n, idx) => {
            if (!n.files || n.files.length === 0) return;
            if (n.type === 'image') {
                refText += `[NODE_${idx}] IMAGE ATTACHED: ${n.files.map(f => f.name || 'Image').join(', ')}\n\n`;
            } else if (n.type === 'document') {
                refText += `[NODE_${idx}] DOCUMENT ATTACHED: ${n.files.map(f => f.name || 'Document').join(', ')}\n\n`;
            }
        });

        if (!refText) return false;
    } else if (prebuilt) {
        // Prebuilt sandbox-file chip: the caller resolved the file content
        // itself, so no virtual node needs to exist in the nodes array.
        chipLabel = prebuilt.chipLabel;
        refText = prebuilt.refText;
        isFile = true;
    } else {
        const refData = nodes.find(n => n.id === refId);
        if (!refData) return false;
        const color = refData.groupId?groups[refData.groupId].color:undefined;
        let reficon = chatIcon(color)
        switch (refData.type) {
            case 'image':
                reficon = imageIcon(color)
                break
            case 'document':
                reficon = documentIcon(color)
                break
            case 'scrape':
                reficon = scrapeIcon(color)
                break
            default:
                reficon = chatIcon(color)
                break
        }
        if (refData.type === 'image' && refData.files && refData.files.length > 0) {
            chipLabel = `${reficon} ${refId}`;
            refText = `[IMAGE_ATTACHED: ${refData.files.map(f => f.name).join(', ')}]`;
            isFile = true
        } else if (refData.type === 'document' && refData.files && refData.files.length > 0) {
            const filename = refData.files[0].name;
            if (refData.files.length > 1) {
                chipLabel = `${reficon} ${refId}`;
                refText = `[DOCUMENT_ATTACHED: ${refData.files.map(f => {f.name;console.log(f.name)}).join(', ')}]`;
            } else {
                chipLabel = `${reficon} ${refId}`;
                refText = `[DOCUMENT_ATTACHED: ${refData.files[0].name}`;
            }
            isFile = true
        } else if (refData.isCollapsed && refData.summaryText && refData.summaryText !== "Summary unavailable.") {
            chipLabel = `Summary of ${reficon} ${refId}`;
            refText = `SUMMARY: ${refData.summaryText}`;
        } else if (refData.type === 'scrape') {
            if (!refData.aiText || refData.aiText.trim() === '') return false;
            chipLabel = `${reficon} ${refId}`;
            refText = `USER: ${refData.userText} \n Assistant: ${nodeAnswerText(refData)}`;
        } else {
            if (!refData.aiText || refData.aiText.trim() === '') return false;
            chipLabel = `${reficon} ${refId}`;
            refText = `USER: ${refData.userText} \n Assistant: ${nodeAnswerText(refData)}`;
        }
    }

    const chip = document.createElement('span');
    chip.className = 'reference-node';
    chip.contentEditable = 'false';
    chip.setAttribute('data-id', chipLabel);
    chip.setAttribute('data-ref', refId);

    const labelSpan = document.createElement('span');
    labelSpan.className = 'ref-label';
    labelSpan.innerHTML = isFile ? chipLabel : chipLabel.replaceAll('_', ' ');
    chip.appendChild(labelSpan);

    const hiddenText = document.createElement('span');
    hiddenText.className = 'ref-text';
    hiddenText.textContent = `\n\n[START CONTEXT FROM ${refId}]:\n${refText}\n[END CONTEXT]\n\n`;
    chip.appendChild(hiddenText);

    range.deleteContents();
    range.insertNode(chip);

    range.setStartAfter(chip);
    range.setEndAfter(chip);

    // const spaceNode = document.createTextNode('\u00A0');
    // range.insertNode(spaceNode);
    // range.setStartAfter(spaceNode);
    // range.setEndAfter(spaceNode);

    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    lastSelectionRange = range.cloneRange();
    textarea.dispatchEvent(new Event('input'));
    textarea.focus();

    return true;
}

/**
 * Resolves a reference target into the content it contributes to a prompt.
 * A reference can point at a single node or at a whole group of nodes; a group
 * expands to its member nodes so attached images and documents travel with it.
 * @param {string} refId - The id of the referenced node or group.
 * @returns {{text: string[], images: Array<Object>}} Text directives and image attachments.
 */
async function resolveReferencePayload(refId) {
    const payload = { text: [], images: [] };

    const collectNode = (n, label) => {
        if (!n) return;
        if (n.type === 'image') {
            if (!n.files || n.files.length === 0) return;
            n.files.forEach(f => {
                if (f.payload) payload.images.push({ type: "image_url", image_url: { url: f.payload } });
            });
            payload.text.push(`${label}[IMAGE ATTACHED: ${n.files.map(f => f.name || 'Image').join(', ')}]`);
        } else if (n.type === 'document') {
            if (!n.files || n.files.length === 0) return;
            n.files.forEach(f => {
                payload.text.push(`${label}[DOCUMENT ATTACHED: ${f.name || 'Document'}]\n${f.payload}`);
            });
        } else if (n.type === 'chat' || !n.type) {
            payload.text.push(`${label}Rule: ${n.userText || ''}\nStatus: ${n.aiText || ''}`);
        }
    };

    if (groups[refId]) {
        // The chat text of a group is already embedded in the reference chip,
        // so only the attached files are collected here.
        nodes.filter(n => n.groupId === refId).forEach((n, idx) => {
            if (n.type === 'image' || n.type === 'document') collectNode(n, `[NODE_${idx}] `);
        });
    } else {
        const n = nodes.find(x => x.id === refId);
        if (n) {
            collectNode(n, '');
        } else if (refId.startsWith('sandbox/')) {
            // Sandbox file chips are self-contained — document content lives in
            // the chip text itself. Only image payloads (and legacy payloads
            // from old saves) need resolving here.
            const cached = fileRefCache[refId];
            if (cached && cached.type === 'image' && cached.files) {
                cached.files.forEach(f => {
                    if (f.payload) payload.images.push({ type: "image_url", image_url: { url: f.payload } });
                });
                payload.text.push(`[IMAGE ATTACHED: ${cached.files.map(f => f.name || 'Image').join(', ')}]`);
            } else if (!cached && !refId.endsWith('/*') && refId.slice('sandbox/'.length).match(imageWhitelist)) {
                // Image content can't be inlined in chip text, so refetch the
                // payload when no cache entry exists (e.g. after a reload).
                const path = refId.slice('sandbox/'.length);
                const res = await apiFetchSandboxFile(path);
                if (res) {
                    const blob = await res.blob();
                    const dataUrl = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.readAsDataURL(blob);
                    });
                    payload.images.push({ type: "image_url", image_url: { url: dataUrl } });
                    payload.text.push(`[IMAGE ATTACHED: ${path}]`);
                }
            }
        }
    }

    return payload;
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
            // Defensive: re-capture the live cursor position right before inserting.
            // The stored range can go stale (e.g., the user moved the cursor or typing
            // advanced the selection), which would drop the chip at a wrong spot.
            const sel = window.getSelection();
            if (sel.rangeCount && lastFocusedInput.contains(sel.anchorNode)) {
                lastSelectionRange = sel.getRangeAt(0).cloneRange();
            }
            inserted = insertChipAtRange(lastFocusedInput, lastSelectionRange, id, isGroup);
        }

        if (inserted) {
            event.stopPropagation();
        }
        // If not inserted, we intentionally do nothing and do NOT stop propagation.
        // This lets the click event bubble up to `.node` which will naturally trigger
        // lineage selection via `selectNode(el.id, e.shiftKey)`.
    }
}

document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (sel.rangeCount > 0 && lastFocusedInput && lastFocusedInput.contains(sel.anchorNode)) {
        lastSelectionRange = sel.getRangeAt(0).cloneRange();
    }
});
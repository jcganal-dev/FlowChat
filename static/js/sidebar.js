// Context menu for sandbox files
const sandboxContextMenu = document.createElement('div');
sandboxContextMenu.id = 'sandbox-context-menu';
sandboxContextMenu.className = 'context-menu'; // Use same styling but unique ID
sandboxContextMenu.style.cssText = `
    position: absolute;
    background: var(--bg-base, #1e1e2e);
    border: 1px solid var(--border-strong, #444);
    border-radius: 6px;
    padding: 5px 0;
    box-shadow: 0 4px 12px var(--shadow-md, rgba(0, 0, 0, 0.5));
    z-index: 20000;
    display: none;
    color: var(--text-secondary, #eee);
`;
sandboxContextMenu.innerHTML = `<div class="context-item" id="menu-delete-sandbox-file"><img src="/static/icons/trash.svg" class="file-icon"> Delete File</div>`;
document.body.appendChild(sandboxContextMenu);

let targetSandboxFile = null;
let selectedSandboxFiles = new Set();
let lastSelectedSandboxFileIndex = -1;
// Paths of the rows currently rendered in a tree, in visual (DFS) order — the
// basis for Shift-range selection. Collapsed folders are not rendered, so this
// holds the visible subset; allSandboxPaths holds everything the last fetch
// returned and is what existence checks use.
let currentSandboxFiles = [];
let allSandboxPaths = new Set();

// Folders build their children only once expanded (lazy) and start collapsed,
// so a sandbox with tens of thousands of files only ever pays for the rows on
// screen. Persisted so expansion survives a reload.
let expandedSandboxFolders = new Set(JSON.parse(localStorage.getItem('expandedSandboxFolders') || '[]'));

function saveExpandedSandboxFolders() {
    localStorage.setItem('expandedSandboxFolders', JSON.stringify(Array.from(expandedSandboxFolders)));
}

/**
 * Expands `path` and every folder above it, so a folder that was just created,
 * uploaded into, or dropped into is actually reachable in a collapsed tree.
 * @param {string} path - Sandbox-relative folder path.
 */
function expandSandboxFoldersTo(path) {
    if (!path) return;
    const parts = path.split('/');
    let currentPath = '';
    for (const part of parts) {
        currentPath += (currentPath ? '/' : '') + part;
        expandedSandboxFolders.add(currentPath);
    }
    saveExpandedSandboxFolders();
}

function updateSidebarSelection() {
    const tree = document.getElementById('file-tree');
    if (!tree) return;
    const items = tree.querySelectorAll('.file-item');
    items.forEach((item) => {
        const filepath = item.dataset.path;
        if (filepath && selectedSandboxFiles.has(filepath)) {
            item.style.background = 'rgba(255, 255, 255, 0.15)';
        } else {
            item.style.background = '';
        }
    });
}

document.getElementById('menu-delete-sandbox-file').addEventListener('click', async (e) => {
    e.stopPropagation();
    sandboxContextMenu.style.display = 'none';

    if (selectedSandboxFiles.size === 0 && targetSandboxFile) {
        selectedSandboxFiles.add(targetSandboxFile);
    }

    if (selectedSandboxFiles.size === 0) return;

    const fileCount = selectedSandboxFiles.size;
    const msg = fileCount === 1
        ? `Are you sure you want to delete ${Array.from(selectedSandboxFiles)[0]}?`
        : `Are you sure you want to delete ${fileCount} files?`;

    const filesToDelete = Array.from(selectedSandboxFiles);

    if (await window.customConfirm(msg)) {
        let allSuccess = true;
        for (const filepath of filesToDelete) {
            const success = await apiDeleteSandboxFile(filepath);
            if (!success) allSuccess = false;
        }
        if (allSuccess) {
            selectedSandboxFiles.clear();
            lastSelectedSandboxFileIndex = -1;
            refreshSandboxTrees();
        } else {
            window.customAlert('Failed to delete one or more files.');
        }
    }
});

document.addEventListener('click', (e) => {
    sandboxContextMenu.style.display = 'none';
    const palette = document.getElementById('sandbox-palette');
    const focusTree = document.getElementById('focus-file-tree');
    const inPalette = palette && palette.contains(e.target);
    const inFocusTree = focusTree && focusTree.contains(e.target);
    if (!inPalette && !inFocusTree && selectedSandboxFiles.size > 0) {
        selectedSandboxFiles.clear();
        lastSelectedSandboxFileIndex = -1;
        updateSidebarSelection();
        if (typeof updateFocusFileSelection === 'function') updateFocusFileSelection();
    }
});

// --- Sandbox tree rendering -------------------------------------------------
//
// Both trees (the floating sidebar palette and focus mode) render through the
// functions below. Folders are lazy: children are built the first time a folder
// is expanded, and folders start collapsed, so a sandbox holding tens of
// thousands of files only ever pays for the rows that are on screen.

const SANDBOX_CHEVRON_DOWN = '<img src="/static/icons/chevron-down.svg" class="file-icon">';
const SANDBOX_CHEVRON_RIGHT = '<img src="/static/icons/chevron-right.svg" class="file-icon">';

let sandboxDataPromise = null;

/**
 * Fetches the sandbox listing, sharing one in-flight request between callers so
 * refreshing both trees costs a single round trip.
 * @returns {Promise<Object|null>} {items, files} payload, or null on failure.
 */
function loadSandboxFileData() {
    if (!sandboxDataPromise) {
        sandboxDataPromise = (async () => {
            const data = await apiFetchSandboxFiles();
            if (data) {
                const items = data.items || (data.files || []).map(f => ({ path: f, type: 'file' }));
                allSandboxPaths = new Set(items.map(i => i.path));
            }
            return data;
        })().finally(() => { sandboxDataPromise = null; });
    }
    return sandboxDataPromise;
}

/**
 * Turns a flat listing into the nested {name, path, type, children} model the
 * renderer walks.
 * @param {Array} items - [{path, type}] entries from the backend.
 * @returns {Object} Root model node.
 */
function buildSandboxTreeModel(items) {
    const sRoot = { name: 'Sandbox (S:)', path: '', type: 'directory', children: {}, isSandboxRoot: true };
    const treeRoot = { name: '', path: '', type: 'directory', children: { 'S:/': sRoot } };

    items.forEach(item => {
        const parts = item.path.split('/');
        let current = sRoot;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!current.children[parts[i]]) {
                current.children[parts[i]] = { name: parts[i], path: parts.slice(0, i + 1).join('/'), type: 'directory', children: {} };
            }
            current = current.children[parts[i]];
        }
        const name = parts[parts.length - 1];
        if (item.type === 'directory') {
            if (!current.children[name]) {
                current.children[name] = { name, path: item.path, type: 'directory', children: {} };
            }
        } else {
            current.children[name] = { name, path: item.path, type: 'file' };
        }
    });

    return treeRoot;
}

// Root-level drops are wired once per container. Doing it inside the render
// stacked another pair of listeners on the tree on every single refresh.
const sandboxRootDropWired = new WeakSet();

function wireSandboxTreeRoot(container) {
    if (sandboxRootDropWired.has(container)) return;
    sandboxRootDropWired.add(container);

    container.addEventListener('dragover', (e) => e.preventDefault());
    container.addEventListener('drop', async (e) => {
        // Item drops call stopPropagation, so reaching here means the drop
        // landed on empty space in the tree: move the files to the sandbox root.
        e.preventDefault();
        const raw = e.dataTransfer.getData('text/plain');
        try {
            const paths = JSON.parse(raw);
            if (!Array.isArray(paths)) return;
            const itemsToMove = paths.filter(p => p.includes('/'));
            if (itemsToMove.length === 0) return;
            const success = await apiMoveSandboxFiles(itemsToMove, "");
            if (success) {
                selectedSandboxFiles.clear();
                refreshSandboxTrees();
            }
        } catch (err) { }
    });
}

/** Repaints the selection highlight in every tree on screen. */
function updateSandboxSelection() {
    updateSidebarSelection();
    if (typeof updateFocusFileSelection === 'function') updateFocusFileSelection();
}

/**
 * Renders a sandbox tree into `container`, rebuilding only the rows that are
 * visible: a collapsed folder costs one row no matter how much is inside it.
 * @param {HTMLElement} container - #file-tree or #focus-file-tree.
 * @param {Object} data - Listing payload from loadSandboxFileData().
 * @param {Function} onSelectionChange - Repaints this tree's selection highlight.
 */
function renderSandboxTree(container, data, onSelectionChange) {
    const items = data.items || (data.files || []).map(f => ({ path: f, type: 'file' }));
    const treeRoot = buildSandboxTreeModel(items);
    const scrollTop = container.scrollTop;

    container.innerHTML = '';
    currentSandboxFiles = [];   // rebuilt below, in visual order, for rendered rows

    function sortChildren(node) {
        return Object.values(node.children).sort((a, b) => {
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
    }

    // Collects the rendered paths into `out` in DFS order, so Shift-range
    // selection walks exactly the rows the user can see.
    function renderChildren(node, parentEl, depth, out) {
        sortChildren(node).forEach(child => renderItem(child, parentEl, depth, out));
    }

    function renderItem(child, parentEl, depth, out) {
        const itemWrapper = document.createElement('div');
        itemWrapper.className = 'tree-item-wrapper';

        const item = document.createElement('div');
        item.className = 'file-item';
        item.style.paddingLeft = `${depth * 16 + 8}px`;
        item.style.paddingTop = '4px';
        item.style.paddingBottom = '4px';
        item.style.paddingRight = '8px';
        item.style.borderRadius = '4px';
        item.style.cursor = 'pointer';

        const filepath = child.path;
        item.dataset.path = filepath;
        out.push(filepath);
        const index = out.length - 1;

        let childrenContainer = null;

        if (child.type === 'directory') {
            // The sandbox root always renders — it is the only way in.
            const expanded = child.isSandboxRoot || expandedSandboxFolders.has(filepath);
            item.innerHTML = `<span class="chevron" style="display:inline-block; width:12px; font-size:10px;">${expanded ? SANDBOX_CHEVRON_DOWN : SANDBOX_CHEVRON_RIGHT}</span><img src="/static/icons/folder.svg" class="file-icon"><span class='file-item-name'>${child.name}</span>`;

            childrenContainer = document.createElement('div');
            childrenContainer.className = 'folder-children';
            if (expanded) {
                childrenContainer.dataset.rendered = '1';
                renderChildren(child, childrenContainer, depth + 1, out);
            } else {
                childrenContainer.style.display = 'none';
            }

            itemWrapper.appendChild(item);
            itemWrapper.appendChild(childrenContainer);
        } else {
            item.innerHTML = `<span style="display:inline-block; width:12px;"></span> <img class="file-icon" src="${getIconpath(child.name)}"><span class='file-item-name'>${child.name}</span>`;
            item.title = 'Double-click to open. Shift+Click in textbox to reference.';

            item.addEventListener('dblclick', () => {
                window.open('/sandbox/' + filepath, '_blank');
            });

            itemWrapper.appendChild(item);
        }

        parentEl.appendChild(itemWrapper);

        /** Expands or collapses this folder, building its children on first expand. */
        function setFolderExpanded(expand) {
            if (!childrenContainer) return;
            if (expand) {
                if (!childrenContainer.dataset.rendered) {
                    const added = [];
                    renderChildren(child, childrenContainer, depth + 1, added);
                    childrenContainer.dataset.rendered = '1';
                    // Slot the new paths in right after their folder so the visual
                    // order Shift-range selection relies on stays correct.
                    const at = currentSandboxFiles.indexOf(filepath);
                    if (at === -1) currentSandboxFiles.push(...added);
                    else currentSandboxFiles.splice(at + 1, 0, ...added);
                }
                childrenContainer.style.display = 'block';
                item.querySelector('.chevron').innerHTML = SANDBOX_CHEVRON_DOWN;
                expandedSandboxFolders.add(filepath);
            } else {
                childrenContainer.style.display = 'none';
                item.querySelector('.chevron').innerHTML = SANDBOX_CHEVRON_RIGHT;
                expandedSandboxFolders.delete(filepath);
            }
            saveExpandedSandboxFolders();
        }

        // --- Shared events for selection, drag/drop, and context menu ---

        // Prevent text-selection on modifier clicks
        item.addEventListener('mousedown', (e) => {
            if (child.isSandboxRoot) return;
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                e.preventDefault();
            }
        });

        // Drag-over / drag-leave for move targets
        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            item.style.backgroundColor = 'var(--bg-hover)';
        });
        item.addEventListener('dragleave', () => {
            item.style.backgroundColor = selectedSandboxFiles.has(filepath) ? 'rgba(255, 255, 255, 0.15)' : '';
        });

        // Drop to move files between folders
        item.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            item.style.backgroundColor = '';
            const data = e.dataTransfer.getData('text/plain');
            try {
                const paths = JSON.parse(data);
                let targetDir = child.type === 'directory' ? filepath : (filepath.includes('/') ? filepath.substring(0, filepath.lastIndexOf('/')) : "");

                // Prevent moving into itself or its own subdirectories
                if (paths.some(p => targetDir === p || targetDir.startsWith(p + '/'))) {
                    return;
                }
                const success = await apiMoveSandboxFiles(paths, targetDir);
                if (success) {
                    expandSandboxFoldersTo(targetDir);
                    selectedSandboxFiles.clear();
                    refreshSandboxTrees();
                }
            } catch (err) { }
        });

        // Drag start
        item.draggable = !child.isSandboxRoot;
        item.addEventListener('dragstart', (e) => {
            if (child.isSandboxRoot) { e.preventDefault(); return; }
            if (!selectedSandboxFiles.has(filepath)) {
                selectedSandboxFiles.clear();
                selectedSandboxFiles.add(filepath);
                lastSelectedSandboxFileIndex = index;
                onSelectionChange();
            }
            e.dataTransfer.setData('text/plain', JSON.stringify(Array.from(selectedSandboxFiles)));
            e.dataTransfer.effectAllowed = 'copy';
        });
        item.addEventListener('dragend', () => {
            selectedSandboxFiles.clear();
            lastSelectedSandboxFileIndex = -1;
            updateSandboxSelection();
        });

        // Context menu (right-click)
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (child.isSandboxRoot) return;
            if (!selectedSandboxFiles.has(filepath)) {
                selectedSandboxFiles.clear();
                selectedSandboxFiles.add(filepath);
                lastSelectedSandboxFileIndex = index;
                onSelectionChange();
            }
            targetSandboxFile = filepath;

            const delMenu = document.getElementById('menu-delete-sandbox-file');
            if (delMenu) {
                delMenu.innerHTML = selectedSandboxFiles.size > 1 ? `<img src="/static/icons/trash.svg" class="file-icon"> Delete ${selectedSandboxFiles.size} Items` : `<img src="/static/icons/trash.svg" class="file-icon"> Delete`;
            }

            const ctxMenu = document.getElementById('sandbox-context-menu') || (typeof sandboxContextMenu !== 'undefined' ? sandboxContextMenu : null);
            if (ctxMenu) {
                ctxMenu.style.display = 'block';
                ctxMenu.style.left = `${e.clientX}px`;
                ctxMenu.style.top = `${e.clientY}px`;
            }
        });

        // Click handler: reference insertion OR selection / folder toggle
        item.addEventListener('click', (e) => {
            // If an input is focused and Shift is held, insert a reference chip
            if (e.shiftKey && lastFocusedInput) {
                e.preventDefault();
                handleSandboxFileShiftClick(filepath);
                return;
            }

            // Directory toggle (plain click only)
            if (child.type === 'directory' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                e.stopPropagation();
                setFolderExpanded(!expandedSandboxFolders.has(filepath));
            }

            if (child.isSandboxRoot) return;

            // Shift+Click range selection
            if (e.shiftKey) {
                if (lastSelectedSandboxFileIndex === -1) {
                    selectedSandboxFiles.add(filepath);
                    lastSelectedSandboxFileIndex = index;
                } else {
                    const visibleItems = Array.from(container.querySelectorAll('.file-item'))
                        .filter(el => el.offsetParent !== null)
                        .map(el => el.dataset.path);
                    const lastPath = currentSandboxFiles[lastSelectedSandboxFileIndex];
                    const startIndex = visibleItems.indexOf(lastPath);
                    const endIndex = visibleItems.indexOf(filepath);

                    if (startIndex !== -1 && endIndex !== -1) {
                        const start = Math.min(startIndex, endIndex);
                        const end = Math.max(startIndex, endIndex);
                        selectedSandboxFiles.clear();
                        for (let i = start; i <= end; i++) {
                            selectedSandboxFiles.add(visibleItems[i]);
                        }
                    } else {
                        selectedSandboxFiles.add(filepath);
                    }
                }
            } else if (e.ctrlKey || e.metaKey) {
                // Ctrl/Cmd toggle
                if (selectedSandboxFiles.has(filepath)) {
                    selectedSandboxFiles.delete(filepath);
                } else {
                    selectedSandboxFiles.add(filepath);
                    lastSelectedSandboxFileIndex = index;
                }
            } else {
                // Plain click — single select
                selectedSandboxFiles.clear();
                selectedSandboxFiles.add(filepath);
                lastSelectedSandboxFileIndex = index;
            }
            onSelectionChange();
        });
    }

    renderChildren(treeRoot, container, 0, currentSandboxFiles);
    wireSandboxTreeRoot(container);
    container.scrollTop = scrollTop;
    onSelectionChange();
}

/**
 * Fetches the sandbox listing and renders the sidebar palette tree, clearing the
 * current selection. Callers that must keep the selection use
 * refreshSandboxTrees() (watcher.js) instead.
 */
async function fetchSandboxFiles() {
    const data = await loadSandboxFileData();
    if (!data) return;

    const tree = document.getElementById('file-tree');
    if (!tree) return;

    selectedSandboxFiles.clear();
    lastSelectedSandboxFileIndex = -1;
    renderSandboxTree(tree, data, updateSidebarSelection);
}

async function promptCreateFolder() {
    const folderName = await window.customPrompt(message = 'Enter new folder name:', defaultValue = 'New Folder', title = 'Create Folder');
    if (!folderName) return;

    let targetDir = "";
    if (selectedSandboxFiles.size > 0) {
        const selectedPath = Array.from(selectedSandboxFiles)[0];
        const el = document.querySelector(`.file-item[data-path="${CSS.escape(selectedPath)}"]`);
        if (el) {
            const isFolder = el.innerHTML.includes('folder.svg');
            if (isFolder) {
                targetDir = selectedPath;
            } else {
                const parts = selectedPath.split('/');
                parts.pop();
                targetDir = parts.join('/');
            }
        }
    }

    const finalFolderName = targetDir ? `${targetDir}/${folderName}` : folderName;

    const success = await apiCreateSandboxFolder(finalFolderName);
    if (success) {
        // Reveal the folder it was created in; the new folder itself starts
        // collapsed like any other.
        expandSandboxFoldersTo(targetDir);
        refreshSandboxTrees();
    } else {
        window.customAlert('Failed to create folder.');
    }
}

/**
 * Uploads user-selected local files to the backend sandbox directory.
 * @param {Event} event - The file input change event containing the selected files.
 */
async function uploadSandboxFiles(event) {
    const files = event.target.files;
    if (!files.length) return;

    let targetDir = "";
    if (selectedSandboxFiles.size > 0) {
        const selectedPath = Array.from(selectedSandboxFiles)[0];
        const el = document.querySelector(`.file-item[data-path="${CSS.escape(selectedPath)}"]`);
        if (el) {
            const isFolder = el.innerHTML.includes('folder.svg');
            if (isFolder) {
                targetDir = selectedPath;
            } else {
                const parts = selectedPath.split('/');
                parts.pop();
                targetDir = parts.join('/');
            }
        }
    }

    const formData = new FormData();
    for (let file of files) {
        // Use webkitRelativePath to maintain folder structure if uploading a folder
        let filename = file.webkitRelativePath || file.name;
        if (targetDir) {
            filename = targetDir + '/' + filename;
        }
        formData.append('files', file, filename);
    }

    const success = await apiUploadSandboxFiles(formData);
    if (success) {
        // Show the destination folder (uploaded folders stay collapsed inside it)
        expandSandboxFoldersTo(targetDir);
        refreshSandboxTrees();
    } else {
        window.customAlert('Upload failed!');
    }
    event.target.value = '';
}

/**
 * Builds a self-contained reference chip from a sandbox file payload. Document
 * content is inlined into the chip text itself (no virtual node is created);
 * image payloads go into fileRefCache so resolveReferencePayload can attach
 * them at send time.
 * @param {string} name - The sandbox file path.
 * @param {string} payload - The file's text content or image data URL.
 * @returns {Object} Chip data for insertChipAtRange's prebuilt parameter.
 */
function sandboxChipFromPayload(name, payload) {
    const virtualId = 'sandbox/' + name;
    const chipLabel = `<img src="${getIconpath(name)}" class='file-icon'> ${virtualId}`;
    if (name.match(imageWhitelist)) {
        fileRefCache[virtualId] = { type: 'image', files: [{ name: name, payload: payload }] };
        return { id: virtualId, chipLabel: chipLabel, refText: `[IMAGE_ATTACHED: ${name}]` };
    }
    return {
        id: virtualId,
        chipLabel: chipLabel,
        refText: `[DOCUMENT_ATTACHED: ${name}]\n--- START OF ${name} ---\n${payload}\n--- END OF ${name} ---`
    };
}

/**
 * Fetches a sandbox file and builds its self-contained reference chip data.
 * @param {string} filepath - The sandbox file path.
 * @returns {Promise<Object|null>} Chip data, or null if the fetch or type check fails.
 */
async function buildSandboxChipData(filepath) {
    const res = await apiFetchSandboxFile(filepath);
    if (!res) return null;
    let payload;
    if (filepath.match(imageWhitelist)) {
        const blob = await res.blob();
        payload = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    } else {
        payload = await res.text();
    }
    return sandboxChipFromPayload(filepath, payload);
}

/**
 * Handles shift-clicking on a sandbox file in the sidebar.
 * Builds a self-contained reference chip (content inlined, no virtual node) and injects it into the active text area.
 * @param {string} filepath - The name of the sandbox file.
 */
async function handleSandboxFileShiftClick(filepath) {
    if (!lastFocusedInput) {
        const focusInput = document.getElementById('focus-chat-input');
        const focusBg = document.getElementById('focus-bg');
        if (focusBg && focusBg.style.display !== 'none' && focusInput) {
            lastFocusedInput = focusInput;
        } else {
            return;
        }
    }

    if (lastFocusedInput.contentEditable === 'false' || lastFocusedInput.getAttribute('contenteditable') === 'false') {
        // window.customAlert('Cannot add references to a finished node!');
        return;
    }

    const selection = window.getSelection();
    let range;

    if (selection.rangeCount > 0 && lastFocusedInput.contains(selection.getRangeAt(0).commonAncestorContainer)) {
        range = selection.getRangeAt(0);
    } else {
        range = document.createRange();
        range.selectNodeContents(lastFocusedInput);
        range.collapse(false);
    }

    // Try to fetch the specific file directly — avoids a full sandbox listing
    // round trip for the common single-file case.
    const directRes = await apiFetchSandboxFile(filepath);

    if (directRes && directRes.ok) {
        // It's a file (not a folder). Build the chip directly.
        const isImage = filepath.match(imageWhitelist);
        const isText = textWhitelist.test(filepath) || exactNameWhitelist.test(filepath);

        if (!isImage && !isText) {
            window.customAlert('Unsupported file type. Please select a text-based file or an image.');
            return;
        }

        const chipData = await buildSandboxChipData(filepath);
        if (!chipData) {
            window.customAlert('Failed to load file content.');
            return;
        }

        if (typeof insertChipAtRange === 'function') insertChipAtRange(lastFocusedInput, range, chipData.id, false, chipData);
        return;
    }

    // If direct fetch failed (404), it might be a folder — fall back to listing
    // to find and expand all files inside it.
    const sandboxData = await apiFetchSandboxFiles();
    if (sandboxData && sandboxData.files) {
        const prefix = filepath + '/';
        let expanded = [];
        for (const sf of sandboxData.files) {
            if (sf.startsWith(prefix)) {
                expanded.push(sf);
            }
        }

        if (expanded.length > 0) {
            const virtualId = 'sandbox/' + filepath + '/*';
            let folderRefText = '';
            let skippedCount = 0;
            for (const fp of expanded) {
                const isImg = fp.match(imageWhitelist);
                const isText = textWhitelist.test(fp) || exactNameWhitelist.test(fp);
                if (isImg || !isText) {
                    skippedCount++;
                    continue;
                }
                const r = await apiFetchSandboxFile(fp);
                if (r) folderRefText += `--- START OF ${fp} ---\n${await r.text()}\n--- END OF ${fp} ---\n\n`;
            }
            if (folderRefText === '') {
                window.customAlert(skippedCount > 0 ? `No valid text documents found in this folder (${skippedCount} non-text files skipped).` : 'No valid text documents found in folder.');
                return;
            }
            if (typeof insertChipAtRange === 'function') insertChipAtRange(lastFocusedInput, range, virtualId, false, {
                id: virtualId,
                chipLabel: `<img src="/static/icons/folder.svg" class='file-icon'> ${virtualId}`,
                refText: `[FOLDER_ATTACHED: ${filepath}]\n${folderRefText}`
            });
            return;
        }
    }

    window.customAlert('File not found or inaccessible.');
}

window.addEventListener('DOMContentLoaded', () => {
    const palette = document.getElementById('sandbox-palette');
    const header = document.getElementById('sandbox-palette-header');

    if (!palette || !header) return;

    let isDragging = false;
    let isResizing = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    let resizeStartX = 0;
    let resizeStartY = 0;

    // Restore saved size from localStorage
    const savedSize = localStorage.getItem('sandboxPaletteSize');
    if (savedSize) {
        try {
            const { w, h } = JSON.parse(savedSize);
            const minW = 200;
            const minH = 200;
            const maxW = 500;
            const maxH = 750;
            palette.style.width = `${Math.max(minW, Math.min(w, maxW))}px`;
            palette.style.height = `${Math.max(minH, Math.min(h, maxH))}px`;
        } catch (e) {
            // ignore invalid stored size
        }
    }

    const saveSize = () => {
        localStorage.setItem('sandboxPaletteSize', JSON.stringify({
            w: palette.offsetWidth,
            h: palette.offsetHeight
        }));
    };

    header.addEventListener('mousedown', (e) => {
        // Prevent drag when clicking buttons inside header
        if (e.target.tagName.toLowerCase() === 'button') return;

        isDragging = true;
        const rect = palette.getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;
    });

    const handle = palette.querySelector('.resize-handle');
    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isResizing = true;
        // Anchor to the current right/bottom edges so the resize is strictly 1:1
        resizeStartX = e.clientX - palette.offsetWidth;
        resizeStartY = e.clientY - palette.offsetHeight;
    });

    window.addEventListener('mousemove', (e) => {
        if (isDragging) {
            let newLeft = e.clientX - dragOffsetX;
            let newTop = e.clientY - dragOffsetY;
            // Right and bottom bounds: right edge and bottom edge must stay inside the viewport
            newLeft = Math.min(newLeft, window.innerWidth - palette.offsetWidth);
            newTop = Math.min(newTop, window.innerHeight - palette.querySelector('#sandbox-palette-header').offsetHeight);
            palette.style.left = `${Math.max(0, newLeft)}px`;
            palette.style.top = `${Math.max(0, newTop)}px`;
        } else if (isResizing) {
            const minW = 200;
            const minH = 200;
            const maxW = Math.min(e.clientX - resizeStartX, window.innerWidth - 40);
            const maxH = Math.min(e.clientY - resizeStartY, window.innerHeight - 40);
            const newW = Math.max(minW, e.clientX - resizeStartX);
            const newH = Math.max(minH, e.clientY - resizeStartY);
            palette.style.width = `${newW}px`;
            palette.style.height = `${newH}px`;
        }
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
        isResizing = false;
        if (palette.offsetParent !== null) {
            saveSize();
        }
    });
});

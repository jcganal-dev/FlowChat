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
let currentSandboxFiles = [];
let collapsedSandboxFolders = new Set(JSON.parse(localStorage.getItem('collapsedSandboxFolders') || '[]'));

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
            const focusBg = document.getElementById('focus-bg');
            if (focusBg && focusBg.style.display !== 'none' && typeof renderFocusProjectFiles === 'function') {
                renderFocusProjectFiles();
            } else {
                fetchSandboxFiles();
            }
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

/**
 * Fetches the list of files in the user's sandbox directory and renders them in the sidebar file tree.
 */
async function fetchSandboxFiles() {
    const data = await apiFetchSandboxFiles();
    if (!data) return;

    const tree = document.getElementById('file-tree');
    if (!tree) return;

    tree.innerHTML = '';
    currentSandboxFiles = data.files;
    selectedSandboxFiles.clear();
    lastSelectedSandboxFileIndex = -1;

    const sRoot = { name: 'Sandbox (S:)', path: '', type: 'directory', children: {}, isSandboxRoot: true };
    const treeRoot = { name: '', path: '', type: 'directory', children: { 'S:/': sRoot } };
    const items = data.items || data.files.map(f => ({ path: f, type: 'file' }));

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
            current.children[name] = { name, path: item.path, type: 'file', index: currentSandboxFiles.indexOf(item.path) };
        }
    });

    currentSandboxFiles = []; // Reset and rebuild in visual order

    function renderTree(node, container, depth = 0) {
        const children = Object.values(node.children).sort((a, b) => {
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        children.forEach(child => {
            const itemWrapper = document.createElement('div');
            itemWrapper.className = 'tree-item-wrapper';

            const item = document.createElement('div');
            item.className = 'file-item';
            item.style.paddingLeft = `${depth * 16 + 8}px`;
            item.style.paddingTop = '4px';
            item.style.paddingBottom = '4px';
            item.style.paddingRight = '8px';
            item.style.borderRadius = '4px';

            const filepath = child.path;
            currentSandboxFiles.push(filepath);
            const index = currentSandboxFiles.length - 1;

            item.dataset.path = filepath;
            item.style.cursor = 'pointer';

            if (child.type === 'directory') {
                const isCollapsed = collapsedSandboxFolders.has(child.path);
                const chevronChar = isCollapsed ? `<img src="/static/icons/chevron-right.svg" class="file-icon">` : `<img src="/static/icons/chevron-down.svg" class="file-icon">`;
                item.innerHTML = `<span class="chevron" style="display:inline-block; width:12px; font-size:10px;">${chevronChar}</span><img src="/static/icons/folder.svg" class="file-icon"> ${child.name}`;

                const childrenContainer = document.createElement('div');
                childrenContainer.className = 'folder-children';
                if (isCollapsed) {
                    childrenContainer.style.display = 'none';
                }

                itemWrapper.appendChild(item);
                itemWrapper.appendChild(childrenContainer);
                container.appendChild(itemWrapper);


                renderTree(child, childrenContainer, depth + 1);
            } else {

                item.innerHTML = `<span style="display:inline-block; width:12px;"></span> <img class="file-icon" src="${getIconpath(child.name)}">${child.name}`;
                item.title = 'Double-click to open. Shift+Click in textbox to reference.';

                item.addEventListener('dblclick', () => {
                    window.open('/sandbox/' + filepath, '_blank');
                });

                itemWrapper.appendChild(item);
                container.appendChild(itemWrapper);
            }

            // Shared events for selection, drag/drop, and context menu
            item.addEventListener('mousedown', (e) => {
                if (child.isSandboxRoot) return;
                if (e.shiftKey || e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                }
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                item.style.backgroundColor = 'var(--bg-hover)';
            });
            item.addEventListener('dragleave', (e) => {
                item.style.backgroundColor = selectedSandboxFiles.has(filepath) ? 'rgba(255, 255, 255, 0.15)' : '';
            });
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
                        if (targetDir && collapsedSandboxFolders.has(targetDir)) {
                            let parts = targetDir.split('/');
                            let currentPath = '';
                            for (let part of parts) {
                                currentPath += (currentPath ? '/' : '') + part;
                                collapsedSandboxFolders.delete(currentPath);
                            }
                            localStorage.setItem('collapsedSandboxFolders', JSON.stringify(Array.from(collapsedSandboxFolders)));
                        }
                        selectedSandboxFiles.clear();
                        fetchSandboxFiles();
                    }
                } catch (err) { }
            });

            item.draggable = !child.isSandboxRoot;
            item.addEventListener('dragstart', (e) => {
                if (child.isSandboxRoot) { e.preventDefault(); return; }
                if (!selectedSandboxFiles.has(filepath)) {
                    selectedSandboxFiles.clear();
                    selectedSandboxFiles.add(filepath);
                    lastSelectedSandboxFileIndex = index;
                    updateSidebarSelection();
                }
                e.dataTransfer.setData('text/plain', JSON.stringify(Array.from(selectedSandboxFiles)));
                e.dataTransfer.effectAllowed = 'copy';
            });
            item.addEventListener('dragend', () => {
                selectedSandboxFiles.clear();
                lastSelectedSandboxFileIndex = -1;
                updateSidebarSelection();
                if (typeof updateFocusFileSelection === 'function') updateFocusFileSelection();
            });

            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if (child.isSandboxRoot) return;
                if (!selectedSandboxFiles.has(filepath)) {
                    selectedSandboxFiles.clear();
                    selectedSandboxFiles.add(filepath);
                    lastSelectedSandboxFileIndex = index;
                    updateSidebarSelection();
                }
                targetSandboxFile = filepath;

                const delMenu = document.getElementById('menu-delete-sandbox-file');
                if (delMenu) {
                    delMenu.innerHTML = selectedSandboxFiles.size > 1 ? `<img src="/static/icons/trash.svg" class="file-icon"> Delete ${selectedSandboxFiles.size} Items` : `<img src="/static/icons/trash.svg" class="file-icon"> Delete`;
                }

                sandboxContextMenu.style.display = 'block';
                sandboxContextMenu.style.left = `${e.clientX}px`;
                sandboxContextMenu.style.top = `${e.clientY}px`;
            });

            item.addEventListener('click', (e) => {
                if (e.shiftKey && lastFocusedInput) {
                    e.preventDefault();
                    handleSandboxFileShiftClick(filepath);
                    return;
                }

                if (child.type === 'directory') {
                    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
                        e.stopPropagation();
                        const childrenContainer = itemWrapper.querySelector('.folder-children');
                        const chevron = item.querySelector('.chevron');
                        if (childrenContainer.style.display === 'none') {
                            childrenContainer.style.display = 'block';
                            chevron.innerHTML = `<img src="/static/icons/chevron-down.svg" class="file-icon">`;
                            collapsedSandboxFolders.delete(filepath);
                        } else {
                            childrenContainer.style.display = 'none';
                            chevron.innerHTML = `<img src="/static/icons/chevron-right.svg" class="file-icon">`;
                            collapsedSandboxFolders.add(filepath);
                        }
                        localStorage.setItem('collapsedSandboxFolders', JSON.stringify(Array.from(collapsedSandboxFolders)));
                    }
                }

                if (child.isSandboxRoot) return;

                if (e.shiftKey) {
                    if (lastSelectedSandboxFileIndex === -1) {
                        selectedSandboxFiles.add(filepath);
                        lastSelectedSandboxFileIndex = index;
                    } else {
                        const visibleItems = Array.from(document.querySelectorAll('.file-item'))
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
                    if (selectedSandboxFiles.has(filepath)) {
                        selectedSandboxFiles.delete(filepath);
                    } else {
                        selectedSandboxFiles.add(filepath);
                        lastSelectedSandboxFileIndex = index;
                    }
                } else {
                    selectedSandboxFiles.clear();
                    selectedSandboxFiles.add(filepath);
                    lastSelectedSandboxFileIndex = index;
                }
                updateSidebarSelection();
            });
        });
    }

    renderTree(treeRoot, tree);

    // Allow dropping on the root container itself to move to root directory
    tree.addEventListener('dragover', (e) => {
        e.preventDefault();
    });
    tree.addEventListener('drop', async (e) => {
        e.preventDefault();
        // If the drop was already handled by a subdirectory, don't do it again
        if (e.defaultPrevented) return;

        const data = e.dataTransfer.getData('text/plain');
        try {
            const paths = JSON.parse(data);
            if (!Array.isArray(paths)) return;

            // Avoid moving root-level items to root
            const itemsToMove = paths.filter(p => p.includes('/'));
            if (itemsToMove.length === 0) return;

            const success = await apiMoveSandboxFiles(itemsToMove, "");
            if (success) {
                selectedSandboxFiles.clear();
                fetchSandboxFiles();
            }
        } catch (err) { }
    });
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
        if (targetDir && collapsedSandboxFolders.has(targetDir)) {
            let parts = targetDir.split('/');
            let currentPath = '';
            for (let part of parts) {
                currentPath += (currentPath ? '/' : '') + part;
                collapsedSandboxFolders.delete(currentPath);
            }
            localStorage.setItem('collapsedSandboxFolders', JSON.stringify(Array.from(collapsedSandboxFolders)));
        }
        renderFocusProjectFiles();
        fetchSandboxFiles();
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
        if (targetDir && collapsedSandboxFolders.has(targetDir)) {
            let parts = targetDir.split('/');
            let currentPath = '';
            for (let part of parts) {
                currentPath += (currentPath ? '/' : '') + part;
                collapsedSandboxFolders.delete(currentPath);
            }
            localStorage.setItem('collapsedSandboxFolders', JSON.stringify(Array.from(collapsedSandboxFolders)));
        }
        renderFocusProjectFiles();
        fetchSandboxFiles();
    } else {
        window.customAlert('Upload failed!');
    }
    event.target.value = '';
}

/**
 * Handles shift-clicking on a sandbox file in the sidebar. 
 * Creates a virtual file node (if it doesn't exist) and injects a reference chip into the active text area.
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
        window.customAlert('Cannot add references to a finished node!');
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

    const sandboxData = await apiFetchSandboxFiles();
    if (sandboxData && sandboxData.files) {
        if (!sandboxData.files.includes(filepath)) {
            const prefix = filepath + '/';
            let expanded = [];
            for (const sf of sandboxData.files) {
                if (sf.startsWith(prefix)) {
                    expanded.push(sf);
                }
            }

            if (expanded.length > 0) {
                const virtualId = 'sandbox/' + filepath + '/*';
                if (!virtualFileNodes[virtualId]) {
                    let folderFiles = [];
                    for (const fp of expanded) {
                        const isImg = fp.match(/\.(png|jpg|jpeg|gif|webp)$/i);
                        if (isImg) continue;
                        const r = await apiFetchSandboxFile(fp);
                        if (r) folderFiles.push({ name: fp, payload: await r.text() });
                    }
                    if (folderFiles.length === 0) {
                        window.customAlert('No valid text documents found in folder.');
                        return;
                    }
                    const nodeData = {
                        id: virtualId,
                        type: 'document',
                        files: folderFiles,
                        userText: '',
                        htmlText: '',
                        aiText: ' ',
                        aiThinking: '',
                        references: [],
                        hasChild: false,
                        isCollapsed: false,
                        isVirtual: true
                    };
                    virtualFileNodes[virtualId] = nodeData;
                    if (!nodes.find(n => n.id === virtualId)) nodes.push(nodeData);
                }
                if (typeof insertChipAtRange === 'function') insertChipAtRange(lastFocusedInput, range, virtualId, false);
                return;
            }
        }
    }

    const isImage = filepath.match(/\.(png|jpg|jpeg|gif|webp)$/i);
    const virtualId = 'sandbox/' + filepath;

    if (!virtualFileNodes[virtualId]) {
        const res = await apiFetchSandboxFile(filepath);
        if (!res) {
            window.customAlert('Failed to load file content.');
            return;
        }

        let payload = null;
        let type = 'document';

        if (isImage) {
            type = 'image';
            const blob = await res.blob();
            payload = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            });
        } else {
            type = 'document';
            payload = await res.text();
        }

        const nodeData = {
            id: virtualId,
            type: type,
            files: [{ name: filepath, payload: payload }],
            userText: '',
            htmlText: '',
            aiText: ' ',
            aiThinking: '',
            references: [],
            hasChild: false,
            isCollapsed: false,
            isVirtual: true
        };
        virtualFileNodes[virtualId] = nodeData;

        if (!nodes.find(n => n.id === virtualId)) {
            nodes.push(nodeData);
        }
    }

    if (typeof insertChipAtRange === 'function') insertChipAtRange(lastFocusedInput, range, virtualId, false);
}

window.addEventListener('DOMContentLoaded', () => {
    const palette = document.getElementById('sandbox-palette');
    const header = document.getElementById('sandbox-palette-header');

    if (!palette || !header) return;

    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    header.addEventListener('mousedown', (e) => {
        // Prevent drag when clicking buttons inside header
        if (e.target.tagName.toLowerCase() === 'button') return;

        isDragging = true;
        const rect = palette.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        palette.style.left = `${e.clientX - offsetX}px`;
        palette.style.top = `${e.clientY - offsetY}px`;
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
    });
});

// Context menu for sandbox files
const sandboxContextMenu = document.createElement('div');
sandboxContextMenu.id = 'sandbox-context-menu';
sandboxContextMenu.className = 'context-menu'; // Use same styling but unique ID
sandboxContextMenu.style.cssText = `
    position: absolute;
    background: #1e1e2e;
    border: 1px solid #444;
    border-radius: 6px;
    padding: 5px 0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    z-index: 10000;
    display: none;
    color: #eee;
`;
sandboxContextMenu.innerHTML = `<div class="context-item" id="menu-delete-sandbox-file">🗑️ Delete File</div>`;
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
            fetchSandboxFiles();
        } else {
            window.customAlert('Failed to delete one or more files.');
        }
    }
});

document.addEventListener('click', (e) => {
    sandboxContextMenu.style.display = 'none';
    const palette = document.getElementById('sandbox-palette');
    if (palette && !palette.contains(e.target) && selectedSandboxFiles.size > 0) {
        selectedSandboxFiles.clear();
        lastSelectedSandboxFileIndex = -1;
        updateSidebarSelection();
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

    const treeRoot = { name: '', path: '', type: 'directory', children: {} };
    const items = data.items || data.files.map(f => ({ path: f, type: 'file' }));

    items.forEach(item => {
        const parts = item.path.split('/');
        let current = treeRoot;
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
                const chevronChar = isCollapsed ? '▶' : '▼';
                item.innerHTML = `<span class="chevron" style="display:inline-block; width:12px; font-size:10px;">${chevronChar}</span> 📁 ${child.name}`;

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
                item.title = 'Double-click to open. Click/Shift-Click/Ctrl-Click to select. Shift+Click in textbox to reference.';

                item.addEventListener('dblclick', () => {
                    window.open('/sandbox/' + filepath, '_blank');
                });

                itemWrapper.appendChild(item);
                container.appendChild(itemWrapper);
            }

            // Shared events for selection and context menu
            item.addEventListener('mousedown', (e) => {
                if (e.shiftKey || e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                }
            });

            item.draggable = true;
            item.addEventListener('dragstart', (e) => {
                if (!selectedSandboxFiles.has(filepath)) {
                    selectedSandboxFiles.clear();
                    selectedSandboxFiles.add(filepath);
                    lastSelectedSandboxFileIndex = index;
                    updateSidebarSelection();
                }
                e.dataTransfer.setData('text/plain', JSON.stringify(Array.from(selectedSandboxFiles)));
                e.dataTransfer.effectAllowed = 'copy';
            });

            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if (!selectedSandboxFiles.has(filepath)) {
                    selectedSandboxFiles.clear();
                    selectedSandboxFiles.add(filepath);
                    lastSelectedSandboxFileIndex = index;
                    updateSidebarSelection();
                }
                targetSandboxFile = filepath;

                const delMenu = document.getElementById('menu-delete-sandbox-file');
                if (delMenu) {
                    delMenu.innerHTML = selectedSandboxFiles.size > 1 ? `🗑️ Delete ${selectedSandboxFiles.size} Items` : `🗑️ Delete`;
                }

                sandboxContextMenu.style.display = 'block';
                sandboxContextMenu.style.left = `${e.clientX}px`;
                sandboxContextMenu.style.top = `${e.clientY}px`;
            });

            item.addEventListener('click', (e) => {
                if (child.type === 'directory') {
                    // For directories, toggle expand/collapse if clicking chevron, else just select
                    const isChevron = e.target.classList.contains('chevron');
                    if (isChevron) {
                        e.stopPropagation();
                        const childrenContainer = itemWrapper.querySelector('.folder-children');
                        const chevron = item.querySelector('.chevron');
                        if (childrenContainer.style.display === 'none') {
                            childrenContainer.style.display = 'block';
                            chevron.textContent = '▼';
                            collapsedSandboxFolders.delete(filepath);
                        } else {
                            childrenContainer.style.display = 'none';
                            chevron.textContent = '▶';
                            collapsedSandboxFolders.add(filepath);
                        }
                        localStorage.setItem('collapsedSandboxFolders', JSON.stringify(Array.from(collapsedSandboxFolders)));
                        return;
                    }
                }

                if (e.shiftKey && lastFocusedInput && child.type === 'file') {
                    e.preventDefault();
                    handleSandboxFileShiftClick(filepath);
                    return;
                }

                if (e.shiftKey) {
                    if (lastSelectedSandboxFileIndex === -1) {
                        selectedSandboxFiles.add(filepath);
                        lastSelectedSandboxFileIndex = index;
                    } else {
                        const start = Math.min(lastSelectedSandboxFileIndex, index);
                        const end = Math.max(lastSelectedSandboxFileIndex, index);
                        selectedSandboxFiles.clear();
                        for (let i = start; i <= end; i++) {
                            selectedSandboxFiles.add(currentSandboxFiles[i]);
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
}

async function promptCreateFolder() {
    const folderName = await window.customPrompt(message = 'Enter new folder name:', defaultValue = 'New Folder', title = 'Create Folder');
    if (!folderName) return;

    const success = await apiCreateSandboxFolder(folderName);
    if (success) {
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

    const formData = new FormData();
    for (let file of files) {
        // Use webkitRelativePath to maintain folder structure if uploading a folder
        const filename = file.webkitRelativePath || file.name;
        formData.append('files', file, filename);
    }

    const success = await apiUploadSandboxFiles(formData);
    if (success) {
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
        return;
    }

    if (lastFocusedInput.contentEditable === 'false' || lastFocusedInput.getAttribute('contenteditable') === 'false') {
        window.customAlert('Cannot add references to a finished node!');
        return;
    }

    const isImage = filepath.match(/\\.(png|jpg|jpeg|gif|webp)$/i);
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

    const selection = window.getSelection();
    let range;

    if (selection.rangeCount > 0 && lastFocusedInput.contains(selection.getRangeAt(0).commonAncestorContainer)) {
        range = selection.getRangeAt(0);
    } else {
        range = document.createRange();
        range.selectNodeContents(lastFocusedInput);
        range.collapse(false);
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

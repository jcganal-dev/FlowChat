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

document.getElementById('menu-delete-sandbox-file').addEventListener('click', async () => {
    sandboxContextMenu.style.display = 'none';
    if (!targetSandboxFile) return;
    
    if (confirm(`Are you sure you want to delete ${targetSandboxFile}?`)) {
        const success = await apiDeleteSandboxFile(targetSandboxFile);
        if (success) {
            fetchSandboxFiles();
        } else {
            alert('Failed to delete file.');
        }
    }
});

document.addEventListener('click', () => {
    sandboxContextMenu.style.display = 'none';
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
    data.files.forEach(filepath => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.textContent = '📄 ' + filepath;
        item.title = 'Click to open in new tab. Shift+Click to reference in focused node.';

        item.addEventListener('mousedown', (e) => {
            if (e.shiftKey) {
                e.preventDefault();
            }
        });

        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            targetSandboxFile = filepath;
            sandboxContextMenu.style.display = 'block';
            sandboxContextMenu.style.left = `${e.clientX}px`;
            sandboxContextMenu.style.top = `${e.clientY}px`;
        });

        item.addEventListener('click', (e) => {
            if (e.shiftKey) {
                e.preventDefault();
                handleSandboxFileShiftClick(filepath);
            } else {
                window.open('/sandbox/' + filepath, '_blank');
            }
        });

        tree.appendChild(item);
    });
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
        formData.append('files', file);
    }

    const success = await apiUploadSandboxFiles(formData);
    if (success) {
        fetchSandboxFiles();
    } else {
        alert('Upload failed!');
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
        alert('Please focus on a text input box first by clicking it!');
        return;
    }

    const isImage = filepath.match(/\\.(png|jpg|jpeg|gif|webp)$/i);
    const virtualId = 'sandbox/' + filepath;

    if (!virtualFileNodes[virtualId]) {
        const res = await apiFetchSandboxFile(filepath);
        if (!res) {
            alert('Failed to load file content.');
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

    if(typeof insertChipAtRange === 'function') insertChipAtRange(lastFocusedInput, range, virtualId, false);
}

/**
 * Toggles the visibility of the left sidebar and saves the preference to localStorage.
 */
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const resizer = document.getElementById('sidebar-resizer');
    sidebar.classList.toggle('hidden');
    const isHidden = sidebar.classList.contains('hidden');
    if (isHidden) {
        resizer.style.display = 'none';
    } else {
        resizer.style.display = 'block';
    }
    localStorage.setItem('sidebarHidden', isHidden);
    requestAnimationFrame(() => {
        if(typeof drawEdges === 'function') drawEdges();
    });
}

window.addEventListener('DOMContentLoaded', () => {
    const resizer = document.getElementById('sidebar-resizer');
    const sidebar = document.getElementById('sidebar');
    let isResizingSidebar = false;

    if(!resizer || !sidebar) return;

    const savedHidden = localStorage.getItem('sidebarHidden');
    if (savedHidden === 'true') {
        sidebar.classList.add('hidden');
        resizer.style.display = 'none';
    }
    const savedWidth = localStorage.getItem('sidebarWidth');
    if (savedWidth) {
        sidebar.style.width = savedWidth;
    }

    resizer.addEventListener('mousedown', (e) => {
        isResizingSidebar = true;
        resizer.classList.add('resizing');
        document.body.style.cursor = 'ew-resize';
    });

    window.addEventListener('mousemove', (e) => {
        if (!isResizingSidebar) return;

        let newWidth = e.clientX;
        if (newWidth < 150) newWidth = 150;
        if (newWidth > 600) newWidth = 600;

        sidebar.style.width = newWidth + 'px';
        localStorage.setItem('sidebarWidth', sidebar.style.width);
        if(typeof drawEdges === 'function') drawEdges();
    });

    window.addEventListener('mouseup', () => {
        if (isResizingSidebar) {
            isResizingSidebar = false;
            resizer.classList.remove('resizing');
            document.body.style.cursor = 'default';
        }
    });
});

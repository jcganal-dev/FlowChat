const $ = (id) => document.getElementById(id);
const $make = (tag) => document.createElement(tag);
const erase_thoughts = true;
const GRID_SIZE = 24;
const textWhitelist = /\.(js|jsx|ts|tsx|py|html|css|json|txt|md|csv|tsv|xml|yaml|yml|ini|env|sh|bat|sql|c|cpp|h|hpp|java|go|rs|php|rb|swift|kt|cs|gitignore|svg)$/i;
const exactNameWhitelist = /(Dockerfile|Makefile|LICENSE|README)$/i;
const imageWhitelist = /\.(png|jpg|jpeg|gif|webp|svg|ico)$/i;


function groupIcon(color='#000000') {
    return `
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class='file-icon'>
        <g id="SVGRepo_bgCarrier" stroke-width="0"></g>
        <g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g>
        <g id="SVGRepo_iconCarrier">
            <path d="M3 1H1V3H3V1Z" fill="${color}"></path>
            <path d="M3 13H1V15H3V13Z" fill="${color}"></path>
            <path d="M1 9H3V11H1V9Z" fill="${color}"></path>
            <path d="M3 5H1V7H3V5Z" fill="${color}"></path>
            <path d="M5 1H7V3H5V1Z" fill="${color}"></path>
            <path d="M7 13H5V15H7V13Z" fill="${color}"></path>
            <path d="M9 1H11V3H9V1Z" fill="${color}"></path>
            <path d="M11 13H9V15H11V13Z" fill="${color}"></path>
            <path d="M13 1H15V3H13V1Z" fill="${color}"></path>
            <path d="M15 13H13V15H15V13Z" fill="${color}"></path>
            <path d="M13 9H15V11H13V9Z" fill="${color}"></path>
            <path d="M15 5H13V7H15V5Z" fill="${color}"></path>
        </g>
    </svg>
    `
}

function documentIcon(color='#38bdf8') {
    return `
        <svg xmlns="http://www.w3.org/2000/svg" width="800px" height="800px" viewBox="0 0 24 24" fill="none" class="file-icon">
            <path d="M3 14H21M3 19H15M3 5H11M3 9.5H11M19.4 11H16.6C16.0399 11 15.7599 11 15.546 10.891C15.3578 10.7951 15.2049 10.6422 15.109 10.454C15 10.2401 15 9.96005 15 9.4V6.6C15 6.03995 15 5.75992 15.109 5.54601C15.2049 5.35785 15.3578 5.20487 15.546 5.10899C15.7599 5 16.0399 5 16.6 5H19.4C19.9601 5 20.2401 5 20.454 5.10899C20.6422 5.20487 20.7951 5.35785 20.891 5.54601C21 5.75992 21 6.03995 21 6.6V9.4C21 9.96005 21 10.2401 20.891 10.454C20.7951 10.6422 20.6422 10.7951 20.454 10.891C20.2401 11 19.9601 11 19.4 11Z" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `
}

function imageIcon(color='#38bdf8') {
    return `
        <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">

        <!-- Uploaded to: SVG Repo, www.svgrepo.com, Transformed by: SVG Repo Mixer Tools -->
        <svg width="800px" height="800px" viewBox="0 0 24.00 24.00" fill="none" xmlns="http://www.w3.org/2000/svg" class="file-icon">

        <g id="SVGRepo_bgCarrier" stroke-width="0"/>

        <g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"/>

        <g id="SVGRepo_iconCarrier">
        <path d="M21.6799 16.9599L18.5499 9.64988C17.4899 7.16988 15.5399 7.06988 14.2299 9.42988L12.3399 12.8399C11.3799 14.5699 9.58993 14.7199 8.34993 13.1699L8.12993 12.8899C6.83993 11.2699 5.01993 11.4699 4.08993 13.3199L2.36993 16.7699C1.15993 19.1699 2.90993 21.9999 5.58993 21.9999H18.3499C20.9499 21.9999 22.6999 19.3499 21.6799 16.9599Z" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M6.96997 8C8.62682 8 9.96997 6.65685 9.96997 5C9.96997 3.34315 8.62682 2 6.96997 2C5.31312 2 3.96997 3.34315 3.96997 5C3.96997 6.65685 5.31312 8 6.96997 8Z" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        </g>

        </svg>
    `
}

function scrapeIcon(color='#38bdf8') {
    return `
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class='file-icon'>
    <g id="SVGRepo_bgCarrier" stroke-width="0"></g>
    <g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round" stroke="#000CCCCCC" stroke-width="0.048"></g>
    <g id="SVGRepo_iconCarrier">
        <path d="M22 14.3529C22 17.4717 19.4416 20 16.2857 20H11M14.381 9.02721C14.9767 8.81911 15.6178 8.70588 16.2857 8.70588C16.9404 8.70588 17.5693 8.81468 18.1551 9.01498M7.11616 11.6089C6.8475 11.5567 6.56983 11.5294 6.28571 11.5294C3.91878 11.5294 2 13.4256 2 15.7647C2 18.1038 3.91878 20 6.28571 20H7M7.11616 11.6089C6.88706 10.9978 6.7619 10.3369 6.7619 9.64706C6.7619 6.52827 9.32028 4 12.4762 4C15.4159 4 17.8371 6.19371 18.1551 9.01498M7.11616 11.6089C7.68059 11.7184 8.20528 11.9374 8.66667 12.2426M18.1551 9.01498C18.8381 9.24853 19.4623 9.60648 20 10.0614" stroke="${color}" stroke-width="2.4" stroke-linecap="round"></path>
    </g>
</svg>
    `
}

function chatIcon(color='#38bdf8') {
    return `
<?xml version="1.0" encoding="utf-8"?><!-- Uploaded to: SVG Repo, www.svgrepo.com, Generator: SVG Repo Mixer Tools -->
<svg fill="${color}" class='file-icon' width="800px" height="800px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20,9H16a1,1,0,0,0-1,1v1H7V7H8A1,1,0,0,0,9,6V2A1,1,0,0,0,8,1H4A1,1,0,0,0,3,2V6A1,1,0,0,0,4,7H5V20a1,1,0,0,0,1,1h9v1a1,1,0,0,0,1,1h4a1,1,0,0,0,1-1V18a1,1,0,0,0-1-1H16a1,1,0,0,0-1,1v1H7V13h8v1a1,1,0,0,0,1,1h4a1,1,0,0,0,1-1V10A1,1,0,0,0,20,9ZM5,3H7V5H5ZM17,19h2v2H17Zm2-6H17V11h2Z"/></svg>
    `
}

/**
 * Returns a comma-separated list of extensions accepted by textWhitelist,
 * suitable for an <input type="file" accept=""> attribute.
 */
function getTextWhitelistExtensions() {
    return (textWhitelist.source.slice(2).match(/\w+/g) || []).join(',');
}
const NODE_WIDTH = {
    min: 300,
    max: 1200,
};
const systemReminders = 'Do not overthink, immediately stop thinking after you arrive at an answer.'

let nodes = [];
let groups = {};
let current_active_lineage = []
let camera = { x: 0, y: 0, zoom: 1 };
let selectedNodes = new Set();
let activeNodeId = null;
let targetNodeIdForMenu = null;
let forkOffsetCounter = 0;
let highestZIndex = 10;
let shiftSelectionStartId = null;

let isPanning = false;
let startPanX = 0, startPanY = 0;
let layoutDebounceTimeout;

let lastFocusedInput = null;
let lastSelectionRange = null;
let virtualFileNodes = {};

window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') document.body.classList.add('shift-pressed');
});
window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') document.body.classList.remove('shift-pressed');
});

const viewport = $('viewport');
const nodesLayer = $('nodes-layer');
const edgesLayer = $('edges-layer');
const contextMenu = $make('div');

contextMenu.id = 'context-menu';
contextMenu.classList.add('context-menu')
contextMenu.innerHTML = `
    <div class="context-item" id="menu-add-node"><img src="/static/icons/chatnode.svg" class="file-icon"> Add Chat Node</div>
    <div class="context-item" id="menu-add-image"><img src="/static/icons/image.svg" class="file-icon"> Add Image Node</div>
    <div class="context-item" id="menu-add-file"><img src="/static/icons/file.svg" class="file-icon"> Add Document Node</div>
    <div class="context-item" id="menu-add-scrape"><img src="/static/icons/globe.svg" class="file-icon"> Add Scrape Node</div>
    <div class="context-item" id="menu-open-palette"><img src="/static/icons/sandbox.svg" class="file-icon"> Open Sandbox Files</div>
    <div class="context-item" id="menu-rename-node"><img src="/static/icons/pencil.svg" class="file-icon"> Rename Node</div>
    <div class="context-item" id="menu-rename"><img src="/static/icons/brush.svg" class="file-icon"> Rename Branch</div>
    <div class="context-item" id="menu-focus-mode"><img src="/static/icons/focus.svg" class="file-icon"> Enter Focus Mode</div>
    <div class="context-item" id="menu-toggle-node"></div>
    <div class="context-item" id="menu-summarize"><img src="/static/icons/bulb.svg" class="file-icon"> Summarize Node</div>
    <div class="context-item" id="menu-summarize-selected"><img src="/static/icons/bulb.svg" class="file-icon"> Summarize Selected Nodes</div>
    <div class="context-item" id="menu-expand-selected"><img src="/static/icons/expand.svg" class="file-icon"> Expand Selected Nodes</div>
    <div class="context-item" id="menu-collapse-selected"><img src="/static/icons/collapse.svg" class="file-icon"> Collapse Selected Nodes</div>
    <div class="context-item" id="menu-group"><img src="/static/icons/group.svg" class="file-icon"> Group Selected Nodes</div>
    <div class="context-item" id="menu-ungroup"><img src="/static/icons/ungroup.svg" class="file-icon"> Ungroup Node</div>
    <div class="context-item" id="menu-delete-node"><img src="/static/icons/trash.svg" class="file-icon"> Delete Node</div>
    <div class="context-item" id="menu-delete-selected"><img src="/static/icons/trash.svg" class="file-icon"> Delete Selected Nodes</div>
`;
document.body.appendChild(contextMenu);

const nodeResizeObserver = new ResizeObserver(() => {
    clearTimeout(layoutDebounceTimeout);
    layoutDebounceTimeout = setTimeout(() => {
        if (typeof drawEdges === 'function') drawEdges();
        if (typeof drawGroups === 'function') drawGroups();
        if (typeof updateCanvas === 'function') updateCanvas();
    }, 30);
});

function getIconpath(filepath) {
    const extension = filepath.split('.').pop().toLowerCase();
    
    switch (extension) {
        case 'js':
            return '/static/icons/js.svg';
        case 'html':
            return '/static/icons/html.svg';
        case 'css':
            return '/static/icons/css.svg';
        case 'py':
            return '/static/icons/py.svg';
        case 'svg':
            return '/static/icons/svg.svg';
        case 'png':
            return '/static/icons/image.svg';
        case 'jpg':
            return '/static/icons/image.svg';
        case 'jpeg':
            return '/static/icons/image.svg';
        case 'gif':
            return '/static/icons/image.svg';
        case 'webp':
            return '/static/icons/image.svg';
        case 'webp':
            return '/static/icons/image.svg';
        case 'ico':
            return '/static/icons/image.svg';
        default:
            return '/static/icons/file.svg';
    }
}

/**
 * Renders Markdown, Math, and Code Blocks safely.
 * @param {string} text - The raw markdown text
 * @returns {string} The rendered HTML
 */
function renderMarkdown(text) {
    if (!text) return '';
    if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
        if (!marked.configured) {
            // Configure marked with highlight.js
            if (typeof markedHighlight !== 'undefined' && typeof hljs !== 'undefined') {
                const { markedHighlight: mh } = markedHighlight;
                marked.use(mh({
                    emptyLangClass: 'hljs',
                    langPrefix: 'hljs language-',
                    highlight(code, lang) {
                        const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                        return hljs.highlight(code, { language }).value;
                    }
                }));
            }

            // Configure marked with KaTeX
            if (typeof markedKatex !== 'undefined') {
                marked.use(markedKatex({ throwOnError: false }));
            }
            marked.configured = true;
        }

        try {
            const html = marked.parse(text);

            // Configure DOMPurify to allow KaTeX attributes and tags
            return DOMPurify.sanitize(html, {
                ADD_TAGS: ['math', 'menclose', 'merror', 'mfrac', 'mi', 'mlabeledtr', 'mmultiscripts', 'mn', 'mo', 'mover', 'mpadded', 'mphantom', 'mroot', 'mrow', 'ms', 'mspace', 'msqrt', 'mstyle', 'msub', 'msubsup', 'msup', 'mtable', 'mtd', 'mtext', 'mtr', 'munder', 'semantics', 'annotation', 'annotation-xml'],
                ADD_ATTR: ['display', 'style', 'target', 'class']
            });
        } catch (e) {
            console.error('Markdown render error:', e);
            // Fallback: escape HTML and return as pre
            return `<pre style="white-space:pre-wrap;color:#ff5555;">[Render error] ${text.replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>')}</pre>`;
        }
    }
    return text;
}

window.showModal = function (title, message, isConfirm = false, isPrompt = false, defaultValue = '', showColor = false, defaultColor = '#a0a0a0') {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-modal');
        const titleEl = document.getElementById('custom-modal-title');
        const messageEl = document.getElementById('custom-modal-message');
        const cancelBtn = document.getElementById('custom-modal-cancel');
        const confirmBtn = document.getElementById('custom-modal-confirm');

        const inputContainer = document.getElementById('custom-modal-input-container');
        const inputEl = document.getElementById('custom-modal-input');
        const colorProxy = document.getElementById('custom-modal-color-proxy');
        const colorInput = document.getElementById('custom-modal-color');

        titleEl.textContent = title;
        messageEl.textContent = message;

        if (isPrompt) {
            inputContainer.style.display = 'flex';
            inputEl.style.display = 'block';
            inputEl.value = defaultValue;

            if (showColor) {
                colorProxy.style.display = 'inline-block';
                colorProxy.style.backgroundColor = defaultColor;
                colorInput.value = defaultColor;
            } else {
                colorProxy.style.display = 'none';
            }

            inputEl.focus();
        } else {
            inputContainer.style.display = 'none';
        }

        if (isConfirm || isPrompt) {
            cancelBtn.style.display = 'inline-block';
        } else {
            cancelBtn.style.display = 'none';
        }

        modal.style.display = 'flex';
        inputEl.focus()

        function cleanup() {
            modal.style.display = 'none';
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
        }

        function onConfirm() {
            cleanup();
            if (isPrompt) {
                if (showColor) {
                    resolve({ name: inputEl.value, color: colorInput.value });
                } else {
                    resolve(inputEl.value);
                }
            } else {
                resolve(true);
            }
        }

        function onCancel() {
            cleanup();
            resolve(isPrompt ? null : false);
        }

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
    });
};

window.customAlert = function (message) {
    showModal('Alert', message, false, false);
};

window.customConfirm = function (message, title = 'Confirm') {
    return showModal(title, message, true, false);
};

window.customPrompt = function (message, defaultValue = '', title = 'Prompt') {
    return showModal(title, message, true, true, defaultValue);
};

window.customGroupPrompt = function (message, defaultValue = '', defaultColor = '#a0a0a0', title = 'Group Settings') {
    return showModal(title, message, true, true, defaultValue, true, defaultColor);
};

/**
 * Recursively shifts child nodes when a parent's dimensions change.
 * @param {string} nodeId - The ID of the parent node.
 * @param {number} deltaX - The amount to shift in pixels on the x-axis.
 * @param {number} deltaY - The amount to shift in pixels on the y-axis.
 */
function shiftChildrenXY(nodeId, deltaX, deltaY) {
    if (deltaX === 0 && deltaY === 0) return;
    const children = nodes.filter(n => n.parentId === nodeId);
    children.forEach(c => {
        c.x += deltaX;
        c.y += deltaY;
        const el = document.getElementById(c.id);
        if (el) el.style.transform = `translate(${c.x}px, ${c.y}px)`;
        shiftChildrenXY(c.id, deltaX, deltaY);
    });
}

/**
 * Shows a toast notification at the top center of the screen.
 * @param {string} message - The message to display.
 * @param {string} type - The type of toast: 'success', 'error', 'warning', 'info' (default: 'info').
 * @param {number} duration - How long to show the toast in ms (default: 3000).
 */
function showToast(message, type = 'info', duration = 3000) {
    const toast = document.getElementById('custom-toast');
    if (!toast) return;

    toast.textContent = message;
    toast.className = 'custom-toast show ' + type;
    toast.style.display = 'block';

    // Force reflow to trigger transition
    toast.offsetHeight;

    clearTimeout(toast._hideTimeout);
    toast._hideTimeout = setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hide');
        setTimeout(() => {
            toast.style.display = 'none';
            toast.classList.remove('hide');
        }, 300);
    }, duration);
}

window.showToast = showToast;

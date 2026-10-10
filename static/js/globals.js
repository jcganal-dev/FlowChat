const $ = (id) => document.getElementById(id);
const $make = (tag) => document.createElement(tag);
const erase_thoughts = true;
const GRID_SIZE = 24;
const CONTEXT_LIMIT = 4096;
const textWhitelist = /\.(js|jsx|ts|tsx|py|html|css|json|txt|md|csv|tsv|xml|yaml|yml|ini|env|sh|bat|sql|c|cpp|h|hpp|java|go|rs|php|rb|swift|kt|cs|gitignore)$/i;
const exactNameWhitelist = /(Dockerfile|Makefile|LICENSE|README)$/i;
const imageWhitelist = /\.(png|jpg|jpeg|gif|webp|svg|ico)$/i;

let nodes = [];
let groups = {};
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
contextMenu.innerHTML = `
    <div class="context-item" id="menu-add-node"><img src="${getIconpath('chatnode')}" class="file-icon"> Add Chat Node</div>
    <div class="context-item" id="menu-add-image"><img src="${getIconpath('image')}" class="file-icon"> Add Image Node</div>
    <div class="context-item" id="menu-add-file"><img src="${getIconpath('file')}" class="file-icon"> Add Document Node</div>
    <div class="context-item" id="menu-open-palette"><img src="${getIconpath('sandbox')}" class="file-icon"> Open Sandbox Files</div>
    <div class="context-item" id="menu-rename-node"><img src="${getIconpath('pencil')}" class="file-icon"> Rename Node</div>
    <div class="context-item" id="menu-rename"><img src="${getIconpath('brush')}" class="file-icon"> Rename Branch</div>
    <div class="context-item" id="menu-toggle-node"></div>
    <div class="context-item" id="menu-summarize"><img src="${getIconpath('bulb')}" class="file-icon"> Summarize Node</div>
    <div class="context-item" id="menu-summarize-selected"><img src="${getIconpath('bulb')}" class="file-icon"> Summarize Selected Nodes</div>
    <div class="context-item" id="menu-expand-selected"><img src="${getIconpath('expand')}" class="file-icon"> Expand Selected Nodes</div>
    <div class="context-item" id="menu-collapse-selected"><img src="${getIconpath('collapse')}" class="file-icon"> Collapse Selected Nodes</div>
    <div class="context-item" id="menu-group"><img src="${getIconpath('group')}" class="file-icon"> Group Selected Nodes</div>
    <div class="context-item" id="menu-ungroup"><img src="${getIconpath('ungroup')}" class="file-icon"> Ungroup Node</div>
    <div class="context-item" id="menu-delete-node"><img src="${getIconpath('trash')}" class="file-icon"> Delete Node</div>
    <div class="context-item" id="menu-delete-selected"><img src="${getIconpath('trash')}" class="file-icon"> Delete Selected Nodes</div>
`;
document.body.appendChild(contextMenu);

const nodeResizeObserver = new ResizeObserver(() => {
    clearTimeout(layoutDebounceTimeout);
    layoutDebounceTimeout = setTimeout(() => {
        if (typeof drawEdges === 'function') drawEdges();
        if (typeof drawGroups === 'function') drawGroups();
    }, 30);
});

/**
 * Copies the given text to the system clipboard.
 * @param {string} text - The text to copy.
 */
async function copy_text(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch (err) {
        console.error('Failed to copy text: ', err);
    }
}

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
        case 'node':
            return '/static/icons/node.svg';
        case 'chatnode':
            return '/static/icons/chatnode.svg';
        case 'pencil':
            return '/static/icons/pencil.svg';
        case 'brush':
            return '/static/icons/brush.svg';
        case 'image':
            return '/static/icons/image.svg';
        case 'sandbox':
            return '/static/icons/sandbox.svg';
        case 'bulb':
            return '/static/icons/bulb.svg';
        case 'group':
            return '/static/icons/group.svg';
        case 'ungroup':
            return '/static/icons/ungroup.svg';
        case 'expand':
            return '/static/icons/expand.svg';
        case 'collapse':
            return '/static/icons/collapse.svg';
        case 'folder':
            return '/static/icons/folder.svg';
        case 'trash':
            return '/static/icons/trash.svg';
        case 'close':
            return '/static/icons/close.svg';
        case 'clock':
            return '/static/icons/clock.svg';
        case 'magnifying-glass':
            return '/static/icons/magnifying-glass.svg';
        case 'error':
            return '/static/icons/error.svg';
        case 'upload':
            return '/static/icons/upload.svg';
        case 'chevron-right':
            return '/static/icons/chevron-right.svg';
        case 'chevron-down':
            return '/static/icons/chevron-down.svg';
        case 'send':
            return '/static/icons/send.svg';
        case 'stop':
            return '/static/icons/stop.svg';
        default:
            return '/static/icons/default.svg';
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

        const html = marked.parse(text);

        // Configure DOMPurify to allow KaTeX attributes and tags
        return DOMPurify.sanitize(html, {
            ADD_TAGS: ['math', 'menclose', 'merror', 'mfrac', 'mi', 'mlabeledtr', 'mmultiscripts', 'mn', 'mo', 'mover', 'mpadded', 'mphantom', 'mroot', 'mrow', 'ms', 'mspace', 'msqrt', 'mstyle', 'msub', 'msubsup', 'msup', 'mtable', 'mtd', 'mtext', 'mtr', 'munder', 'semantics', 'annotation', 'annotation-xml'],
            ADD_ATTR: ['display', 'style', 'target', 'class']
        });
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

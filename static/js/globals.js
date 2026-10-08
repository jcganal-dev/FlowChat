const $ = (id) => document.getElementById(id);
const $make = (tag) => document.createElement(tag);
const erase_thoughts = true;
const GRID_SIZE = 24;
const CONTEXT_LIMIT = 4096;

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
    <div class="context-item" id="menu-add-node">Add Chat Node</div>
    <div class="context-item" id="menu-add-image">Add Image Node</div>
    <div class="context-item" id="menu-add-file">Add Document Node</div>
    <div class="context-item" id="menu-open-palette">Open Sandbox Files</div>
    <div class="context-item" id="menu-rename-node">Rename Node</div>
    <div class="context-item" id="menu-rename">Rename Branch</div>
    <div class="context-item" id="menu-summarize">Summarize Node</div>
    <div class="context-item" id="menu-group">Group Selected Nodes</div>
    <div class="context-item" id="menu-ungroup">Ungroup Node</div>
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

window.customConfirm = function (message) {
    return showModal('Confirm', message, true, false);
};

window.customPrompt = function (message, defaultValue = '') {
    return showModal('Prompt', message, true, true, defaultValue);
};

window.customGroupPrompt = function(message, defaultValue = '', defaultColor = '#a0a0a0') {
    return showModal('Group Settings', message, true, true, defaultValue, true, defaultColor);
};

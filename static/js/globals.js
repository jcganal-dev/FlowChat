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

const viewport = $('viewport');
const nodesLayer = $('nodes-layer');
const edgesLayer = $('edges-layer');
const contextMenu = $make('div');

contextMenu.id = 'context-menu';
contextMenu.innerHTML = `
    <div class="context-item" id="menu-add-node">Add Chat Node</div>
    <div class="context-item" id="menu-add-image">Add Image Node</div>
    <div class="context-item" id="menu-add-file">Add Document Node</div>
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

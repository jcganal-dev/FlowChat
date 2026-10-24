function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toolArgsPreview(argsJson) {
    try {
        const args = JSON.parse(argsJson || '{}');
        const first = Object.values(args)[0];
        const s = typeof first === 'string' ? first : JSON.stringify(first) || '';
        return s.length > 60 ? s.slice(0, 60) + '…' : s;
    } catch { return (argsJson || '').slice(0, 60); }
}

// One chip, either state. Used by both the streaming renderer and restore.
function renderToolChipHtml(seg) {
    const preview = escapeHtml(seg.argsPreview || '');
    if (seg.status === 'running') {
        return `<div class="tool-chip" data-seg-id="${escapeHtml(seg.id)}">` +
            `Tool call: <b>${escapeHtml(seg.name)}</b>(${preview || ""})</div>`;
    }
    return `<details class="tool-chip" data-seg-id="${escapeHtml(seg.id)}" ${seg.open ? 'open' : ''}>` +
        `<summary>Done: <b>${escapeHtml(seg.name)}</b>(${preview})</summary>` +
        `<pre class="tool-result">${escapeHtml(seg.result || '')}</pre></details>`;
}

// Kept for any external callers.
function renderToolChipsHtml(node) {
    const segs = Array.isArray(node.aiSegments) ? node.aiSegments : [];
    return segs.filter(s => s.type === 'tool_call').map(renderToolChipHtml).join('');
}

// Static one-shot think-stream HTML (restore / first paint).
function renderThinkStreamHtml(node) {
    const segs = (Array.isArray(node.aiSegments) ? node.aiSegments : [])
        .filter(s => s.type === 'reasoning' || s.type === 'tool_call');
    if (!segs.length) {
        return node.aiThinking ? `<div class="think-text">${renderReasoningHtml(node.aiThinking)}</div>` : '';
    }
    return segs.map(seg => seg.type === 'reasoning'
        ? `<div class="think-text">${renderReasoningHtml(seg.text || '')}</div>`
        : renderToolChipHtml(seg)
    ).join('');
}

const THINK_CAP = 20000;

// Sliding window over the reasoning text, so a runaway stream can't grow the DOM forever.
function capThinkText(text) {
    return text.length > THINK_CAP ? '…' + text.slice(-THINK_CAP) : text;
}

// Splits reasoning text into renderable blocks: prose and fenced code.
// A fence that is still streaming (no closing ``` yet) runs to the end of the text.
function splitReasoningBlocks(text) {
    const blocks = [];
    const fence = /```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g;
    let last = 0;
    let m;
    while ((m = fence.exec(text)) !== null) {
        if (m.index > last) blocks.push({ type: 'text', text: text.slice(last, m.index) });
        blocks.push({ type: 'code', lang: (m[1] || '').trim(), text: m[2] });
        last = fence.lastIndex;
    }
    if (last < text.length) blocks.push({ type: 'text', text: text.slice(last) });
    return blocks;
}

// Language tag of a code block, reduced to characters that are safe in a class attribute.
function safeLang(lang) {
    return String(lang || '').replace(/[^A-Za-z0-9_+#.-]/g, '');
}

// Static markup for one reasoning segment (restore path). Mirrors the DOM
// structure renderReasoningEl builds while streaming.
function renderReasoningHtml(text) {
    return splitReasoningBlocks(capThinkText(text || '')).map(block => block.type === 'text'
        ? `<div class="think-block" data-block-type="text">${escapeHtml(block.text)}</div>`
        : `<div class="think-block" data-block-type="code"><pre><code class="language-${safeLang(block.lang)}">${escapeHtml(block.text)}</code></pre></div>`
    ).join('');
}

// Diffs text into el with minimal DOM churn.
function updateThinkTextEl(el, text) {
    const shown = el._shown || '';
    if (text.startsWith(shown)) {
        if (text.length > shown.length) el.appendChild(document.createTextNode(text.slice(shown.length)));
        el._shown = text;
    } else {
        el.textContent = text;
        el._shown = text;
    }
}

// Renders one reasoning segment into its element.
// Prose blocks are appended as text nodes (cheap, and the text stays selectable
// while streaming); code blocks are re-rendered as <pre><code> and handed to
// Prism right after the markup is written — Prism can only highlight code that
// is already in the DOM.
function renderReasoningEl(el, text) {
    const blocks = splitReasoningBlocks(capThinkText(text || ''));
    while (el.childElementCount > blocks.length) el.lastElementChild.remove();
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        let child = el.children[i];
        if (block.type === 'text') {
            if (!child || child.dataset.blockType !== 'text') {
                const fresh = document.createElement('div');
                fresh.className = 'think-block';
                fresh.dataset.blockType = 'text';
                if (child) el.replaceChild(fresh, child); else el.appendChild(fresh);
                child = fresh;
            }
            if (child._shown === undefined) {   // fresh or cloned element: seed it
                child.textContent = '';
                child._shown = '';
            }
            updateThinkTextEl(child, block.text);
        } else {
            if (!child || child.dataset.blockType !== 'code') {
                const fresh = document.createElement('div');
                fresh.className = 'think-block';
                fresh.dataset.blockType = 'code';
                if (child) el.replaceChild(fresh, child); else el.appendChild(fresh);
                child = fresh;
            }
            if (child._code !== block.text || child._lang !== block.lang) {
                child._code = block.text;
                child._lang = block.lang;
                child.innerHTML = `<pre><code class="language-${safeLang(block.lang)}">${escapeHtml(block.text)}</code></pre>`;
                if (window.Prism) Prism.highlightAllUnder(child);
            }
        }
    }
}

// Incrementally reconciles container children with the node's reasoning +
// tool_call segments, in stream order. Text is appended as text nodes; chips
// are only re-rendered when their own HTML changes, so a chip's <details>
// open state survives later updates to other segments.
function renderThinkStream(container, node) {
    if (!container) return;
    const segs = (node.aiSegments || []).filter(s => s.type === 'reasoning' || s.type === 'tool_call');
    while (container.childElementCount > segs.length) container.lastElementChild.remove();
    for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        let el = container.children[i] || null;
        if (seg.type === 'reasoning') {
            if (!el || el.dataset.segType !== 'reasoning') {
                const fresh = document.createElement('div');
                fresh.className = 'think-text';
                fresh.dataset.segType = 'reasoning';
                if (el) container.replaceChild(fresh, el); else container.appendChild(fresh);
                el = fresh;
            }
            renderReasoningEl(el, seg.text || '');
        } else {
            if (!el || el.dataset.segType !== 'tool_call') {
                const fresh = document.createElement('div');
                fresh.dataset.segType = 'tool_call';
                if (el) container.replaceChild(fresh, el); else container.appendChild(fresh);
                el = fresh;
            }
            const html = renderToolChipHtml(seg);
            if (el._chipHtml !== html) {
                el.innerHTML = html;
                el._chipHtml = html;
            }
        }
    }
}

// Answer = text segments only. Never contains reasoning or chips.
function renderAnswerHtml(node) {
    let text = node.aiText || '';
    if (Array.isArray(node.aiSegments) && node.aiSegments.length) {
        text = node.aiSegments.filter(s => s.type === 'text').map(s => s.text).join('\n\n');
    }
    return (typeof renderMarkdown === 'function') ? renderMarkdown(text) : escapeHtml(text);
}

// Add fade bottom and top based on scroll height
function addFade(parentelement, reset=false) {
    const element = parentelement && parentelement.querySelector('.think-stream')
    if (!element) return
    const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight
    const atTop = element.scrollTop <= 0
    if (reset) {
        element.classList.remove('fade-top')
        element.classList.remove('fade-bottom')
        element.classList.remove('fade-both')
        return
    }
    if (!atBottom && !atTop) {
        element.classList.add('fade-both')
    } else {
        element.classList.remove('fade-both')
    }
    if (!atBottom) {
        element.classList.add('fade-bottom')
    } else {
        element.classList.remove('fade-bottom')
    }
    if (!atTop) {
        element.classList.add('fade-top')
    } else {
        element.classList.remove('fade-top')
    }
}

class ChatNode extends BaseNode {
    constructor(config) {
        config.type = 'chat';
        super(config);
        const runStyle = this.nodeData.aiText || this.nodeData.aiThinking ? 'display: none;' : '';
        const inputContent = this.config.restoreData ? (this.nodeData.htmlText || this.nodeData.userText) : this.config.initialUserText;
        const isEditable = this.config.restoreData && this.nodeData.aiText ? 'false' : 'true';
        const thinkHtml = renderThinkStreamHtml(this.nodeData);
        this.el.innerHTML = `
            <div class="handle handle-in"></div>
            <div class="node-header">
                <div class="header-name">
                    <span class="node-icon" style="display: flex; justify-content:center; align-items: center;">
                        ${chatIcon()}
                    </span>
                    <span class="node-id" title="Shift+Click to insert reference" onmousedown="if(event.shiftKey) event.preventDefault();" onclick="handleIdClick(event, '${this.id}')" data-text="${this.id.replaceAll('_', ' ')}"></span>
                </div>
                <div>
                    <a class="toggle-btn" title="Toggle Summary" style="cursor: pointer; ${this.nodeData.summaryText ? 'display: flex;' : 'display: none;'}" onclick="event.stopPropagation(); if(typeof toggleNodeState === 'function') toggleNodeState('${this.id}')">${this.nodeData.isCollapsed ? '<img src="/static/icons/expand.svg" class="file-icon">' : '<img src="/static/icons/collapse.svg" class="file-icon">'}</a>
                    <a class="duplicate-btn" title="Duplicate Branch"><img src="/static/icons/duplicate.svg" class="file-icon"></a>
                    <a class="delete-btn" title="Delete"><img src="/static/icons/close.svg" class="file-icon"></a>
                </div>
            </div>
            <div class="user-section">
                <div contenteditable="${isEditable && !this.nodeData.aiText && !this.nodeData.aiThinking}" class="node-input" spellcheck="true" placeholder="Type prompt here...">${inputContent}</div>
                <div class="button-row" style="${runStyle}">
                    <div class="model-select-container">
                        <div class="model-select-parent" style="position:fixed;margin-top:-13px;display:flex;flex-direction:column;gap:0px;max-width: 225px;z-index:11;">
                            <a class="model-selection">Loading Models...</a>
                            <div class="model-list" style="visibility: hidden; pointer-events: none;"></div>
                        </div>
                    </div>
                    <button class="run-btn"><img src="/static/icons/send.svg" class="file-icon" style="margin:0px"> Send</button>
                    <button class="stop-btn" style="display: none; background: #ff5555; color: white;"><img src="/static/icons/stop.svg" class="file-icon" style="margin:0px"> Stop</button>
                </div>
            </div>
            <div class="ai-section">
                <details class="think-content" style="${thinkHtml ? 'display:flex;' : 'display:none'}">
                    <summary class='outer-summary'>Thoughts</summary>
                    <div class="think-stream">
                        ${thinkHtml}
                    </div>
                </details>
                <div class="ai-content">${this.nodeData.aiText ? renderAnswerHtml(this.nodeData) : ''}</div>
            </div>
            <div class="node-summary-display">${this.nodeData.summaryText ? (typeof renderMarkdown === 'function' ? renderMarkdown(this.nodeData.summaryText) : this.nodeData.summaryText) : ''}</div>
            <div class="handle handle-out"></div>
            <button class="add-child-btn ${this.nodeData.aiText || this.nodeData.aiThinking? '' : 'hidden'}" title="Branch">+</button>
            <div class="resize-handle"></div>
        `;

        this.modelSelectBtn = this.el.querySelector('.model-selection');
        this.modelSelectBtn.addEventListener('click', () => {
            const modelList = this.el.querySelector('.model-list')
            modelList.style = modelList.style.visibility == 'hidden' ? 'visibility: visible; pointer-events: all;' : 'visibility: hidden; pointer-events: none; height: 0px;'; 
        })
        this.modelSelPar = this.el.querySelector('.model-select-parent')
        this.modelSelPar.addEventListener('mouseleave', () => {
            this.el.querySelector('.model-list').style = 'visibility: hidden; pointer-events: none; height: 0px;'; 
        })
        this.runBtn = this.el.querySelector('.run-btn');
        this.textarea = this.el.querySelector('.node-input');
        this.addBtn = this.el.querySelector('.add-child-btn');

        // Initialize selectedModel from restore data, inherited model, or parent
        if (!this.nodeData.selectedModel && this.config.inheritedModel) {
            this.nodeData.selectedModel = this.config.inheritedModel;
        }
        this.dupBtn = this.el.querySelector('.duplicate-btn');
        this.stopBtn = this.el.querySelector('.stop-btn');
        this.deleteBtn = this.el.querySelector('.delete-btn');
        this.handleIn = this.el.querySelector('.handle-in');
        this.handleOut = this.el.querySelector('.handle-out');
        this.handleIn.addEventListener('mouseout', () => {
            this.handleIn.classList.remove('handle-active')
            this.handleIn.classList.remove('handle-inactive')
        })
        this.handleOut.addEventListener('mouseout', () => {
            this.handleOut.classList.remove('handle-active')
            this.handleOut.classList.remove('handle-inactive')
        })
        this.addBtn.addEventListener('mouseout', () => {
            this.addBtn.classList.remove('add-child-btn-active')
            this.addBtn.classList.remove('add-child-btn-inactive')
        })
        this.stopBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.nodeData && this.nodeData.abortController) this.nodeData.abortController.abort();
        });
        this.thinkContent = this.el.querySelector('.think-content');
        this.thinkStream = this.thinkContent.querySelector('.think-stream');
        // Restore path: the reasoning markup is already in the DOM, so its code
        // blocks can be highlighted right away (the streaming path highlights
        // them as it renders).
        if (window.Prism) Prism.highlightAllUnder(this.thinkStream);
        this.thinkStream.addEventListener('scroll', () => {
            addFade(this.thinkContent)
        })
        this.thinkContent.addEventListener('click', () => { 
            this.nodeData.oldHeight = this.el.offsetHeight
            setTimeout(() => {
                addFade(this.thinkContent, !this.thinkContent.open)
                const deltaY = this.el.offsetHeight-this.nodeData.oldHeight
                if (typeof shiftChildrenXY === 'function') shiftChildrenXY(this.nodeData.id, 0, deltaY);
            }, 1)
        })
        this.runBtn.addEventListener('click', this.run.bind(this));
        this.textarea.addEventListener('focus', () => {
            lastFocusedInput = this.textarea;
            document.body.classList.add('input-focused');
        });
        this.textarea.addEventListener('blur', () => {
            lastFocusedInput = null;
            document.body.classList.remove('input-focused');
        });
        this.textarea.addEventListener('drop', async (e) => {
            const data = e.dataTransfer.getData('text/plain');
            if (!data) return;
            try {
                const parsed = JSON.parse(data);
                if (Array.isArray(parsed)) {
                    e.preventDefault(); e.stopPropagation();
                    const selection = window.getSelection();
                    let range = null;
                    if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(e.clientX, e.clientY);
                    else if (e.rangeParent) {
                        range = document.createRange();
                        range.setStart(e.rangeParent, e.rangeOffset);
                    }
                    if (range) {
                        selection.removeAllRanges();
                        selection.addRange(range);
                    }
                    lastFocusedInput = this.textarea;
                    document.body.classList.add('input-focused');
                    const filteredPaths = parsed.filter(p => !parsed.some(other => other !== p && p.startsWith(other + '/')));
                    for (const filepath of filteredPaths) {
                        if (typeof handleSandboxFileShiftClick === 'function') await handleSandboxFileShiftClick(filepath);
                    }
                    selectedSandboxFiles.clear();
                    lastSelectedSandboxFileIndex = -1;
                    if (typeof updateSidebarSelection === 'function') updateSidebarSelection();
                    if (typeof updateFocusFileSelection === 'function') updateFocusFileSelection();
                }
            } catch (err) { }
        });

        this.textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.run();
            }
        });
        this.textarea.addEventListener('input', () => {
            const chips = Array.from(this.textarea.querySelectorAll('.reference-node'));
            this.nodeData.references = chips.map(chip => chip.getAttribute('data-ref'));
            if (typeof drawEdges === 'function') drawEdges();
        });
        this.addBtn.addEventListener('click', this.onFork.bind(this));
        this.dupBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            forkOffsetCounter += 1;
            const data = nodes.find(n => n.id === this.el.id);
            const forkX = data.x + 336;
            // Pass selectedModel so child inherits parent's model choice
            const selectedModel = this.nodeData.selectedModel || '';
            const newId = createNode(data.parentId, forkX, data.y, this.textarea.innerHTML, data.turn, data.branch, data.name, null, 'chat', selectedModel);
            const newEl = document.getElementById(newId);
            const newData = nodes.find(n => n.id === newId);
            if (newEl && newData && data.nodeWidth) {
                newData.nodeWidth = data.nodeWidth;
                newEl.style.width = data.nodeWidth + 'px';
            }
        });
        this.deleteBtn.addEventListener('click', this.onDelete.bind(this));
        this.el.addEventListener('click', (e) => {
            if (this.el.dataset.dragged) return;
            if (!e.target.closest('button') && !e.target.closest('textarea')) {
                selectNode(this.el.id, e.shiftKey, e.ctrlKey || e.metaKey);
            }
        });
        this.attachBaseListeners(this.config.restoreData);

        // Populate model selection dropdown
        this.populateModelSelection();
    }

    async populateModelSelection() {
        const selectBtn = this.el.querySelector('.model-selection');
        const selectEl = this.el.querySelector('.model-list');
        if (!selectEl) return;

        // Add a default/loading option
        selectBtn.innerHTML = 'Loading models...';

        try {
            const models = await getCachedModels();
            if (models && models.length > 0) {
                selectEl.innerHTML = models.map(m => 
                    `<div class="model-option" value="${m.id}" title="${m.name || m.id}">${m.name || m.id}</div>`
                ).join('');
                // Restore previously selected model if any
                if (this.nodeData.selectedModel) {
                    selectBtn.innerHTML = selectEl.querySelector(`[value="${this.nodeData.selectedModel}"]`).innerHTML;
                } else {
                    selectBtn.innerHTML = selectEl.querySelector(`[value="openrouter/free"]`).innerHTML;
                }
            } else {
                selectBtn.innerHTML = 'No free models found';
            }
        } catch (e) {
            console.error("Failed to populate models:", e);
            selectBtn.innerHTML = 'Error loading models';
        }

        // Store selected model when changed
        selectEl.addEventListener('click', (e) => {
            const target = e.target.closest('.model-option')
            selectBtn.innerHTML = target.innerHTML
            this.nodeData.selectedModel = target.getAttribute('value');
            this.el.querySelector('.model-list').style = 'visibility: hidden; pointer-events: none; height: 0px;'
        });
    }

    async run() {
        // P0 Fix: Prevent re-entry if already streaming
        if (this.nodeData.abortController) {
            return;
        }
        const usertext = this.textarea.textContent.trim();
        if (!usertext) return;
        const chips = Array.from(this.el.querySelectorAll('.reference-node'));
        const refs = chips.map(chip => chip.getAttribute('data-ref')).filter(id => id);
        this.nodeData.references = refs;
        this.nodeData.userText = usertext;
        this.nodeData.aiText = "";
        this.nodeData.aiThinking = "";
        this.nodeData.aiSegments = [{ type: 'text', text: '' }];
        this.nodeData.abortController = new AbortController();
        const signal = this.nodeData.abortController.signal;
        const aiContentEl = this.el.querySelector('.ai-content');
        const aiThinkEl = this.el.querySelector('.think-content');
        aiContentEl.innerHTML = '';
        // One streaming container: reasoning text and tool chips interleave in order.
        // Append as a real element: `innerHTML +=` re-parses the whole subtree, which
        // would swap out .think-stream and silently drop its scroll listener.
        const placeholderEl = document.createElement('div');
        placeholderEl.className = 'think-placeholder';
        placeholderEl.style.cssText = 'display:flex;flex-direction:row;align-items:center;';
        placeholderEl.innerHTML = `<img src="/static/icons/hourglass.svg" class='file-icon'> Thinking...`;
        aiThinkEl.appendChild(placeholderEl);
        aiThinkEl.open = true
        const thinkStreamEl = aiThinkEl.querySelector('.think-stream');
        this.thinkStream = thinkStreamEl;   // keep the reference pointing at the live element
        const thinkPlaceholder = aiThinkEl.querySelector('.think-placeholder');
        // Persist <details> open state back into the segment (toggle doesn't bubble -> capture).
        thinkStreamEl.addEventListener('toggle', (e) => {
            const chip = e.target;
            const id = chip.getAttribute && chip.getAttribute('data-seg-id');
            const seg = (this.nodeData.aiSegments || []).find(s => s.type === 'tool_call' && s.id === id);
            if (seg) seg.open = chip.open;
        }, true);
        aiThinkEl.style.display = "flex";
        this.textarea.contentEditable = false;
        this.runBtn.style.display = 'none';
        if (this.stopBtn) this.stopBtn.style.display = 'flex';
        forkOffsetCounter = 0;
        const history = walkContext(this.id);
        if (refs.length > 0) {
            let systemDirectives = "STRICT INSTRUCTIONS FROM REFERENCED NODES:\n";
            let hasImageRefs = false;
            const imageContents = [];
            let hasTextRefs = false;
            refs.forEach(rId => {
                // A reference can point at a single node or at a group; a group
                // expands to its member nodes so their files come along too.
                const refPayload = resolveReferencePayload(rId);
                refPayload.text.forEach(t => systemDirectives += `\n${t}\n`);
                if (refPayload.text.length > 0) hasTextRefs = true;
                if (refPayload.images.length > 0) {
                    hasImageRefs = true;
                    refPayload.images.forEach(img => imageContents.push(img));
                }
            });
            if (hasTextRefs) {
                if (history.length > 0 && history[0].role === 'system') history[0].content += "\n\n" + systemDirectives;
                else history.unshift({ role: 'system', content: systemDirectives });
            }
            if (hasImageRefs && imageContents.length > 0) {
                // Attach the images to the most recent user message so they
                // travel with the prompt instead of being dropped.
                let targetMsg = null;
                for (let i = history.length - 1; i >= 0; i--) {
                    if (history[i].role === 'user') { targetMsg = history[i]; break; }
                }
                if (targetMsg) {
                    if (typeof targetMsg.content === 'string') {
                        targetMsg.content = [{ type: "text", text: targetMsg.content }, ...imageContents];
                    } else if (Array.isArray(targetMsg.content)) {
                        targetMsg.content = [...targetMsg.content, ...imageContents];
                    }
                } else {
                    history.push({ role: 'user', content: imageContents });
                }
            }
        }
        let aborted = false;
        this.textarea.style.border = "none";
        // this.textarea.style.background = "transparent";
        // this.textarea.style.height = "auto";
        // this.textarea.style.color = "#eee";
        let erased_thoughts = false;
        if (history.length > 0) {
            const lastMsg = history[history.length - 1];
            if (lastMsg.role === 'user') {
                const reminderText = `${systemReminders ? `[System Reminder] ${systemReminders} [End System Reminder]`:""}\n`;
                if (typeof lastMsg.content === 'string') lastMsg.content = reminderText + lastMsg.content;
                else if (Array.isArray(lastMsg.content) && lastMsg.content.length > 0 && lastMsg.content[0].type === 'text') {
                    lastMsg.content[0].text = reminderText + lastMsg.content[0].text;
                }
            }
        }
        const payload = { messages: history, max_tokens: 1000 };
        // Get selected model from dropdown
        const modelSelect = this.el.querySelector('.model-selection');
        const selectedModel = modelSelect ? modelSelect.getAttribute('value') : '';
        if (selectedModel) {
            this.nodeData.selectedModel = selectedModel; // Persist for restore
        }
        let uiDirty = false;
        const syncThinkVisibility = () => {
            const segs = this.nodeData.aiSegments || [];
            const hasReasoning = segs.some(s => s.type === 'reasoning' && s.text && s.text.trim() !== '');
            const hasChips = segs.some(s => s.type === 'tool_call');
            aiThinkEl.style.display = (hasReasoning || hasChips) ? 'flex' : 'none';
        };
        const flushUi = () => {
            uiDirty = false;
            aiContentEl.innerHTML = renderAnswerHtml(this.nodeData);   // answer ALWAYS goes here
            if (aiThinkEl.isConnected) {
                renderThinkStream(thinkStreamEl, this.nodeData);       // reasoning + chips, in stream order
                // Only auto-scroll if user is already near the bottom (within 100px)
                const thughtsIsNearBottom = thinkStreamEl.scrollTop + thinkStreamEl.clientHeight >= thinkStreamEl.scrollHeight - 100;
                if (thughtsIsNearBottom) {
                    thinkStreamEl.scrollTop = thinkStreamEl.scrollHeight;
                }
                const aiSection = this.el.querySelector('.ai-section')
                const contentIsNearBottom = aiSection.scrollTop + aiSection.clientHeight >= aiSection.scrollHeight - 100;
                if (contentIsNearBottom) {
                    aiSection.scrollTop = aiSection.scrollHeight;
                }
            }
            if (typeof drawEdges === 'function') drawEdges();
        };
        const requestUiFlush = () => {
            if (uiDirty) return;
            uiDirty = true;
            requestAnimationFrame(flushUi);
        };

        await streamChatApi(payload, signal, {
            onContent: (content) => {
                if (thinkPlaceholder.isConnected) thinkPlaceholder.remove();
                if (!erased_thoughts) {
                    erased_thoughts = true;
                    if (typeof erase_thoughts !== 'undefined' && erase_thoughts) {
                        // Put think content into a summary tag
                        const thinkContent = this.el.querySelector('.think-stream')
                        thinkContent.innerHTML = thinkContent.innerHTML;
                        this.nodeData.aiSegments = this.nodeData.aiSegments.filter(s => s.type !== 'reasoning');
                    }
                }
                this.nodeData.aiText += content;
                const segs = this.nodeData.aiSegments;
                let last = segs[segs.length - 1];
                if (!last || last.type !== 'text') {
                    last = { type: 'text', text: '' };
                    segs.push(last);
                }
                last.text += content;
                syncThinkVisibility();
                requestUiFlush();
                if (typeof onNodeStreamUpdate === 'function') onNodeStreamUpdate(this.id, 'content', this.nodeData.aiText);
            },
            onToolCallStart: (tc) => {
                if (thinkPlaceholder.isConnected) thinkPlaceholder.remove();
                const segs = this.nodeData.aiSegments;
                // Avoid dupes if the same id somehow announces twice
                if (segs.some(s => s.type === 'tool_call' && s.id === tc.id)) return;
                segs.push({
                    type: 'tool_call',
                    id: tc.id,
                    name: tc.name,
                    argsPreview: '',
                    rawArgs: '',
                    status: 'running',
                    result: ''
                });
                syncThinkVisibility();
                requestUiFlush();
                if (typeof onNodeStreamUpdate === 'function') onNodeStreamUpdate(this.id, 'tool_call_start', tc);
            },
            onToolCall: (tc) => {
                if (thinkPlaceholder.isConnected) thinkPlaceholder.remove();
                const segs = this.nodeData.aiSegments;
                let seg = segs.find(s => s.type === 'tool_call' && s.id === tc.id);
                if (!seg) {
                    // Fallback in case tool_call_start was missed (e.g. restore from history)
                    seg = { type: 'tool_call', id: tc.id, name: tc.name, argsPreview: '', rawArgs: '', status: 'running', result: '' };
                    segs.push(seg);
                }
                seg.name        = tc.name || seg.name;
                seg.rawArgs     = tc.arguments || '';
                seg.argsPreview = toolArgsPreview(seg.rawArgs);
                syncThinkVisibility();
                requestUiFlush();
                if (typeof onNodeStreamUpdate === 'function') onNodeStreamUpdate(this.id, 'tool_call', tc);
            },
            onToolResult: (tr) => {
                const segs = this.nodeData.aiSegments || [];
                for (let i = segs.length - 1; i >= 0; i--) {
                    const s = segs[i];
                    if (s.type === 'tool_call' && s.status === 'running' &&
                        (tr.id ? s.id === tr.id : s.name === tr.name)) {
                        s.status = 'done';
                        s.result = tr.result || '';
                        break;
                    }
                }
                requestUiFlush();   // chip flips to Done in place — nothing around it re-renders

                // Refresh sandbox UI if a file-modifying tool was used
                if (['write_file', 'edit_file', 'delete_file'].includes(tr.name)) {
                    if (typeof fetchSandboxFiles === 'function') fetchSandboxFiles();
                    if (typeof renderFocusProjectFiles === 'function') renderFocusProjectFiles();
                }
                if (typeof onNodeStreamUpdate === 'function') onNodeStreamUpdate(this.id, 'tool_result', tr);
            },
            onReasoning: (reasoning) => {
                if (thinkPlaceholder.isConnected) thinkPlaceholder.remove();
                this.nodeData.aiThinking += reasoning;
                const segs = this.nodeData.aiSegments;
                let last = segs[segs.length - 1];
                if (!last || last.type !== 'reasoning') {
                    last = { type: 'reasoning', text: '' };
                    segs.push(last);
                }
                last.text += reasoning;
                syncThinkVisibility();
                requestUiFlush();
                if (typeof onNodeStreamUpdate === 'function') onNodeStreamUpdate(this.id, 'reasoning', this.nodeData.aiThinking);
            },
            onError: (error) => {
                if (error.name === 'AbortError' || (error.message && error.message.includes('AbortError'))) {
                    this.nodeData.abortController = null
                    aborted = true;
                    aiContentEl.innerHTML += `<br><br><span style="color: #ffb86c; font-size: 12px;">[Stopped by User]</span>`;
                    this.textarea.contentEditable = true;
                    this.textarea.style.border = "";
                    this.textarea.style.background = "";
                    this.runBtn.style.display = 'flex';
                    this.stopBtn.style.display = 'none';
                    this.addBtn.classList.remove('hidden')
                } else aiContentEl.innerHTML = `<span style="color: #ff5555;">Error: ${error.message}</span>`;
                if (typeof onNodeStreamUpdate === 'function') onNodeStreamUpdate(this.id, 'error', error, aborted);
            },
            onComplete: () => {
                if (thinkPlaceholder.isConnected) thinkPlaceholder.remove();
                syncThinkVisibility();
                if (window.Prism) Prism.highlightAllUnder(aiContentEl);
                this.el.querySelector('.add-child-btn').classList.remove('hidden');
                // Stream stays visible after completion: reasoning + Done chips remain inspectable.
                // If you want the old wipe-on-finish behavior, uncomment:
                // this.nodeData.aiThinking = '';
                // this.nodeData.aiSegments = [];
                aiThinkEl.open=false
                if (this.nodeData.childNodeIds.length === 0) this.el.querySelector('.add-child-btn').click()
                if (typeof saveState === 'function') saveState();
                if (typeof onNodeStreamUpdate === 'function') onNodeStreamUpdate(this.id, 'complete');
                autoLayout(true, this.nodeData.id);
            }
        }, selectedModel);
        if (!aborted) {
            const btnRow = this.el.querySelector('.button-row');
            if (btnRow) btnRow.style.display = 'none';
        }
        if (!this.textarea.disabled) this.textarea.disabled = false;
    }
}
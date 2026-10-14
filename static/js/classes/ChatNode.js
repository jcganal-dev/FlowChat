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

// Answer = text segments only. Never contains reasoning or chips.
function renderAnswerHtml(node) {
    let text = node.aiText || '';
    if (Array.isArray(node.aiSegments) && node.aiSegments.length) {
        text = node.aiSegments.filter(s => s.type === 'text').map(s => s.text).join('\n\n');
    }
    return (typeof renderMarkdown === 'function') ? renderMarkdown(text) : escapeHtml(text);
}

// Chips render separately, into the think box's tools sub-div.
function renderToolChipsHtml(node) {
    const segs = Array.isArray(node.aiSegments) ? node.aiSegments : [];
    return segs.filter(s => s.type === 'tool_call').map(seg => {
        const preview = escapeHtml(seg.argsPreview || '');
        if (seg.status === 'running') {
            return `<div class="tool-chip" data-seg-id="${escapeHtml(seg.id)}">` +
                `Running:<b>${escapeHtml(seg.name)}</b>(${preview})</div>`;
        }
        return `<details class="tool-chip" data-seg-id="${escapeHtml(seg.id)}" ${seg.open ? 'open' : ''}>` +
            `<summary>Done: <b>${escapeHtml(seg.name)}</b>(${preview})</summary>` +
            `<pre class="tool-result">${escapeHtml(seg.result || '')}</pre></details>`;
    }).join('');
}

class ChatNode extends BaseNode {
    constructor(config) {
        config.type = 'chat';
        super(config);
        const runStyle = this.nodeData.aiText || this.nodeData.aiThinking ? 'display: none;' : '';
        const inputContent = this.config.restoreData ? (this.nodeData.htmlText || this.nodeData.userText) : this.config.initialUserText;
        const isEditable = this.config.restoreData && this.nodeData.aiText ? 'false' : 'true';
        this.el.innerHTML = `
            <div class="handle handle-in"></div>
            <div class="node-header">
                <div class="header-name">
                    <span class="node-icon" style="display: flex; justify-content:center; align-items: center;">
                        ${this.nodeData.type === 'image'? imageIcon() : documentIcon()}
                    </span>
                    <span class="node-id" title="Shift+Click to insert reference" onmousedown="if(event.shiftKey) event.preventDefault();" onclick="handleIdClick(event, '${this.id}')" data-text="${this.id.replaceAll('_', ' ')}"></span>
                </div>
                <div>
                    <a class="toggle-btn" title="Toggle Summary" style="cursor: pointer; ${this.nodeData.summaryText ? 'display: flex;' : 'display: none;'}" onclick="event.stopPropagation(); if(typeof toggleNodeState === 'function') toggleNodeState('${this.id}')">${this.nodeData.isCollapsed ? '<img src="/static/icons/expand.svg" class="file-icon">' : '<img src="/static/icons/collapse.svg" class="file-icon">'}</a>
                    <a class="duplicate-btn" title="Duplicate Branch"><img src="/static/icons/file.svg" class="file-icon"></a>
                    <a class="delete-btn" title="Delete"><img src="/static/icons/close.svg" class="file-icon"></a>
                </div>
            </div>
            <div class="user-section">
                <div contenteditable="${isEditable}" class="node-input" spellcheck="true" placeholder="Type prompt here...">${inputContent}</div>
                <div class="button-row" style="${runStyle}">
                    <button class="run-btn"><img src="/static/icons/send.svg" class="file-icon" style="margin:0px"> Send</button>
                    <button class="stop-btn" style="display: none; background: #ff5555; color: white;"><img src="/static/icons/stop.svg" class="file-icon" style="margin:0px"> Stop</button>
                </div>
            </div>
            <div class="ai-section">
                <div class="think-content" style="display:none">
                    <div class="think-text">
                        ${this.nodeData.aiThinking || ''}
                    </div>
                    <div class="think-tools"></div>
                </div>
                <div class="ai-content">${this.nodeData.aiText ? renderAnswerHtml(this.nodeData) : ''}</div>
            </div>
            <div class="node-summary-display">${this.nodeData.summaryText ? (typeof renderMarkdown === 'function' ? renderMarkdown(this.nodeData.summaryText) : this.nodeData.summaryText) : ''}</div>
            <div class="handle handle-out"></div>
            <button class="add-child-btn ${this.nodeData.aiText ? '' : 'hidden'}" title="Branch">+</button>
            <div class="resize-handle"></div>
        `;
        this.runBtn = this.el.querySelector('.run-btn');
        this.textarea = this.el.querySelector('.node-input');
        this.addBtn = this.el.querySelector('.add-child-btn');
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
        this.textarea.addEventListener('keyup', (e) => {
            if (e.key === ' ') {
                const selection = window.getSelection();
                if (!selection.rangeCount) return;
                const range = selection.getRangeAt(0);
                const textNode = range.startContainer;
                if (textNode.nodeType === Node.TEXT_NODE) {
                    const text = textNode.textContent;
                    const cursorOffset = range.startOffset;
                    const textBeforeCursor = text.slice(0, cursorOffset);
                    const refRegex = /@([\w()-]+)\s$/;
                    const match = textBeforeCursor.match(refRegex);
                    if (match) {
                        const refName = match[1];
                        let isGroup = false;
                        let targetId = null;
                        const refNode = nodes.find(n => n.id === refName);
                        if (refNode && refNode.id !== this.el.id) {
                            targetId = refName;
                        } else {
                            const groupObj = Object.values(groups).find(g => g.name === refName || g.id === refName);
                            if (groupObj) {
                                targetId = groupObj.id;
                                isGroup = true;
                            }
                        }
                        if (targetId) {
                            const delRange = document.createRange();
                            delRange.setStart(textNode, match.index);
                            delRange.setEnd(textNode, cursorOffset);
                            delRange.deleteContents();
                            const newRange = document.createRange();
                            newRange.setStart(textNode, match.index);
                            newRange.collapse(true);
                            insertChipAtRange(this.textarea, newRange, targetId, isGroup);
                        }
                    }
                }
            }
        });
        this.textarea.addEventListener('input', () => {
            const chips = Array.from(this.textarea.querySelectorAll('.reference-node'));
            this.nodeData.references = chips.map(chip => chip.getAttribute('data-ref'));
            if (typeof drawEdges === 'function') drawEdges();
        });
        this.addBtn.addEventListener('click', this.onFork.bind(this));
        this.addBtn.addEventListener('click', () => {
            this.onFork.bind(this)
            autoLayout(true, this.nodeData.id)
            centerCanvas()
        });
        this.dupBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            forkOffsetCounter += 1;
            const data = nodes.find(n => n.id === this.el.id);
            const forkX = data.x + 360;
            const newId = createNode(data.parentId, forkX, data.y, this.textarea.innerHTML, data.turn, data.branch, data.name);
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
    }

    async run() {
        const usertext = this.textarea.textContent.trim();
        if (!usertext) return;
        const chips = Array.from(this.el.querySelectorAll('.reference-node'));
        const refs = chips.map(chip => chip.getAttribute('data-ref')).filter(id => id);
        this.nodeData.references = refs;
        this.nodeData.userText = usertext;
        this.nodeData.aiText = "";
        this.nodeData.aiThinking = "";
        this.nodeData.aiSegments = [{ type: 'text', text: '' }];   // was missing — stale segments leaked between runs
        this.nodeData.abortController = new AbortController();
        const signal = this.nodeData.abortController.signal;
        const aiContentEl = this.el.querySelector('.ai-content');
        const aiThinkEl = this.el.querySelector('.think-content');
        this.el.style.width = '';
        aiContentEl.innerHTML = '';
        // Stable sub-containers: reasoning text nodes and chips live in separate divs,
        // so updating one never destroys the other.
        aiThinkEl.innerHTML =
            `<div class="think-placeholder" style="display:flex;flex-direction:row;align-items:center;">` +
            `<img src="/static/icons/hourglass.svg" class='file-icon'> Thinking...</div>` +
            `<div class="think-text"></div>` +
            `<div class="think-tools"></div>`;
        const thinkTextEl = aiThinkEl.querySelector('.think-text');
        const thinkToolsEl = aiThinkEl.querySelector('.think-tools');
        const thinkPlaceholder = aiThinkEl.querySelector('.think-placeholder');
        aiThinkEl.style.display = "flex";
        this.textarea.contentEditable = false;
        this.runBtn.style.display = 'none';
        if (this.stopBtn) this.stopBtn.style.display = 'flex';
        forkOffsetCounter = 0;
        const history = walkContext(this.id);
        updateThermometer(this.id);
        if (refs.length > 0) {
            let systemDirectives = "STRICT INSTRUCTIONS FROM REFERENCED NODES:\n";
            let hasImageRefs = false;
            const imageContents = [];
            let hasTextRefs = false;
            refs.forEach(rId => {
                const rNode = nodes.find(n => n.id === rId);
                if (rNode) {
                    if (rNode.type === 'image' && (rNode.files && rNode.files.length > 0)) {
                        hasImageRefs = true;
                        rNode.files.forEach(f => imageContents.push({ type: "image_url", image_url: { url: f.payload } }));
                    } else if (rNode.type === 'document' && (rNode.files && rNode.files.length > 0)) {
                        hasTextRefs = true;
                        rNode.files.forEach(f => systemDirectives += `\n[DOCUMENT ATTACHED: ${f.name}]\n${f.payload}\n`);
                    } else if (rNode.type === 'chat' || !rNode.type) {
                        hasTextRefs = true;
                        systemDirectives += `\nRule: ${rNode.userText}\nStatus: ${rNode.aiText}\n`;
                    }
                }
            });
            if (hasTextRefs) {
                if (history.length > 0 && history[0].role === 'system') history[0].content += "\n\n" + systemDirectives;
                else history.unshift({ role: 'system', content: systemDirectives });
            }
            if (hasImageRefs && history.length > 0) {
                const lastMsg = history[history.length - 1];
                if (lastMsg.role === 'user') {
                    const originalText = lastMsg.content;
                    lastMsg.content = [{ type: "text", text: originalText }, ...imageContents];
                }
            }
        }
        let aborted = false;
        this.textarea.style.border = "none";
        this.textarea.style.background = "transparent";
        this.textarea.style.height = "auto";
        this.textarea.style.color = "#eee";
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

        let uiDirty = false;
        const syncThinkVisibility = () => {
            const hasReasoning = this.nodeData.aiThinking.trim() !== '';
            const hasChips = (this.nodeData.aiSegments || []).some(s => s.type === 'tool_call');
            aiThinkEl.style.display = (hasReasoning || hasChips) ? 'flex' : 'none';
        };
        const flushUi = () => {
            uiDirty = false;
            aiContentEl.innerHTML = renderAnswerHtml(this.nodeData);   // answer ALWAYS goes here
            if (aiThinkEl.isConnected) {
                const CAP = 20000;
                if (thinkTextEl.textContent.length > CAP) {
                    thinkTextEl.textContent = thinkTextEl.textContent.slice(-CAP);
                }
                aiThinkEl.scrollTop = aiThinkEl.scrollHeight;
            }
            if (typeof drawEdges === 'function') drawEdges();
            updateThermometer(this.id);
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
                        thinkTextEl.textContent = '';
                        this.nodeData.aiThinking = '';
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
                syncThinkVisibility();   // hides think box only when it truly has nothing to show
                requestUiFlush();
                if (typeof onNodeStreamUpdate === 'function') onNodeStreamUpdate(this.id, 'content', this.nodeData.aiText);
            },
            onToolCall: (tc) => {
                if (thinkPlaceholder.isConnected) thinkPlaceholder.remove();
                this.nodeData.aiSegments.push({
                    type: 'tool_call',
                    id: tc.id || '',
                    name: tc.name || 'tool',
                    argsPreview: toolArgsPreview(tc.arguments),
                    rawArgs: tc.arguments || '',
                    status: 'running',
                    result: ''
                });
                thinkToolsEl.innerHTML = renderToolChipsHtml(this.nodeData);   // chips only — reasoning text untouched
                syncThinkVisibility();
                requestUiFlush();
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
                thinkToolsEl.innerHTML = renderToolChipsHtml(this.nodeData);
                requestUiFlush();
            },
            onReasoning: (reasoning) => {
                if (thinkPlaceholder.isConnected) thinkPlaceholder.remove();
                this.nodeData.aiThinking += reasoning;
                thinkTextEl.appendChild(document.createTextNode(reasoning));
                syncThinkVisibility();
                requestUiFlush();
                if (typeof onNodeStreamUpdate === 'function') onNodeStreamUpdate(this.id, 'reasoning', this.nodeData.aiThinking);
            },
            onError: (error) => {
                if (error.name === 'AbortError' || (error.message && error.message.includes('AbortError'))) {
                    aborted = true;
                    aiContentEl.innerHTML += `<br><br><span style="color: #ffb86c; font-size: 12px;">[Stopped by User]</span>`;
                    this.textarea.contentEditable = true;
                    this.textarea.style.border = "";
                    this.textarea.style.background = "";
                    this.runBtn.style.display = 'flex';
                    this.stopBtn.style.display = 'none';
                } else aiContentEl.innerHTML = `<span style="color: #ff5555;">Error: ${error.message}</span>`;
                if (typeof onNodeStreamUpdate === 'function') onNodeStreamUpdate(this.id, 'error', error, aborted);
            },
            onComplete: () => {
                if (window.Prism) {
                    Prism.highlightAllUnder(aiContentEl);
                    // if (this.nodeData.aiThinking) Prism.highlightAllUnder(aiThinkEl);
                }
                this.el.querySelector('.add-child-btn').classList.remove('hidden');
                this.el.querySelector('.think-content').innerHTML = '';
                this.nodeData.aiThinking = ''
                if (!this.nodeData.hasChild) this.el.querySelector('.add-child-btn').click()
                if (typeof saveState === 'function') saveState();
                if (typeof onNodeStreamUpdate === 'function') onNodeStreamUpdate(this.id, 'complete');
            }
        });
        if (!aborted) {
            const btnRow = this.el.querySelector('.button-row');
            if (btnRow) btnRow.style.display = 'none';
        }
        if (!this.textarea.disabled) this.textarea.disabled = false;
        updateThermometer(this.id);
    }
}
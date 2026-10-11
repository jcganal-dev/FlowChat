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
                <span class="node-id" title="Shift+Click to insert reference" onmousedown="if(event.shiftKey) event.preventDefault();" onclick="handleIdClick(event, '${this.id}')" data-text="${this.id.replaceAll('_', ' ')}"></span>
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
                <div class="think-content" style="${this.nodeData.aiThinking ? 'display:flex;' : 'display:none;'}">${this.nodeData.aiThinking.trim() == '' ? `<img src="/static/icons/clock.svg" class='file-icon'> Thinking...` : this.nodeData.aiThinking}</div>
                <div class="ai-content">${this.nodeData.aiText ? (typeof renderMarkdown === 'function' ? renderMarkdown(this.nodeData.aiText) : this.nodeData.aiText) : ''}</div>
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
        this.nodeData.abortController = new AbortController();
        const signal = this.nodeData.abortController.signal;
        const aiContentEl = this.el.querySelector('.ai-content');
        const aiThinkEl = this.el.querySelector('.think-content');
        aiContentEl.innerHTML = '';
        aiThinkEl.innerHTML = `<div style="display:flex;flex-direction:row;"><img src="/static/icons/clock.svg" class='file-icon'> Thinking...</div>`;
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
                const reminderText = "[System Reminder] 1. Do not overthing, determine the task, immidiately stop thinking after you arrive at an answer. [End System Reminder]\n";
                if (typeof lastMsg.content === 'string') lastMsg.content = reminderText + lastMsg.content;
                else if (Array.isArray(lastMsg.content) && lastMsg.content.length > 0 && lastMsg.content[0].type === 'text') {
                    lastMsg.content[0].text = reminderText + lastMsg.content[0].text;
                }
            }
        }
        const payload = { messages: history, max_tokens: 1000 };
        await streamChatApi(payload, signal, {
            onContent: (content) => {
                if (!erased_thoughts) {
                    if (typeof erase_thoughts !== 'undefined' && erase_thoughts) {
                        aiThinkEl.innerHTML = '';
                        this.nodeData.aiThinking = '';
                        aiThinkEl.style.display = "none";
                    } else if (this.nodeData.aiThinking.trim() === '') {
                        aiThinkEl.innerHTML = '';
                        aiThinkEl.style.display = "none";
                    }
                    erased_thoughts = true;
                }
                this.nodeData.aiText += content;
                if (typeof renderMarkdown === 'function') {
                    aiContentEl.innerHTML = renderMarkdown(this.nodeData.aiText);
                } else aiContentEl.innerHTML += content;
                if (typeof drawEdges === 'function') drawEdges();
                updateThermometer(this.id);
                if (typeof onNodeStreamUpdate === 'function') onNodeStreamUpdate(this.id, 'content', this.nodeData.aiText);
            },
            onReasoning: (reasoning) => {
                aiThinkEl.style.display = "flex";
                this.nodeData.aiThinking += reasoning;
                if (typeof renderMarkdown === 'function') {
                    aiThinkEl.innerHTML = renderMarkdown(this.nodeData.aiThinking);
                } else aiThinkEl.innerHTML += reasoning;
                aiThinkEl.scrollTop = aiThinkEl.scrollHeight;
                if (typeof drawEdges === 'function') drawEdges();
                updateThermometer(this.id);
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
                    if (this.nodeData.aiThinking) Prism.highlightAllUnder(aiThinkEl);
                }
                this.el.querySelector('.add-child-btn').classList.remove('hidden');
                this.el.querySelector('.add-child-btn').click();
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
class ToolNode extends BaseNode {
    constructor(config) {
        config.type = 'tool';
        super(config);
        const runStyle = this.nodeData.aiText ? 'display: none;' : '';
        const inputContent = this.config.restoreData ? (this.nodeData.htmlText || this.nodeData.userText) : this.config.initialUserText;
        const isEditable = this.config.restoreData && this.nodeData.aiText ? 'false' : 'true';
        this.el.innerHTML = `
            <div class="handle handle-in"></div>
            <div class="node-header">
                <span class="node-id" title="Shift+Click to insert reference" onmousedown="if(event.shiftKey) event.preventDefault();" onclick="handleIdClick(event, '${this.id}')" data-text="${this.id.replaceAll('_', ' ')}"></span>
                <div>
                    <a class="delete-btn" title="Delete"><img src="${getIconpath('close')}" class="file-icon"></a>
                </div>
            </div>
            <div class="tool-selection" style="padding: 5px 10px;">
                <select class="tool-select" style="width: 100%; background: #2b2b36; color: #fff; border: 1px solid #444; border-radius: 4px; padding: 4px;">
                    <option value="python">Python Script</option>
                    <option value="bash">Bash Script</option>
                </select>
            </div>
            <div class="user-section">
                <div contenteditable="${isEditable}" class="node-input" spellcheck="true" placeholder="Enter tool payload/script...">${inputContent}</div>
                <div class="button-row" style="${runStyle}">
                    <button class="run-btn"><img src="${getIconpath('send')}" class="file-icon" style="margin:0px"> Execute</button>
                </div>
            </div>
            <div class="ai-section">
                <div class="ai-content" style="white-space: pre-wrap; font-family: monospace;">${this.nodeData.aiText || ''}</div>
            </div>
            <div class="handle handle-out"></div>
            <button class="add-child-btn ${this.nodeData.aiText ? '' : 'hidden'}" title="Branch">+</button>
            <div class="resize-handle"></div>
        `;
        setTimeout(() => {
            this.runBtn = this.el.querySelector('.run-btn');
            this.textarea = this.el.querySelector('.node-input');
            this.addBtn = this.el.querySelector('.add-child-btn');
            this.deleteBtn = this.el.querySelector('.delete-btn');
            this.toolSelect = this.el.querySelector('.tool-select');
            if (this.nodeData.selectedTool) this.toolSelect.value = this.nodeData.selectedTool;
            this.toolSelect.addEventListener('change', (e) => {
                this.nodeData.selectedTool = e.target.value;
                if (typeof saveState === 'function') saveState();
            });
            this.runBtn.addEventListener('click', this.run.bind(this));
            this.addBtn.addEventListener('click', this.onFork.bind(this));
            this.deleteBtn.addEventListener('click', this.onDelete.bind(this));
            this.el.addEventListener('click', (e) => {
                if (this.el.dataset.dragged) return;
                if (!e.target.closest('button') && !e.target.closest('textarea') && !e.target.closest('select')) {
                    selectNode(this.el.id, e.shiftKey, e.ctrlKey || e.metaKey);
                }
            });
        }, 0);
        this.attachBaseListeners(this.config.restoreData);
    }
    async run() {
        const usertext = this.textarea.textContent.trim();
        if (!usertext) return;
        this.nodeData.userText = usertext;
        this.nodeData.aiText = "";
        const aiContentEl = this.el.querySelector('.ai-content');
        aiContentEl.innerHTML = 'Executing tool...';
        this.runBtn.style.display = 'none';
        try {
            const tool = this.toolSelect.value;
            const res = await fetch('/api/tool', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tool, code: usertext })
            });
            if (res.ok) {
                const data = await res.json();
                this.nodeData.aiText = data.result || "Executed.";
            } else this.nodeData.aiText = "FastAPI endpoint /api/tool not ready.";
        } catch (err) {
            this.nodeData.aiText = `Error: ${err.message}`;
        }
        aiContentEl.innerHTML = this.nodeData.aiText;
        this.runBtn.style.display = 'none';
        this.el.querySelector('.add-child-btn').classList.remove('hidden');
        if (typeof drawEdges === 'function') drawEdges();
        if (typeof saveState === 'function') saveState();
    }
}
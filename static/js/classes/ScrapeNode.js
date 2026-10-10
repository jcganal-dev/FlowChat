class ScrapeNode extends BaseNode {
    constructor(config) {
        config.type = 'scrape';
        super(config);
        const runStyle = this.nodeData.aiText ? 'display: none;' : '';
        const inputContent = this.config.restoreData ? (this.nodeData.htmlText || this.nodeData.userText) : this.config.initialUserText;
        const isEditable = this.config.restoreData && this.nodeData.aiText ? 'false' : 'true';
        this.el.innerHTML = `
            <div class="handle handle-in"></div>
            <div class="node-header">
                <span class="node-id" title="Shift+Click to insert reference" onmousedown="if(event.shiftKey) event.preventDefault();" onclick="handleIdClick(event, '${this.id}')" data-text="${this.id.replaceAll('_', ' ')}"></span>
                <div>
                    <a class="delete-btn" title="Delete"><img src="/static/icons/close.svg" class="file-icon"></a>
                </div>
            </div>
            <div class="user-section">
                <div contenteditable="${isEditable}" class="node-input scrape-node-input" spellcheck="false" placeholder="Enter URL to scrape...">${inputContent}</div>
                <div class="button-row" style="${runStyle}">
                    <button class="run-btn"><img src="/static/icons/send.svg" class="file-icon" style="margin:0px"> Scrape</button>
                </div>
            </div>
            <div class="ai-section" style="${this.nodeData.aiText ? 'display: block;' : 'display: none;'}">
                <div class="ai-content"></div>
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

            this.runBtn.addEventListener('click', this.run.bind(this));
            this.addBtn.addEventListener('click', this.onFork.bind(this));
            this.deleteBtn.addEventListener('click', this.onDelete.bind(this));
            this.el.addEventListener('click', (e) => {
                if (this.el.dataset.dragged) return;
                if (!e.target.closest('button') && !e.target.closest('textarea') && !e.target.closest('input')) {
                    selectNode(this.el.id, e.shiftKey, e.ctrlKey || e.metaKey);
                }
            });

            if (this.nodeData.aiText) {
                this.renderSuccessUI();
            }
        }, 0);
        this.attachBaseListeners(this.config.restoreData);
    }

    renderSuccessUI() {
        const aiContentEl = this.el.querySelector('.ai-content');
        if (!this.nodeData.aiText) return;

        if (this.nodeData.aiText.startsWith("Error:") || this.nodeData.aiText === "Failed to scrape URL." || this.nodeData.aiText === "No content returned.") {
            aiContentEl.innerHTML = this.nodeData.aiText;
            return;
        }

        aiContentEl.innerHTML = `
            <div style="color: #4CAF50; margin-bottom: 8px;">✅ Successfully scraped page. Content is stored in context.</div>
            <div style="display: flex; gap: 8px; margin-top: 8px;">
                <input type="text" class="scrape-filename-input" placeholder="filename.md" style="flex: 1; padding: 4px; border-radius: 4px; border: 1px solid #555; background: #2b2b36; color: white;">
                <button class="scrape-save-btn" style="padding: 4px 8px; border-radius: 4px; background: #4CAF50; border: none; color: white; cursor: pointer;">Save to Sandbox</button>
            </div>
        `;

        const saveBtn = aiContentEl.querySelector('.scrape-save-btn');
        const fileInput = aiContentEl.querySelector('.scrape-filename-input');

        fileInput.addEventListener('click', (e) => e.stopPropagation());
        fileInput.addEventListener('mousedown', (e) => e.stopPropagation());

        saveBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            let filename = fileInput.value.trim() || 'scraped.md';
            if (!filename.endsWith('.md')) filename += '.md';

            saveBtn.textContent = 'Saving...';

            try {
                const res = await fetch('/api/sandbox/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename, content: this.nodeData.aiText })
                });

                if (res.ok) {
                    saveBtn.textContent = 'Saved!';
                    saveBtn.style.background = '#2E7D32';
                    setTimeout(() => {
                        saveBtn.textContent = 'Save to Sandbox';
                        saveBtn.style.background = '#4CAF50';
                    }, 2000);
                    if (typeof fetchSandboxFiles === 'function') fetchSandboxFiles();
                } else {
                    saveBtn.textContent = 'Error';
                    saveBtn.style.background = '#d32f2f';
                }
            } catch (err) {
                saveBtn.textContent = 'Error';
                saveBtn.style.background = '#d32f2f';
            }
        });
    }

    async run() {
        const usertext = this.textarea.textContent.trim();
        if (!usertext) return;
        this.nodeData.userText = usertext;
        this.nodeData.aiText = "";

        const aiSection = this.el.querySelector('.ai-section');
        aiSection.style.display = 'block';

        const aiContentEl = this.el.querySelector('.ai-content');
        aiContentEl.innerHTML = "<img src='/static/icons/magnifying-glass.svg' class='file-icon' style='margin-bottom: -2px;'> Scraping...";
        this.runBtn.style.display = 'none';
        this.textarea.contentEditable = false;

        try {
            const res = await fetch('/api/scrape', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: usertext })
            });
            if (res.ok) {
                const data = await res.json();
                this.nodeData.aiText = data.content || "No content returned.";
            } else {
                this.nodeData.aiText = "Failed to scrape URL.";
            }
        } catch (err) {
            this.nodeData.aiText = `Error: ${err.message}`;
        }

        this.renderSuccessUI();

        this.el.querySelector('.add-child-btn').classList.remove('hidden');

        // Spawn a child ChatNode automatically
        const newNodeId = createNode(this.id, this.nodeData.x, this.nodeData.y + this.el.offsetHeight + GRID_SIZE * 3, '', this.nodeData.turn + 1, 0, this.nodeData.name, null, 'chat');
        if (typeof drawEdges === 'function') drawEdges();
        if (typeof saveState === 'function') saveState();
        if (typeof selectNode === 'function') selectNode(newNodeId);
        if (typeof centerCanvas === 'function') centerCanvas();
    }
}

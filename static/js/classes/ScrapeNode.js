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
                <div class="header-name">
                    <span class="node-icon" style="display: flex; justify-content:center; align-items: center;">
                        ${scrapeIcon()}
                    </span>
                    <span class="node-id" title="Shift+Click to insert reference" onmousedown="if(event.shiftKey) event.preventDefault();" onclick="handleIdClick(event, '${this.id}')" data-text="${this.id.replaceAll('_', ' ')}"></span>
                </div>
                <div>
                    <a class="toggle-btn" title="Toggle Summary" style="cursor: pointer; ${this.nodeData.summaryText ? 'display: flex;' : 'display: none;'}" onclick="event.stopPropagation(); if(typeof toggleNodeState === 'function') toggleNodeState('${this.id}')">${this.nodeData.isCollapsed ? '<img src="/static/icons/expand.svg" class="file-icon">' : '<img src="/static/icons/collapse.svg" class="file-icon">'}</a>
                    <a class="delete-btn" title="Delete"><img src="/static/icons/close.svg" class="file-icon"></a>
                </div>
            </div>
            <div class="user-section">
                <div contenteditable="${isEditable}" class="node-input scrape-node-input" spellcheck="false" placeholder="Enter URL to scrape..." oninput="if (this.innerText.trim() == ''){this.innerHTML = ''}">${inputContent}</div>
                <div class="button-row" style="${runStyle}">
                    <button class="run-btn"><img src="/static/icons/send.svg" class="file-icon" style="margin:0px"> Scrape</button>
                </div>
            </div>
            <div class="ai-section" style="${this.nodeData.aiText ? 'display: block;' : 'display: none;'}">
                <div class="ai-content"></div>
            </div>
            <div class="node-summary-display">${this.nodeData.summaryText ? (typeof renderMarkdown === 'function' ? renderMarkdown(this.nodeData.summaryText) : this.nodeData.summaryText) : ''}</div>
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

        if (this.nodeData.aiText.startsWith("Error:") || this.nodeData.aiText.startsWith("Failed") || this.nodeData.aiText === "No content returned.") {
            aiContentEl.innerHTML = `<div style="color: #ff5555; margin-bottom: 8px;"><img src="/static/icons/error.svg" class="file-icon" style="margin-bottom: -1px;"> ${this.nodeData.aiText}</div>`;
            return;
        }

        const userSection = this.el.querySelector('.user-section');
        if (userSection) userSection.style.display = 'none';

        aiContentEl.innerHTML = `
            <div class="scraped-md">
                ${marked.parse(this.nodeData.aiText)}
            </div>
        `;
        const saveCont = document.createElement('div')
        saveCont.style = "display: flex; gap: 8px; justify-content: center; align-items: center; margin: 0px 10px 10px 10px;"
        saveCont.classList.add('save-controls-container')
        saveCont.innerHTML = `
                <input type="text" class="scrape-filename-input" placeholder="(optional)" style="flex: 1; padding: 4px; border-radius: 4px; border: 1px solid #555; background: #2b2b36; color: white;">
                <button class="scrape-save-btn" style="padding: 4px 8px; border-radius: 4px; background: #4CAF50; border: none; color: white; cursor: pointer;">Save to Sandbox</button>
        `
        this.el.appendChild(saveCont)

        const saveBtn = this.el.querySelector('.scrape-save-btn');
        const fileInput = this.el.querySelector('.scrape-filename-input');

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
                    const saveContainer = aiSectionEl.querySelector('.save-controls-container');
                    if (saveContainer) saveContainer.textContent = 'Saved!';
                    saveBtn.style.background = '#2E7D32';
                    setTimeout(() => {
                        if (saveContainer) saveContainer.style.display = 'none';
                    }, 1500);
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
            let data = {};
            try {
                data = await res.json();
            } catch (e) { }

            if (res.ok) {
                let content = data.content || "";

                const markdownIdx = content.indexOf('Markdown Content:');
                let actualMarkdown = "";
                if (markdownIdx !== -1) {
                    actualMarkdown = content.substring(markdownIdx + 'Markdown Content:'.length).trim();
                }

                if (content.includes("requiring CAPTCHA") ||
                    content.includes("unusual traffic from your computer network") ||
                    (markdownIdx !== -1 && actualMarkdown === "")) {
                    this.nodeData.aiText = "Failed to scrape URL (CAPTCHA or empty content).";
                } else {
                    this.nodeData.aiText = content || "No content returned.";
                }
            } else {
                this.nodeData.aiText = `Failed to scrape URL. ${data.error || ''}`;
                if (data.content) {
                    this.nodeData.aiText += `\n${data.content}`;
                }
            }
        } catch (err) {
            this.nodeData.aiText = `Error: ${err.message}`;
        }

        this.renderSuccessUI();

        const isSuccess = !this.nodeData.aiText.startsWith("Error:") && !this.nodeData.aiText.startsWith("Failed") && this.nodeData.aiText !== "No content returned.";

        if (isSuccess) {
            this.el.querySelector('.add-child-btn').classList.remove('hidden');
            if (this.nodeData.childNodeIds.length === 0) this.el.querySelector('.add-child-btn').click()
            if (typeof drawEdges === 'function') drawEdges();
            if (typeof saveState === 'function') saveState();
            if (typeof centerCanvas === 'function') centerCanvas();
            const aiSection = this.el.querySelector('.ai-section')
            aiSection.scrollTo({ top: aiSection.scrollHeight, behavior: 'smooth' });
        } else {
            this.textarea.contentEditable = true;
            this.runBtn.style.display = 'inline-flex';
        }
    }
}

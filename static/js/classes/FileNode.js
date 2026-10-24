class FileNode extends BaseNode {
    constructor(config) {
        super(config);
        this.el.classList.add('file-node');
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
                    <a class="delete-btn" title="Delete"><img src="/static/icons/close.svg" class="file-icon"></a>
                </div>
            </div>
            <div class="files-container" id="files_${this.id}"></div>
            <div class="file-dropzone" id="drop_${this.id}">
                <div class="drop-text">Drag ${this.nodeData.type === 'image' ? 'Image' : 'Document'}(s) Here<br><small>(or click to browse)</small></div>
                <input type="file" id="input_${this.id}" style="display: none;" multiple accept="${this.nodeData.type === 'image' ? 'image/*' : getTextWhitelistExtensions()}">
            </div>
            <div class="handle handle-out"></div>
            <button class="add-child-btn" title="Branch">+</button>
            <div class="resize-handle"></div>
        `;
        setTimeout(() => {
            this.deleteBtn = this.el.querySelector('.delete-btn');
            this.dropzone = this.el.querySelector('.file-dropzone');
            this.fileInput = this.el.querySelector('input[type="file"]');
            this.addBtn = this.el.querySelector('.add-child-btn');
            this.addBtn.addEventListener('click', this.onFork.bind(this));
            this.deleteBtn.addEventListener('click', this.onDelete.bind(this));
            this.dropzone.addEventListener('click', () => this.fileInput.click());
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
            this.fileInput.addEventListener('change', (e) => {
                if (e.target.files.length) this.processMultipleFiles(e.target.files);
            });
            this.dropzone.addEventListener('dragover', (e) => {
                e.preventDefault();
                this.dropzone.classList.add('dragover');
            });
            this.dropzone.addEventListener('dragleave', () => {
                this.dropzone.classList.remove('dragover');
            });
            this.dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                this.dropzone.classList.remove('dragover');
                if (e.dataTransfer.files.length) this.processMultipleFiles(e.dataTransfer.files);
            });
            this.el.addEventListener('click', (e) => {
                if (this.el.dataset.dragged) return;
                if (!e.target.closest('input') && !e.target.closest('.remove-file-btn')) {
                    selectNode(this.el.id, e.shiftKey, e.ctrlKey || e.metaKey);
                }
            });
            this.renderFiles();
        }, 0);
        this.el.renderFiles = this.renderFiles.bind(this);
        this.attachBaseListeners(this.config.restoreData);
    }
    renderFiles() {
        const container = this.el.querySelector('.files-container');
        if (!container) return;
        container.innerHTML = '';
        this.nodeData.files.forEach((f, idx) => {
            const item = document.createElement('div');
            item.className = 'file-item';
            if (this.nodeData.type === 'image') {
                item.innerHTML = `
                <div style="width: max-content;position: relative;">
                    <img src="${f.payload}" class="file-preview" style="display:block; max-width: 100%; max-height: 180px;" />
                    <a class="remove-file-btn" data-idx="${idx}" style="top: 12px;right: 0px;"><img src="/static/icons/trash.svg" class="file-icon"></a>
                </div>
                `;
            } else {
                const src = getIconpath(f.name.split('.').pop().toLowerCase());
                item.innerHTML = `<img src="${src}" class="file-icon"> ${f.name} <a class="remove-file-btn" data-idx="${idx}"><img src="/static/icons/trash.svg" class="file-icon"></a>`;
            }
            container.appendChild(item);
        });
        if (this.dropzone) {
            if (this.nodeData.files.length > 0) {
                this.dropzone.classList.add('minimized');
                const dt = this.dropzone.querySelector('.drop-text');
                if (dt) dt.innerHTML = `<img src="/static/icons/upload.svg" class="file-icon" style="margin: 4px 0px 0px 0px;">`;
            } else {
                this.dropzone.classList.remove('minimized');
                const dt = this.dropzone.querySelector('.drop-text');
                if (dt) dt.innerHTML = `Drag ${this.nodeData.type === 'image' ? 'Image' : 'Document'}(s) Here<br><small>(or click to browse)</small>`;
            }
        }
        container.querySelectorAll('.remove-file-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute('data-idx'));
                this.nodeData.files.splice(idx, 1);
                this.renderFiles();
                if (typeof saveState === 'function') saveState();
            });
        });
        if (typeof drawGroups === 'function') drawGroups();
        if (typeof drawEdges === 'function') drawEdges();
    }
    processMultipleFiles(fileList) {
        const files = Array.from(fileList);
        files.forEach(f => this.processFile(f));
    }
    processFile(file) {
        const isImageNode = this.nodeData.type === 'image';
        if (isImageNode && !file.type.startsWith('image/')) {
            window.customAlert("Please upload an image file for this node.");
            return;
        }
        if (!isImageNode && !textWhitelist.test(file.name) && !exactNameWhitelist.test(file.name)) {
            const acceptedExts = getTextWhitelistExtensions().split(',').join(', ');
            window.customAlert(`Document nodes only accept text-based files (${acceptedExts}). Please upload a supported file.`);
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            this.nodeData.files.push({ name: file.name, payload: e.target.result });
            this.renderFiles();
            if (typeof saveState === 'function') saveState();
        };
        if (isImageNode) reader.readAsDataURL(file);
        else reader.readAsText(file);
    }
}
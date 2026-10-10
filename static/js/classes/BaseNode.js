class BaseNode {
    constructor(config) {
        const { parentId = null, x = 408, y = 216, initialUserText = "", turn = 1, branch = 0, name = "Master_Node", restoreData = null, type = "chat" } = config;
        this.config = config;
        
        if (restoreData) {
            this.nodeData = restoreData;
            this.id = this.nodeData.id;
            this.nodeData.abortController = null;
            if (!this.nodeData.files) this.nodeData.files = [];
            if (this.nodeData.filePayload && this.nodeData.files.length === 0) {
                this.nodeData.files.push({
                    name: this.nodeData.fileName || 'File',
                    payload: this.nodeData.filePayload
                });
            }
            if (typeof erase_thoughts !== 'undefined' && erase_thoughts && this.nodeData.aiText) this.nodeData.aiThinking = "";
            nodes.push(this.nodeData);
        } else {
            this.nodeData = {
                id: undefined, type, files: [], filePayload: null, fileName: null,
                userText: initialUserText, htmlText: initialUserText, aiText: "", aiThinking: "",
                parentId, x, y, muted: false, references: [], turn, branch, name,
                hasChild: false, isCollapsed: false, abortController: null
            };
            this.id = idfy(this.nodeData);
            this.nodeData.id = this.id;
            nodes.push(this.nodeData);
        }

        this.isCollapsed = this.nodeData.isCollapsed;
        this.el = document.createElement('div');
        this.el.className = `node turn-node ${this.isCollapsed ? 'collapsed-node' : ''}`;
        if (this.nodeData.muted) this.el.classList.add('muted-node');
        this.el.id = this.id;
        this.el.style.transform = `translate(${this.nodeData.x}px, ${this.nodeData.y}px)`;
        if (this.nodeData.nodeWidth) this.el.style.width = `${this.nodeData.nodeWidth}px`;
        this.el.style.zIndex = highestZIndex++;
        
        this.el.__nodeInstance = this;
    }

    attachBaseListeners(restoreData) {
        nodesLayer.appendChild(this.el);
        setTimeout(() => {
            const header = this.el.querySelector('.node-header');
            if (header) header.addEventListener('mousedown', this.onDragStart.bind(this));
        }, 0);
        if (typeof nodeResizeObserver !== 'undefined') nodeResizeObserver.observe(this.el);
        const resizer = this.el.querySelector('.resize-handle');
        if (resizer) resizer.addEventListener('mousedown', this.onResizeStart.bind(this));
        if (!restoreData) selectNode(this.id);
    }

    onDragStart(e) {
        if (e.button === 1) return;
        e.preventDefault(); e.stopPropagation();
        this.el.style.zIndex = highestZIndex++;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        const nodeData = nodes.find(n => n.id === this.el.id);
        if (!nodeData) return;
        this.startNodeX = nodeData.x;
        this.startNodeY = nodeData.y;
        this.isShiftDrag = e.shiftKey;
        const isMultiSelect = selectedNodes.has(this.el.id);
        this.draggedNodes = [];
        if (isMultiSelect) {
            selectedNodes.forEach(selId => {
                const selData = nodes.find(n => n.id === selId);
                const selEl = document.getElementById(selId);
                if (selData && selEl) this.draggedNodes.push({ node: selData, startX: selData.x, startY: selData.y, el: selEl });
            });
        } else {
            this.draggedNodes.push({ node: nodeData, startX: nodeData.x, startY: nodeData.y, el: this.el });
        }
        this.descendants = [];
        if (this.isShiftDrag) {
            const queue = this.draggedNodes.map(dn => dn.node.id);
            const seen = new Set(queue);
            while (queue.length > 0) {
                const currentId = queue.shift();
                const children = nodes.filter(n => n.parentId === currentId);
                children.forEach(child => {
                    if (!seen.has(child.id)) {
                        seen.add(child.id);
                        this.descendants.push({ node: child, startX: child.x, startY: child.y, el: document.getElementById(child.id) });
                        queue.push(child.id);
                    }
                });
            }
        }
        this.hasMovedNode = false;
        this.boundOnMouseMove = this.onMouseMove.bind(this);
        this.boundOnMouseUp = this.onMouseUp.bind(this);
        window.addEventListener('mousemove', this.boundOnMouseMove);
        window.addEventListener('mouseup', this.boundOnMouseUp);
    }

    onMouseMove(moveEvent) {
        const dx = (moveEvent.clientX - this.dragStartX) / camera.zoom;
        const dy = (moveEvent.clientY - this.dragStartY) / camera.zoom;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.hasMovedNode = true;
        let primaryTargetX = this.startNodeX + dx;
        let primaryTargetY = this.startNodeY + dy;
        if (moveEvent.altKey) {
            primaryTargetX = Math.round(primaryTargetX / GRID_SIZE) * GRID_SIZE;
            primaryTargetY = Math.round(primaryTargetY / GRID_SIZE) * GRID_SIZE;
        }
        const actualDx = primaryTargetX - this.startNodeX;
        const actualDy = primaryTargetY - this.startNodeY;
        this.draggedNodes.forEach(dn => {
            dn.node.x = dn.startX + actualDx;
            dn.node.y = dn.startY + actualDy;
            if (dn.el) dn.el.style.transform = `translate(${dn.node.x}px, ${dn.node.y}px)`;
        });
        if (this.isShiftDrag) {
            this.descendants.forEach(desc => {
                desc.node.x = desc.startX + actualDx;
                desc.node.y = desc.startY + actualDy;
                if (desc.el) desc.el.style.transform = `translate(${desc.node.x}px, ${desc.node.y}px)`;
            });
        }
        if (typeof drawEdges === 'function') drawEdges();
        if (typeof drawGroups === 'function') drawGroups();
        if (typeof updateCanvas === 'function') updateCanvas();
    }

    onMouseUp() {
        window.removeEventListener('mousemove', this.boundOnMouseMove);
        window.removeEventListener('mouseup', this.boundOnMouseUp);
        if (this.hasMovedNode) {
            this.el.dataset.dragged = 'true';
            setTimeout(() => delete this.el.dataset.dragged, 0);
        }
        if (typeof saveState === 'function') saveState();
    }

    onResizeStart(e) {
        if (e.button === 1) return;
        e.preventDefault(); e.stopPropagation();
        this.resizeStartMouseX = e.clientX;
        const nodeData = nodes.find(n => n.id === this.el.id);
        if (!nodeData) return;
        this.resizeTargetStartWidth = this.el.offsetWidth;
        const isMultiSelect = selectedNodes.has(this.el.id);
        this.nodesToResize = [];
        if (isMultiSelect) {
            selectedNodes.forEach(selId => {
                const selData = nodes.find(n => n.id === selId);
                const selEl = document.getElementById(selId);
                if (selData && selEl) {
                    this.nodesToResize.push({ data: selData, el: selEl, startWidth: selEl.offsetWidth, startNodeX: selData.x, accumulatedShiftX: 0 });
                }
            });
        } else {
            this.nodesToResize.push({ data: nodeData, el: this.el, startWidth: this.resizeTargetStartWidth, startNodeX: nodeData.x, accumulatedShiftX: 0 });
        }
        this.boundOnResizeMove = this.onResizeMove.bind(this);
        this.boundOnResizeUp = this.onResizeUp.bind(this);
        window.addEventListener('mousemove', this.boundOnResizeMove);
        window.addEventListener('mouseup', this.boundOnResizeUp);
    }

    onResizeMove(moveEvent) {
        const deltaX = (moveEvent.clientX - this.resizeStartMouseX) / camera.zoom;
        const isSymmetrical = moveEvent.ctrlKey || moveEvent.metaKey;
        let diff = isSymmetrical ? deltaX * 2 : deltaX;
        if (moveEvent.altKey) diff = Math.round(diff / (isSymmetrical ? GRID_SIZE * 2 : GRID_SIZE)) * (isSymmetrical ? GRID_SIZE * 2 : GRID_SIZE);
        const snappedWidth = Math.max(300, this.resizeTargetStartWidth + diff);
        this.nodesToResize.forEach(item => {
            const oldHeight = item.el.offsetHeight;
            item.el.style.width = `${snappedWidth}px`;
            const widthDiff = snappedWidth - item.startWidth;
            item.data.x = isSymmetrical ? item.startNodeX - (widthDiff / 2) : item.startNodeX;
            item.data.nodeWidth = snappedWidth;
            item.el.style.transform = `translate(${item.data.x}px, ${item.data.y}px)`;
            const deltaY = item.el.offsetHeight - oldHeight;
            const deltaXShift = (item.data.x + snappedWidth / 2) - (item.startNodeX + item.startWidth / 2) - item.accumulatedShiftX;
            item.accumulatedShiftX += deltaXShift;
            if ((deltaXShift !== 0 || deltaY !== 0) && typeof shiftChildrenXY === 'function') {
                shiftChildrenXY(item.data.id, deltaXShift, deltaY);
            }
        });
        clearTimeout(layoutDebounceTimeout);
        layoutDebounceTimeout = setTimeout(() => {
            if (typeof drawEdges === 'function') drawEdges();
            if (typeof drawGroups === 'function') drawGroups();
        }, 15);
    }

    onResizeUp() {
        window.removeEventListener('mousemove', this.boundOnResizeMove);
        window.removeEventListener('mouseup', this.boundOnResizeUp);
        if (typeof saveState === 'function') saveState();
    }

    onFork(e) {
        e.stopPropagation();
        forkOffsetCounter += 1;
        const data = nodes.find(n => n.id === this.el.id);
        const bottomY = data.y + this.el.offsetHeight;
        const snappedBottomY = Math.ceil(bottomY / GRID_SIZE) * GRID_SIZE;
        let childWidth = 336;
        const parentWidth = this.el.offsetWidth;
        if (Math.round(parentWidth / GRID_SIZE) % 2 !== Math.round(childWidth / GRID_SIZE) % 2) childWidth += GRID_SIZE;
        const forkX = data.x + (parentWidth - childWidth) / 2;
        const forkY = snappedBottomY + (GRID_SIZE * 3);
        const existingChildren = nodes.filter(n => n.parentId === data.id);
        const newId = createNode(data.id, forkX, forkY, "", data.turn + 1, data.branch + existingChildren.length, data.name);
        const newEl = document.getElementById(newId);
        const newData = nodes.find(n => n.id === newId);
        if (newEl && newData) {
            newData.nodeWidth = childWidth;
            newEl.style.width = childWidth + 'px';
        }
        if (typeof saveState === 'function') saveState();
    }

    onDelete(e) {
        e.stopPropagation();
        if (selectedNodes.has(this.el.id) && selectedNodes.size > 1) {
            Array.from(selectedNodes).forEach(id => deleteNode(id, e.shiftKey));
            selectedNodes.clear();
        } else {
            deleteNode(this.el.id, e.shiftKey);
        }
    }
}
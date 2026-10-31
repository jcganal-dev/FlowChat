// Auto-refresh for the sandbox file trees.
//
// Listens to the backend's SSE stream (/api/sandbox/events), which fires
// whenever the sandbox directory changes — whether the change came from the
// app itself (uploads, deletes, moves, agent tools) or from editing files
// directly on disk. Both the sidebar tree and the focus-mode tree re-render.

let sandboxRefreshTimer = null;
let sandboxDragActive = false;
let sandboxRefreshQueued = false;

function requestSandboxRefresh() {
    // Debounce: one operation can touch many files before the watcher notices
    if (sandboxRefreshTimer) clearTimeout(sandboxRefreshTimer);
    sandboxRefreshTimer = setTimeout(applySandboxRefresh, 400);
}

async function applySandboxRefresh() {
    sandboxRefreshTimer = null;
    if (sandboxDragActive) {
        sandboxRefreshQueued = true;
        return;
    }

    const prevSelected = new Set(selectedSandboxFiles);

    await fetchSandboxFiles();

    // fetchSandboxFiles clears the selection on rebuild; keep the user's
    // selection across background refreshes as long as every path still exists
    if (prevSelected.size > 0) {
        const allStillExist = Array.from(prevSelected).every(p => currentSandboxFiles.includes(p));
        if (allStillExist) prevSelected.forEach(p => selectedSandboxFiles.add(p));
        updateSidebarSelection();
        if (typeof updateFocusFileSelection === 'function') updateFocusFileSelection();
    }

    const focusBg = document.getElementById('focus-bg');
    if (focusBg && focusBg.style.display !== 'none' && typeof renderFocusProjectFiles === 'function') {
        await renderFocusProjectFiles(false);
        if (typeof updateFocusFileSelection === 'function') updateFocusFileSelection();
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const source = new EventSource('/api/sandbox/events');
    source.addEventListener('sandbox-changed', requestSandboxRefresh);
    // On connection loss EventSource reconnects on its own; nothing to do here.
});

// Never re-render mid-drag: rebuilding the DOM cancels an in-progress HTML5 drag.
document.addEventListener('dragstart', () => { sandboxDragActive = true; }, true);
document.addEventListener('drop', () => { sandboxDragActive = false; }, true);
document.addEventListener('dragend', () => {
    sandboxDragActive = false;
    if (sandboxRefreshQueued && !sandboxRefreshTimer) {
        sandboxRefreshQueued = false;
        requestSandboxRefresh();
    }
}, true);

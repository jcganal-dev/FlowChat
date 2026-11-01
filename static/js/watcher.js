// Sandbox tree refresh.
//
// The trees used to follow a backend SSE stream that fingerprinted the whole
// sandbox every second. With a large sandbox (a virtualenv alone is tens of
// thousands of files) that meant constant stat-ing on the server and a full
// re-render of both trees on the client, which made the app stutter. Refreshes
// are now event-driven instead:
//
//   * app file operations — upload, create folder, delete, move (handled where
//     they happen, via refreshSandboxTrees())
//   * agent tool calls that touch the sandbox (ChatNode.onToolResult, scrape saves)
//   * the manual refresh buttons in the palette header and focus mode
//
// Changes made outside the app (editing files on disk, an agent shell command
// with side effects) therefore show up on the next refresh rather than instantly.

const SANDBOX_REFRESH_DEBOUNCE_MS = 400;

// Agent tools that can change what is in the sandbox (tools.py DEFAULT_TOOLS).
const SANDBOX_MUTATING_TOOLS = [
    'write_file', 'edit_file', 'delete_file', 'create_folder',
    'move_files', 'copy_files', 'run_command',
];

let sandboxRefreshTimer = null;
let sandboxDragActive = false;
let sandboxRefreshQueued = false;

/**
 * Queues a refresh, coalescing bursts (one agent turn can write many files)
 * into a single fetch and render.
 */
function requestSandboxRefresh() {
    if (sandboxRefreshTimer) clearTimeout(sandboxRefreshTimer);
    sandboxRefreshTimer = setTimeout(applySandboxRefresh, SANDBOX_REFRESH_DEBOUNCE_MS);
}

async function applySandboxRefresh() {
    sandboxRefreshTimer = null;
    if (sandboxDragActive) {
        sandboxRefreshQueued = true;
        return;
    }
    await refreshSandboxTrees();
}

/**
 * Fetches the sandbox listing once and re-renders every tree that is visible,
 * keeping the user's selection as long as all of its paths still exist.
 * This is the entry point behind both refresh buttons.
 */
async function refreshSandboxTrees() {
    const prevSelected = new Set(selectedSandboxFiles);

    const data = await loadSandboxFileData();
    if (!data) return;

    // Both renderers share the selection state; clearing happens here so a
    // refresh behaves the same no matter which tree triggers it.
    selectedSandboxFiles.clear();
    lastSelectedSandboxFileIndex = -1;

    const tree = document.getElementById('file-tree');
    if (tree) renderSandboxTree(tree, data, updateSidebarSelection);

    // Pass the listing along: the focus tree renders from the same fetch.
    if (typeof renderFocusProjectFiles === 'function') {
        await renderFocusProjectFiles(false, data);
    }

    // Keep the selection across background refreshes as long as every path
    // still exists (deleted and moved-away files drop out).
    if (prevSelected.size > 0) {
        const allStillExist = Array.from(prevSelected).every(p => allSandboxPaths.has(p));
        if (allStillExist) prevSelected.forEach(p => selectedSandboxFiles.add(p));
    }
    updateSandboxSelection();
}

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

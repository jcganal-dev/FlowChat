// Undo/redo for the canvas: a Memento stack of serialized state snapshots.
//
// Wiring: flushSave() in main.js calls pushUndoSnapshot() with the state it
// is about to persist — the save commit point is also the undo commit point,
// so undo granularity follows the debounced save cadence (one entry per
// editing burst), and no call site anywhere needs to know undo exists.
//
// Design decisions:
//  * Snapshots live in RAM only — they die on page refresh. Accepted for v1;
//    persisting a short history to SQLite is a cheap later add-on.
//  * Snapshots are deep-cloned JSON strings, never live references: node
//    objects may carry DOM-adjacent fields, and canvas.js files that
//    elements must not be cached on nodeData. applyState() already strips
//    DOM-cache garbage on restore.
//  * Consecutive commits within UNDO_COALESCE_MS collapse into one entry, so
//    a long drag or an assistant turn (which commits every ~800ms while
//    streaming) is one undo step, not dozens.
//  * Inside a node's contenteditable editor, the browser's native text undo
//    is left in charge — the keydown handler only intercepts when focus is
//    on the canvas/chrome.

const UNDO_LIMIT = 100;
const UNDO_COALESCE_MS = 1000;

let undoStack = [];      // snapshots of past states, most recent last; top = current
let redoStack = [];      // states undone away, most recent first
let undoLocked = false;  // true while an undo/redo restore is in progress, so
                         // applyState-triggered saves don't snapshot again
let lastUndoCommit = null;   // { state, time } of the last commit, for coalescing

/**
 * Records a state snapshot on the undo stack. Called from flushSave() at the
 * save commit point — do not call directly.
 * @param {Object} state - The freshly built state (deep-cloned internally).
 */
function pushUndoSnapshot(state) {
    if (undoLocked) return;
    const snapshot = JSON.stringify(state);
    const now = Date.now();

    // Identical state committed again = a spurious save (e.g. a debounced
    // layout timer firing after an undo restore). Skip it — otherwise the
    // first Ctrl+Z after an undo would be a no-op pop of a duplicate.
    if (undoStack.length && undoStack[undoStack.length - 1].state === snapshot) {
        return;
    }

    // Coalesce: a commit within the window of the previous one replaces it
    // instead of stacking another entry (one drag gesture = one undo step).
    if (lastUndoCommit && now - lastUndoCommit.time < UNDO_COALESCE_MS) {
        lastUndoCommit.time = now;
        if (undoStack.length) undoStack[undoStack.length - 1].state = snapshot;
        return;
    }

    redoStack = [];  // any new edit kills the redo branch
    undoStack.push({ state: snapshot });
    lastUndoCommit = { state: snapshot, time: now };
    if (undoStack.length > UNDO_LIMIT) {
        undoStack.shift();
    }
}

/**
 * Restores the previous state. The current state moves to the redo stack.
 */
function undo() {
    if (undoStack.length < 2) return false;
    undoLocked = true;
    try {
        const current = undoStack.pop();
        redoStack.push(current);
        applyState(JSON.parse(undoStack[undoStack.length - 1].state));
        lastUndoCommit = null;
        flushSave();   // persist the restored state; undoLocked keeps it from snapshotting
    } finally {
        undoLocked = false;
    }
    return true;
}

/**
 * Restores the most recently undone state.
 */
function redo() {
    if (redoStack.length === 0) return false;
    undoLocked = true;
    try {
        const target = redoStack.pop();
        applyState(JSON.parse(target.state));
        undoStack.push(target);
        lastUndoCommit = null;   // restore must not coalesce with pre-undo edits
        flushSave();   // persist the restored state; undoLocked keeps it from snapshotting
    } finally {
        undoLocked = false;
    }
    return true;
}

/**
 * Whether undo/redo has entries to pop. Used by the keyboard handler and,
 * later, toolbar buttons.
 */
function canUndo() {
    return undoStack.length >= 2;
}
function canRedo() {
    return redoStack.length > 0;
}

// --- Keyboard: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y ------------------------------
//
// Inside a node's contenteditable editor (or any input/textarea) the
// browser's native text undo stays in charge — we only intercept when focus
// is on the canvas/chrome.
window.addEventListener('keydown', (e) => {
    if (e.target.isContentEditable ||
        e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'z') {
            e.preventDefault();
            if (e.shiftKey) {
                if (redo() && typeof showToast === 'function') showToast('Redo', 'success', 1200);
            } else {
                if (undo() && typeof showToast === 'function') showToast('Undo', 'success', 1200);
            }
        } else if (key === 'y') {
            e.preventDefault();
            if (redo() && typeof showToast === 'function') showToast('Redo', 'success', 1200);
        }
    }
});

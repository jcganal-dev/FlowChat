/**
 * Wraps the fetch API to stream a chat response from the LLM backend.
 * Parses the incoming JSON stream and triggers callbacks for content and reasoning.
 * @param {Object} payload - The request payload containing messages and config.
 * @param {AbortSignal} signal - Signal to abort the fetch request.
 * @param {Object} callbacks - Object containing onContent, onReasoning, onError, and onComplete hooks.
 */
async function streamChatApi(payload, signal, callbacks) {
    const { onContent, onReasoning, onToolCall, onToolResult, onError, onComplete } = callbacks;
    try {
        const response = await fetch('http://127.0.0.1:5000/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: signal
        });

        if (!response.body) throw new Error("No readable stream available.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const deltaObj = JSON.parse(line);
                    if (deltaObj.tool_call) {
                        onToolCall && onToolCall(deltaObj.tool_call);        // {id, name, arguments}
                    } else if (deltaObj.tool_result) {
                        onToolResult && onToolResult(deltaObj.tool_result);  // {id, name, result}
                    } else if (deltaObj.content) {
                        onContent && onContent(deltaObj.content);
                    } else if (deltaObj.reasoning_content) {
                        onReasoning && onReasoning(deltaObj.reasoning_content);
                    }
                } catch (e) {
                    console.error("Failed to parse buffered line:", line, e);
                }
            }
        }
        if (onComplete) onComplete();
    } catch (error) {
        if (onError) onError(error);
    }
}

/**
 * Sends the current application state to the backend to be persisted.
 * @param {Object} state - The complete state object (nodes, groups, camera, etc).
 */
async function apiSaveState(state) {
    try {
        await fetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: state })
        });
    } catch (e) {
        console.error("SQLite save failed:", e);
    }
}

/**
 * Fetches the persisted application state from the backend.
 * @returns {Object|null} The saved state object, or null if loading fails.
 */
async function apiLoadState() {
    try {
        const response = await fetch('/api/load');
        const data = await response.json();
        return data;
    } catch (e) {
        console.error("SQLite load failed:", e);
        return null;
    }
}

/**
 * Retrieves the list of files available in the backend sandbox directory.
 * @returns {Object|null} An object containing the list of files, or null if it fails.
 */
async function apiFetchSandboxFiles() {
    const res = await fetch('/api/sandbox/files');
    if (!res.ok) return null;
    return await res.json();
}

/**
 * Uploads an array of files via FormData to the backend sandbox directory.
 * @param {FormData} formData - The files to upload wrapped in a FormData object.
 * @returns {boolean} True if the upload was successful, false otherwise.
 */
async function apiUploadSandboxFiles(formData) {
    const res = await fetch('/api/sandbox/upload', {
        method: 'POST',
        body: formData
    });
    return res.ok;
}

/**
 * Creates a new folder in the sandbox directory.
 * @param {string} folderName - The name of the folder to create.
 * @returns {boolean} True if creation was successful, false otherwise.
 */
async function apiCreateSandboxFolder(folderName) {
    const res = await fetch('/api/sandbox/create_folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: folderName })
    });
    return res.ok;
}

/**
 * Deletes a file from the sandbox directory.
 * @param {string} filename - The relative path of the file to delete.
 * @returns {boolean} True if the deletion was successful, false otherwise.
 */
async function apiDeleteSandboxFile(filename) {
    const encodedPath = filename.split('/').map(encodeURIComponent).join('/');
    const res = await fetch('/api/sandbox/delete/' + encodedPath, {
        method: 'DELETE'
    });
    return res.ok;
}

/**
 * Moves files to a new directory.
 * @param {string[]} paths - The relative paths of the files/folders to move.
 * @param {string} target - The target directory path (relative to sandbox).
 * @returns {boolean} True if the move was successful, false otherwise.
 */
async function apiMoveSandboxFiles(paths, target) {
    const res = await fetch('/api/sandbox/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths, target })
    });
    return res.ok;
}

/**
 * Fetches the raw content of a specific file from the sandbox.
 * @param {string} filepath - The relative path of the file to fetch.
 * @returns {Response|null} The raw fetch response, or null if it fails.
 */
async function apiFetchSandboxFile(filepath) {
    const res = await fetch('/sandbox/' + filepath);
    if (!res.ok) return null;
    return res;
}

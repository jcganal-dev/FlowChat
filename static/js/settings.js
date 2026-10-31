const settings = document.getElementById('settings')
const side = settings.querySelector('.side')
const main = settings.querySelector('.main')
let inSettings = false
function showSettings() {
    side.style.backgroundColor = inSettings?'transparent':'var(--bg-input)';
    main.style.display = inSettings?'none':'flex';
    inSettings = !inSettings
    if (inSettings) refreshSettingsPanel();
}

async function refreshSettingsPanel() {
    const statusEl = document.getElementById('settings-api-key-status');
    const modelInput = document.getElementById('settings-model');
    try {
        const res = await fetch('/api/settings');
        if (!res.ok) throw new Error('failed');
        const data = await res.json();
        statusEl.textContent = data.api_key_set
            ? `Current key: ${data.api_key_masked}`
            : 'No API key set — chat will not work until you add one.';
        modelInput.value = data.model || '';
        modelInput.placeholder = data.model || 'openrouter/free';
    } catch (e) {
        statusEl.textContent = 'Could not load current settings.';
    }
}

document.getElementById('settings-save-btn').addEventListener('click', async () => {
    const keyInput = document.getElementById('settings-api-key');
    const modelInput = document.getElementById('settings-model');
    const saveBtn = document.getElementById('settings-save-btn');

    const payload = {};
    if (keyInput.value.trim()) payload.api_key = keyInput.value.trim();
    if (modelInput.value.trim()) payload.model = modelInput.value.trim();

    if (!payload.api_key && !payload.model) {
        if (typeof showToast === 'function') showToast('Nothing to save — type a new key or model first.', 'info', 2500);
        return;
    }

    saveBtn.disabled = true;
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) {
            if (typeof showToast === 'function') showToast(data.detail || 'Failed to save settings.', 'error', 3500);
            return;
        }
        keyInput.value = '';
        modelInput.setAttribute('placeholder', modelInput.value.trim())
        modelInput.value = '';
        // Only touch the key status line if the key itself was changed;
        // otherwise leave whatever it was showing (e.g. the persisted
        // "Current key: …" from the panel refresh) untouched.
        if (payload.api_key) {
            const statusEl = document.getElementById('settings-api-key-status');
            statusEl.textContent = `Key updated. Current key: ${data.api_key_masked}`;
        }
        // Propagate a model change to the live UI: refresh the cached
        // default, release nodes that were merely following the old
        // default, and re-resolve every dropdown that has no explicit
        // per-node pick.
        if (payload.model && typeof defaultModel !== 'undefined') {
            const oldDefault = defaultModel;
            defaultModel = data.model || oldDefault;
            nodes.forEach(n => { if (n.selectedModel === oldDefault) n.selectedModel = null; });
            if (typeof clearModelCache === 'function') clearModelCache();
            document.querySelectorAll('.node').forEach(el => {
                const inst = el.__nodeInstance;
                if (inst && inst.nodeData && !inst.nodeData.selectedModel &&
                    typeof inst.populateModelSelection === 'function') {
                    inst.populateModelSelection();
                }
            });
            if (typeof populateFocusModelSelection === 'function') populateFocusModelSelection();
        }
        if (typeof showToast === 'function') showToast('Settings saved', 'success', 2500);
    } catch (e) {
        if (typeof showToast === 'function') showToast('Failed to save settings.', 'error', 3500);
    } finally {
        saveBtn.disabled = false;
    }
});
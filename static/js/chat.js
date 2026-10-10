/**
 * Traverses up the conversation tree from a leaf node to the root, compiling the chat history.
 * @param {string} leafNodeId - The ID of the leaf node.
 * @returns {Array} An array of message objects containing role and content for the LLM.
 */
function walkContext(leafNodeId) {
    const history = [];
    let currentId = leafNodeId;

    while (currentId) {
        const node = nodes.find(n => n.id === currentId);
        if (!node) break;

        if (node.isCollapsed) {
            if (node.summaryText) {
                history.push({ role: 'system', content: `[COMPRESSED HISTORY]: ${node.summaryText}` });
            }
        } else if (!node.muted) {
            if (node.type === 'document' && (node.files && node.files.length > 0)) {
                node.files.forEach(f => {
                    history.push({ role: 'user', content: `[DOCUMENT ATTACHED: ${f.name || 'Document'}]\n${f.payload}` });
                });
            } else if (node.type === 'image' && (node.files && node.files.length > 0)) {
                const images = node.files.map(f => ({ type: "image_url", image_url: { url: f.payload } }));
                history.push({ role: 'user', content: images });
            } else {
                if (node.aiText) history.push({ role: 'assistant', content: node.aiText });
                if (node.userText) history.push({ role: 'user', content: node.userText });
            }
        }
        currentId = node.parentId;
    }
    history.reverse();
    return history;
}

/**
 * Estimates the number of tokens an array of messages will consume using a generic character heuristic.
 * @param {Array} messages - The compiled message history.
 * @returns {number} The estimated token count.
 */
function estimateTokens(messages) {
    const totalChars = messages.reduce((acc, msg) => acc + (msg.content ? msg.content.length : 0), 0);
    return Math.ceil(totalChars / 4);
}

/**
 * Updates the context token visualizer (thermometer) to show how full the LLM context window is.
 * @param {string} nodeId - The current active leaf node to measure context from.
 */
function updateThermometer(nodeId) {
    if (!nodeId) return;
    const history = walkContext(nodeId);
    const tokens = estimateTokens(history);
    const pct = Math.min(100, Math.round((tokens / CONTEXT_LIMIT) * 100));

    const counter = document.getElementById('token-counter');
    const fill = document.getElementById('meter-fill');

    if (counter && fill) {
        counter.textContent = `${tokens.toLocaleString()} / ${CONTEXT_LIMIT.toLocaleString()} tokens (${pct}%)`;
        fill.style.width = `${pct}%`;
        fill.className = pct > 85 ? 'danger' : pct > 65 ? 'warning' : '';
    }
}

/**
 * Extracts context, parses inline @references, and streams a completion request to the LLM backend for a given node.
 * Updates the node's UI dynamically as the stream returns content and reasoning.
 * @param {string} nodeId - The ID of the chat node triggering the execution.
 */
async function triggerSummarize(groupId) {
    const group = groups[groupId];
    const token_per_node = 150
    if (!group) return;

    const groupNodes = nodes.filter(n => n.groupId === groupId);
    let rawText = "";
    const summarizableNodes = [];

    groupNodes.forEach((n, idx) => {
        if (n.type === 'document' || n.type === 'image') return;
        const uText = n.userText || "";
        const aText = n.aiText || "";
        if (uText.trim() === "" && aText.trim() === "") return;
        rawText += `[NODE_${idx}]\nUser: ${uText}\nAI: ${aText}\n\n`;
        summarizableNodes.push(n);
    });

    const btn = document.querySelector(`#box_${groupId} .summarize-btn`);

    if (summarizableNodes.length === 0) {
        if (btn) btn.innerHTML = `<img src='${getIconpath('bulb')}' class="file-icon" style='margin-bottom: -2px;'> Summarize`
        group.isSummarized = true;
        if (typeof renderGroups === 'function') renderGroups();
        return;
    }

    if (btn) btn.innerHTML = "<img src='" + getIconpath('magnifying-glass') + "' class='file-icon' style='margin-bottom: -2px;'> Summarizing...";

    const payload = {
        messages: [
            { role: "system", content: "You are a quick and precise summarizer. The user will provide a conversation segment broken into distinct [NODE_X] parts. For EACH node, write a summary that captures BOTH what the user asked/requested and what the AI did/said in response. Be as concise as possible without losing the core meaning of the interaction. You MUST wrap each summary in exact XML tags matching the node index, for example: <SUMMARY_0>User asked about X, AI explained Y.</SUMMARY_0>. Do not include any other text. [System Reminder] Do not overthink, immediately stop thinking after you arrive at an answer. [End System Reminder]" },
            { role: "user", content: rawText }
        ],
        max_tokens: summarizableNodes.length * token_per_node
    };

    let summary = "";
    await streamChatApi(payload, null, {
        onContent: (content) => {
            summary += content;
        },
        onReasoning: (reasoning) => {
            if (btn && summary === "") btn.innerHTML = "<img src='" + getIconpath('clock') + "' class='file-icon' style='margin-bottom: -2px;'> Thinking...";
        },
        onError: (error) => {
            console.error("Summarize failed:", error);
            if (btn) btn.innerHTML = "<img src='" + getIconpath('error') + "' class='file-icon' style='margin-bottom: -2px;'> Error";
        },
        onComplete: () => {
            groupNodes.forEach((n, idx) => {
                if (n.type === 'document' || n.type === 'image') return;
                const uText = n.userText || "";
                const aText = n.aiText || "";
                if (uText.trim() === "" && aText.trim() === "") return;

                const el = document.getElementById(n.id);
                const oldHeight = el ? el.offsetHeight : 0;

                const regex = new RegExp(`<SUMMARY_${idx}>([\\s\\S]*?)</SUMMARY_${idx}>`);
                const match = summary.match(regex);

                n.summaryText = match && match[1].trim() ? match[1].trim() : "Summary unavailable.";
                n.isCollapsed = true;
                if (el) {
                    el.classList.add('collapsed-node');
                    const sumEl = el.querySelector('.node-summary-display');
                    if (sumEl) sumEl.innerHTML = typeof renderMarkdown === 'function' ? renderMarkdown(n.summaryText) : n.summaryText;

                    const toggleBtn = el.querySelector('.toggle-btn');
                    if (toggleBtn) {
                        toggleBtn.style.display = 'inline-block';
                        toggleBtn.innerHTML = '<img src="/static/icons/expand.svg" class="file-icon">';
                    }

                    const newHeight = el.offsetHeight;
                    const deltaY = newHeight - oldHeight;
                    if (deltaY !== 0) {
                        if (typeof shiftChildrenXY === 'function') shiftChildrenXY(n.id, 0, deltaY);
                    }
                }
            });

            group.isCollapsed = true;
            if (typeof drawGroups === 'function') drawGroups();
            updateThermometer(activeNodeId);
            if (typeof saveState === 'function') saveState();
        }
    });
}

/**
 * Requests the LLM to generate a concise summary for a single individual node.
 * @param {string} nodeId - The ID of the node to summarize.
 */
async function triggerSingleSummarize(nodeId) {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    const uText = node.userText || "";
    const aText = node.aiText || "";
    if (uText.trim() === "" && aText.trim() === "") return;
    if (node.type === 'document' || node.type === 'image') return;

    let rawText = `User: ${uText}\nAI: ${aText}`;

    const el = document.getElementById(node.id);
    let sumEl = null;
    if (el) {
        sumEl = el.querySelector('.node-summary-display');
        if (sumEl) {
            sumEl.style.display = 'block';
            sumEl.innerHTML = "<img src='" + getIconpath('magnifying-glass') + "' class='file-icon' style='margin-bottom: -2px;'> Summarizing...";
        }
    }

    const payload = {
        messages: [
            { role: "system", content: "You are a quick and precise summarizer. Write a summary as concise as possible without it lossing the meaning of the conversation segment. Do NOT include formatting, tags, or labels. [System Reminder] Do not overthink, immediately stop thinking after you arrive at an answer. [End System Reminder]" },
            { role: "user", content: rawText }
        ],
        max_tokens: 150
    };

    let summary = "";
    await streamChatApi(payload, null, {
        onContent: (content) => {
            summary += content;
            if (sumEl) sumEl.innerHTML = typeof renderMarkdown === 'function' ? renderMarkdown(summary) : summary;
        },
        onReasoning: (reasoning) => {
            if (sumEl && summary === "") sumEl.innerHTML = "<img src='" + getIconpath('clock') + "' class='file-icon' style='margin-bottom: -2px;'> Thinking...";
        },
        onError: (error) => {
            console.error("Single Summarize failed:", error);
            if (sumEl) sumEl.innerHTML = "<img src='" + getIconpath('error') + "' class='file-icon' style='margin-bottom: -2px;'> Error";
        },
        onComplete: () => {
            const oldHeight = el ? el.offsetHeight : 0;
            node.summaryText = summary.trim() || "Summary unavailable.";
            node.isCollapsed = true;

            if (el) {
                el.classList.add('collapsed-node');
                if (sumEl) {
                    sumEl.innerHTML = typeof renderMarkdown === 'function' ? renderMarkdown(node.summaryText) : node.summaryText;
                }
                const toggleBtn = el.querySelector('.toggle-btn');
                if (toggleBtn) {
                    toggleBtn.style.display = 'inline-block';
                    toggleBtn.innerHTML = '<img src="/static/icons/expand.svg" class="file-icon">';
                }

                const newHeight = el.offsetHeight;
                const deltaY = newHeight - oldHeight;
                if (deltaY !== 0) {
                    if (typeof shiftChildrenXY === 'function') shiftChildrenXY(node.id, 0, deltaY);
                }
            }
            if (typeof drawGroups === 'function') drawGroups();
            updateThermometer(activeNodeId);
            if (typeof saveState === 'function') saveState();
        }
    });
}

/**
 * Expands or collapses a group container, hiding or revealing the individual node contents inside it.
 * @param {string} groupId - The ID of the group to toggle.
 */
function toggleGroupState(groupId) {
    const group = groups[groupId];
    group.isCollapsed = !group.isCollapsed;

    nodes.forEach(n => {
        if (n.groupId === groupId) {
            const el = document.getElementById(n.id);
            const oldHeight = el ? el.offsetHeight : 0;

            n.isCollapsed = group.isCollapsed;
            if (el) {
                el.classList.toggle('collapsed-node', n.isCollapsed);
                const btn = el.querySelector('.toggle-btn');
                if (btn) btn.innerHTML = n.isCollapsed ? '<img src="/static/icons/expand.svg" class="file-icon">' : '<img src="/static/icons/collapse.svg" class="file-icon">';

                const newHeight = el.offsetHeight;
                const deltaY = newHeight - oldHeight;
                if (deltaY !== 0) {
                    if (typeof shiftChildrenXY === 'function') shiftChildrenXY(n.id, 0, deltaY);
                }
            }
        }
    });

    if (typeof drawGroups === 'function') drawGroups();
    updateThermometer(activeNodeId);
    if (typeof saveState === 'function') saveState();
    if (typeof updateCanvas === 'function') updateCanvas();
}

/**
 * Expands or collapses an individual node, swapping between its full text and its summary snippet.
 * @param {string} nodeId - The ID of the node to toggle.
 */
function toggleNodeState(nodeId) {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    const el = document.getElementById(nodeId);
    let oldHeight = 0;
    if (el) oldHeight = el.offsetHeight;

    node.isCollapsed = !node.isCollapsed;

    if (el) {
        el.classList.toggle('collapsed-node', node.isCollapsed);
        const btn = el.querySelector('.toggle-btn');
        if (btn) btn.innerHTML = node.isCollapsed ? '<img src="/static/icons/expand.svg" class="file-icon">' : '<img src="/static/icons/collapse.svg" class="file-icon">';

        const newHeight = el.offsetHeight;
        const deltaY = newHeight - oldHeight;
        if (deltaY !== 0) {
            if (typeof shiftChildrenXY === 'function') shiftChildrenXY(nodeId, 0, deltaY);
        }
    }

    if (typeof drawGroups === 'function') drawGroups();
    updateThermometer(activeNodeId);
    if (typeof saveState === 'function') saveState();
    if (typeof updateCanvas === 'function') updateCanvas();
}

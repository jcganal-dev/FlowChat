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
async function runUserNode(nodeId) {
    const nodeEl = document.getElementById(nodeId);
    const textarea = nodeEl.querySelector('.node-input');
    const usertext = textarea.textContent.trim();
    if (!usertext) return;
    
    const nodeData = nodes.find(n => n.id === nodeId);

    const chips = Array.from(nodeEl.querySelectorAll('.reference-node'));
    const refs = chips.map(chip => chip.getAttribute('data-ref')).filter(id => id);
    nodeData.references = refs;

    nodeData.userText = usertext;
    nodeData.aiText = "";
    nodeData.aiThinking = "";

    nodeData.abortController = new AbortController();
    const signal = nodeData.abortController.signal;

    const aiContentEl = nodeEl.querySelector('.ai-content');
    const aiThinkEl = nodeEl.querySelector('.think-content');
    const runBtn = nodeEl.querySelector('.run-btn');
    const stopBtn = nodeEl.querySelector('.stop-btn');

    aiContentEl.innerHTML = '';
    aiThinkEl.innerHTML = "";
    aiThinkEl.style.display = "none";
    textarea.contentEditable = false;

    runBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'inline-block';

    forkOffsetCounter = 0;

    const history = walkContext(nodeId);
    updateThermometer(nodeId);

    if (refs.length > 0) {
        let systemDirectives = "STRICT INSTRUCTIONS FROM REFERENCED NODES:\n";
        let hasImageRefs = false;
        const imageContents = [];
        let hasTextRefs = false;

        refs.forEach(rId => {
            const rNode = nodes.find(n => n.id === rId);
            if (rNode) {
                if (rNode.type === 'image' && (rNode.files && rNode.files.length > 0)) {
                    hasImageRefs = true;
                    rNode.files.forEach(f => {
                        imageContents.push({ type: "image_url", image_url: { url: f.payload } });
                    });
                } else if (rNode.type === 'document' && (rNode.files && rNode.files.length > 0)) {
                    hasTextRefs = true;
                    rNode.files.forEach(f => {
                        systemDirectives += `\n[DOCUMENT ATTACHED: ${f.name}]\n${f.payload}\n`;
                    });
                } else if (rNode.type === 'chat' || !rNode.type) {
                    hasTextRefs = true;
                    systemDirectives += `\nRule: ${rNode.userText}\nStatus: ${rNode.aiText}\n`;
                }
            }
        });

        if (hasTextRefs) {
            if (history.length > 0 && history[0].role === 'system') {
                history[0].content += "\n\n" + systemDirectives;
            } else {
                history.unshift({ role: 'system', content: systemDirectives });
            }
        }

        if (hasImageRefs && history.length > 0) {
            const lastMsg = history[history.length - 1];
            if (lastMsg.role === 'user') {
                const originalText = lastMsg.content;
                lastMsg.content = [
                    { type: "text", text: originalText },
                    ...imageContents
                ];
            }
        }
    }

    let aborted = false;
    textarea.style.border = "none";
    textarea.style.background = "transparent";
    textarea.style.height = "auto";
    textarea.style.color = "#eee";

    let erased_thoughts = false;

    // Dynamically inject the system reminder into the final user message for the API call only
    if (history.length > 0) {
        const lastMsg = history[history.length - 1];
        if (lastMsg.role === 'user') {
            const reminderText = "[System Reminder] 1. Do not overthing, determine the task, immidiately stop thinking after you arrive at an answer. [End System Reminder]\n";
            if (typeof lastMsg.content === 'string') {
                lastMsg.content = reminderText + lastMsg.content;
            } else if (Array.isArray(lastMsg.content) && lastMsg.content.length > 0 && lastMsg.content[0].type === 'text') {
                lastMsg.content[0].text = reminderText + lastMsg.content[0].text;
            }
        }
    }

    const payload = { messages: history, max_tokens: 1000 };

    await streamChatApi(payload, signal, {
        onContent: (content) => {
            if (!erased_thoughts) {
                if (typeof erase_thoughts !== 'undefined' && erase_thoughts) {
                    aiThinkEl.innerHTML = '';
                    nodeData.aiThinking = '';
                }
                erased_thoughts = true;
            }
            nodeData.aiText += content;
            if (typeof renderMarkdown === 'function') {
                aiContentEl.innerHTML = renderMarkdown(nodeData.aiText);
            } else {
                aiContentEl.innerHTML += content;
            }
            if (typeof drawEdges === 'function') drawEdges();
            updateThermometer(nodeId);
        },
        onReasoning: (reasoning) => {
            aiThinkEl.style.display = "flex";
            nodeData.aiThinking += reasoning;
            if (typeof renderMarkdown === 'function') {
                aiThinkEl.innerHTML = renderMarkdown(nodeData.aiThinking);
            } else {
                aiThinkEl.innerHTML += reasoning;
            }
            aiThinkEl.scrollTop = aiThinkEl.scrollHeight;
            if (typeof drawEdges === 'function') drawEdges();
            updateThermometer(nodeId);
        },
        onError: (error) => {
            if (error.name === 'AbortError' || (error.message && error.message.includes('AbortError'))) {
                aborted = true;
                aiContentEl.innerHTML += `<br><br><span style="color: #ffb86c; font-size: 12px;">[Stopped by User]</span>`;
                textarea.contentEditable = true;
                textarea.style.border = "";
                textarea.style.background = "";
                runBtn.style.display = 'inline-block';
                stopBtn.style.display = 'none';
            } else {
                aiContentEl.innerHTML = `<span style="color: #ff5555;">Error: ${error.message}</span>`;
            }
        },
        onComplete: () => {
            nodeEl.querySelector('.add-child-btn').classList.remove('hidden');
            nodeEl.querySelector('.add-child-btn').click();
        }
    });

    if (!aborted) {
        const btnRow = nodeEl.querySelector('.button-row');
        if (btnRow) btnRow.style.display = 'none';
    }

    if (!textarea.disabled) {
        textarea.disabled = false;
    }
    updateThermometer(nodeId);
}

/**
 * Compiles all conversation text within a specified group and requests the LLM to generate individual summaries for each node.
 * @param {string} groupId - The ID of the group to summarize.
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
        rawText += `[NODE_${idx}]\nUser: ${n.userText}\nAI: ${n.aiText}\n\n`;
        summarizableNodes.push(n);
    });

    const btn = document.querySelector(`#box_${groupId} .summarize-btn`);
    
    if (summarizableNodes.length === 0) {
        if (btn) btn.textContent = "✨ Summarize";
        group.isSummarized = true;
        if (typeof renderGroups === 'function') renderGroups();
        return;
    }

    if (btn) btn.textContent = "⏳ Summarizing...";

    const payload = {
        messages: [
            { role: "system", content: "You are a quick and precise summarizer. The user will provide a conversation segment broken into distinct [NODE_X] parts. For EACH node, write a summary as concise as possible without losing its meaning. You MUST wrap each summary in exact XML tags matching the node index, for example: <SUMMARY_0>this is the summary</SUMMARY_0>. Do not include any other text. [System Reminder] Do not overthink, immediately stop thinking after you arrive at an answer. [End System Reminder]" },
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
            if (btn && summary === "") btn.textContent = "⏳ Thinking...";
        },
        onError: (error) => {
            console.error("Summarize failed:", error);
            if (btn) btn.textContent = "❌ Error";
        },
        onComplete: () => {
            groupNodes.forEach((n, idx) => {
                if (n.type === 'document' || n.type === 'image') {
                    n.isCollapsed = true;
                    const el = document.getElementById(n.id);
                    if (el) el.classList.add('collapsed-node');
                    return;
                }

                const regex = new RegExp(`<SUMMARY_${idx}>([\\s\\S]*?)</SUMMARY_${idx}>`);
                const match = summary.match(regex);
                
                n.summaryText = match && match[1].trim() ? match[1].trim() : "Summary unavailable.";
                n.isCollapsed = true;
                const el = document.getElementById(n.id);
                if (el) {
                    el.classList.add('collapsed-node');
                    const sumEl = el.querySelector('.node-summary-display');
                    if (sumEl) sumEl.innerHTML = typeof renderMarkdown === 'function' ? renderMarkdown(n.summaryText) : n.summaryText;

                    const toggleBtn = el.querySelector('.toggle-btn');
                    if (toggleBtn) {
                        toggleBtn.style.display = 'inline-block';
                        toggleBtn.textContent = '🔍';
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

    let rawText = `User: ${node.userText}\nAI: ${node.aiText}`;

    const el = document.getElementById(node.id);
    let sumEl = null;
    if (el) {
        sumEl = el.querySelector('.node-summary-display');
        if (sumEl) {
            sumEl.style.display = 'block';
            sumEl.textContent = "⏳ Summarizing...";
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
            if (sumEl && summary === "") sumEl.textContent = "⏳ Thinking...";
        },
        onError: (error) => {
            console.error("Single Summarize failed:", error);
            if (sumEl) sumEl.textContent = "❌ Error";
        },
        onComplete: () => {
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
                    toggleBtn.textContent = '📂';
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
            n.isCollapsed = group.isCollapsed;
            const el = document.getElementById(n.id);
            if (el) {
                el.classList.toggle('collapsed-node', n.isCollapsed);
                const btn = el.querySelector('.toggle-btn');
                if (btn) btn.textContent = n.isCollapsed ? '🔍' : '📂';
            }
        }
    });

    if (typeof drawGroups === 'function') drawGroups();
    updateThermometer(activeNodeId);
    if (typeof saveState === 'function') saveState();
}

/**
 * Expands or collapses an individual node, swapping between its full text and its summary snippet.
 * @param {string} nodeId - The ID of the node to toggle.
 */
function toggleNodeState(nodeId) {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    node.isCollapsed = !node.isCollapsed;

    const el = document.getElementById(nodeId);
    if (el) {
        el.classList.toggle('collapsed-node', node.isCollapsed);
        const btn = el.querySelector('.toggle-btn');
        if (btn) btn.textContent = node.isCollapsed ? '🔍' : '📂';
    }

    if (typeof drawGroups === 'function') drawGroups();
    updateThermometer(activeNodeId);
    if (typeof saveState === 'function') saveState();
}

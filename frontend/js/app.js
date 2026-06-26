// ==========================================================================
// Application Core & Tab Navigation
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
    // Nav Button Click Handlers
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const section = btn.dataset.section;
            switchSection(section);
        });
    });

    // Initialize Page
    switchSection('home');
    refreshStats();
    refreshHistory();

    // Set up form and drop-zone event listeners
    setupUploadHandlers('compress');
    setupUploadHandlers('decompress');

    // History refresh button
    document.getElementById('btn-refresh-history').addEventListener('click', () => {
        refreshHistory();
        refreshStats();
        showToast('History updated', 'success');
    });

    // Text playground analyzer button
    document.getElementById('btn-playground-analyze').addEventListener('click', handlePlaygroundAnalyze);

    // Character search handler
    document.getElementById('char-search').addEventListener('input', handleCharacterSearch);

    // Reset zoom button
    document.getElementById('vis-reset-zoom').addEventListener('click', () => {
        if (activeVisualizationData) {
            renderHuffmanTree(activeVisualizationData.tree);
        }
    });
});

let activeVisualizationData = null;

// Tab switcher
function switchSection(sectionId) {
    // Update nav state
    document.querySelectorAll('.nav-btn').forEach(btn => {
        if (btn.dataset.section === sectionId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Update tab visibility
    document.querySelectorAll('.tab-content').forEach(tab => {
        if (tab.id === `${sectionId}-section`) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });

    // Handle section-specific loads
    if (sectionId === 'dashboard') {
        refreshHistory();
        refreshStats();
    }
}

// ==========================================================================
// API Communication Helpers
// ==========================================================================

async function fetchApi(endpoint, options = {}) {
    try {
        const response = await fetch(endpoint, options);
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Server error occurred.');
        }
        return data;
    } catch (err) {
        showToast(err.message, 'error');
        throw err;
    }
}

async function refreshStats() {
    try {
        const data = await fetchApi('/api/stats');
        if (data.success) {
            const stats = data.stats;
            
            // Format sizes
            const totalSavedStr = formatBytes(stats.totalSavedBytes);
            const ratioStr = stats.averageRatio > 0 ? stats.averageRatio.toFixed(3) : 'N/A';

            // Home Page Hero Stats
            document.getElementById('hero-avg-ratio').textContent = ratioStr;
            document.getElementById('hero-saved-space').textContent = totalSavedStr;
            document.getElementById('hero-total-ops').textContent = stats.totalOperations;

            // Dashboard Page Stats
            document.getElementById('dash-total-savings').textContent = totalSavedStr;
            document.getElementById('dash-avg-ratio').textContent = ratioStr;
            document.getElementById('dash-total-ops').textContent = stats.totalOperations;
        }
    } catch (e) {
        console.error('Failed to load stats:', e);
    }
}

async function refreshHistory() {
    try {
        const data = await fetchApi('/api/history');
        if (data.success) {
            const tbody = document.getElementById('history-table-body');
            tbody.innerHTML = '';

            if (data.history.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="text-center">No operation history found. Run a compression or decompression first!</td></tr>`;
                return;
            }

            data.history.forEach(item => {
                const tr = document.createElement('tr');
                
                const size1 = formatBytes(item.originalSize);
                const size2 = formatBytes(item.compressedSize);
                
                let savingsText = '';
                if (item.type === 'compress') {
                    savingsText = `${(item.savings).toFixed(1)}% saved (${item.ratio.toFixed(2)}x)`;
                } else {
                    savingsText = `Restored (${(item.originalSize / item.compressedSize).toFixed(2)}x expansion)`;
                }

                const opLabel = item.type === 'compress' 
                    ? `<span class="badge success-badge"><i class="fa-solid fa-file-zipper"></i> Compress</span>`
                    : `<span class="badge" style="background: rgba(99,102,241,0.1); border-color: rgba(99,102,241,0.2); color: var(--secondary);"><i class="fa-solid fa-file-arrow-up"></i> Decompress</span>`;

                tr.innerHTML = `
                    <td><strong>${escapeHtml(item.fileName)}</strong></td>
                    <td>${opLabel}</td>
                    <td>${size1}</td>
                    <td>${size2}</td>
                    <td>${savingsText}</td>
                    <td>${item.date} <span style="color: var(--text-muted); font-size: 0.8rem; margin-left:4px;">${item.timeStr}</span></td>
                    <td>
                        <a href="/api/download/${item.id}" class="btn btn-mini btn-primary" title="Download">
                            <i class="fa-solid fa-download"></i> Download
                        </a>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (e) {
        console.error('Failed to load history:', e);
    }
}

// ==========================================================================
// Drag & Drop & Upload Handlers
// ==========================================================================

function setupUploadHandlers(mode) {
    const dropZone = document.getElementById(`${mode}-drop-zone`);
    const fileInput = document.getElementById(`${mode}-file-input`);
    const fileDetails = document.getElementById(`${mode}-file-details`);
    const filenameEl = document.getElementById(`${mode}-filename`);
    const filesizeEl = document.getElementById(`${mode}-filesize`);
    const removeBtn = document.getElementById(`${mode}-remove-btn`);
    const submitBtn = document.getElementById(`${mode}-submit-btn`);
    const form = document.getElementById(`${mode}-form`);
    const progressContainer = document.getElementById(`${mode}-progress-container`);
    const progressBar = document.getElementById(`${mode}-progress-bar`);
    const resultsPanel = document.getElementById(`${mode}-results`);

    // Click trigger file browse
    dropZone.addEventListener('click', () => fileInput.click());

    // Drag-drop events
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
        }, false);
    });

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            handleFileSelection(files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelection(e.target.files[0]);
        }
    });

    removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        resetUploadForm();
    });

    function handleFileSelection(file) {
        // Size validation (15MB)
        const limitBytes = 15 * 1024 * 1024;
        if (file.size > limitBytes) {
            showToast('File exceeds the 15MB limit size.', 'error');
            resetUploadForm();
            return;
        }

        // Correct file extension for decompress
        if (mode === 'decompress' && !file.name.endsWith('.huf')) {
            showToast('Please upload a compressed file ending in .huf', 'warning');
            resetUploadForm();
            return;
        }

        filenameEl.textContent = file.name;
        filesizeEl.textContent = formatBytes(file.size);
        
        dropZone.style.display = 'none';
        fileDetails.style.display = 'flex';
        submitBtn.disabled = false;
        resultsPanel.style.display = 'none';
    }

    function resetUploadForm() {
        fileInput.value = '';
        dropZone.style.display = 'block';
        fileDetails.style.display = 'none';
        submitBtn.disabled = true;
        progressContainer.style.display = 'none';
        progressBar.style.width = '0%';
    }

    // Form Submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const file = fileInput.files[0];
        if (!file) return;

        submitBtn.disabled = true;
        progressContainer.style.display = 'block';
        progressBar.style.width = '20%';

        const formData = new FormData();
        formData.append('file', file);

        try {
            progressBar.style.width = '50%';
            const result = await fetchApi(`/api/${mode}`, {
                method: 'POST',
                body: formData
            });

            progressBar.style.width = '90%';
            if (result.success) {
                progressBar.style.width = '100%';
                setTimeout(() => {
                    progressContainer.style.display = 'none';
                    showToast(`${mode === 'compress' ? 'Compression' : 'Decompression'} completed successfully!`, 'success');
                    displayResults(result);
                }, 300);
            }
        } catch (err) {
            progressContainer.style.display = 'none';
            submitBtn.disabled = false;
            console.error(err);
        }
    });

    function displayResults(data) {
        resultsPanel.style.display = 'block';
        
        if (mode === 'compress') {
            document.getElementById('compress-result-title').textContent = data.stats.compressedName;
            document.getElementById('comp-orig-size').textContent = formatBytes(data.stats.originalSize);
            document.getElementById('comp-new-size').textContent = formatBytes(data.stats.compressedSize);
            document.getElementById('comp-savings').textContent = `${data.stats.savings.toFixed(1)}%`;
            document.getElementById('comp-ratio').textContent = `${data.stats.ratio.toFixed(3)}`;
            document.getElementById('comp-time').textContent = `${(data.stats.time * 1000).toFixed(2)} ms`;
            
            // Set up download button
            const dlBtn = document.getElementById('compress-download-btn');
            dlBtn.href = data.stats.downloadUrl;

            // Set up visualizer data
            if (data.visualization) {
                activeVisualizationData = data.visualization;
                
                // Show view tree button & click event
                const treeBtn = document.getElementById('compress-view-tree-btn');
                treeBtn.style.display = 'block';
                treeBtn.onclick = () => {
                    loadVisualization(data.visualization);
                    switchSection('visualizer');
                };
            } else {
                document.getElementById('compress-view-tree-btn').style.display = 'none';
            }
        } else {
            // Decompress Results
            document.getElementById('decompress-result-title').textContent = data.stats.restoredName;
            document.getElementById('decomp-compressed-size').textContent = formatBytes(data.stats.compressedSize);
            document.getElementById('decomp-restored-size').textContent = formatBytes(data.stats.decompressedSize);
            
            const exp = data.stats.decompressedSize / data.stats.compressedSize;
            document.getElementById('decomp-expansion').textContent = `${exp.toFixed(2)}x`;
            document.getElementById('decomp-time').textContent = `${(data.stats.time * 1000).toFixed(2)} ms`;
            
            // Set up download
            const dlBtn = document.getElementById('decompress-download-btn');
            dlBtn.href = data.stats.downloadUrl;
        }

        refreshStats();
        submitBtn.disabled = false;
    }
}

// ==========================================================================
// Interactive Text Playground
// ==========================================================================

async function handlePlaygroundAnalyze() {
    const textVal = document.getElementById('playground-text').value.trim();
    if (!textVal) {
        showToast('Please type some text to analyze.', 'warning');
        return;
    }

    const analyzeBtn = document.getElementById('btn-playground-analyze');
    analyzeBtn.disabled = true;
    analyzeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Compiling...';

    try {
        const response = await fetchApi('/api/visualize-text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: textVal })
        });

        if (response.success) {
            showToast('Visualization generated!', 'success');
            activeVisualizationData = response.visualization;
            loadVisualization(response.visualization);
            switchSection('visualizer');
        }
    } catch (err) {
        console.error(err);
    } finally {
        analyzeBtn.disabled = false;
        analyzeBtn.innerHTML = '<i class="fa-solid fa-chart-simple"></i> Run Huffman Analysis';
    }
}

// ==========================================================================
// Huffman Tree & Code Visualizer Rendering
// ==========================================================================

function loadVisualization(visData) {
    document.getElementById('vis-empty-state').style.display = 'none';
    document.getElementById('vis-content-wrapper').style.display = 'grid';

    // 1. Populate Code/Freq Table
    const tableBody = document.getElementById('freq-table-body');
    tableBody.innerHTML = '';

    // Sort frequencies descending by count
    const sortedFreqs = [...visData.frequencies].sort((a, b) => b.count - a.count);

    sortedFreqs.forEach(item => {
        const tr = document.createElement('tr');
        tr.id = `char-row-${item.byte}`;
        tr.dataset.byte = item.byte;
        tr.dataset.code = visData.codes[item.byte] || '';

        // Handle escape visual display
        let dispChar = item.char;
        if (dispChar === ' ') dispChar = 'Space';

        tr.innerHTML = `
            <td><code>${item.byte}</code></td>
            <td><span class="char-disp badge">${dispChar}</span></td>
            <td><strong>${item.count}</strong></td>
            <td><code class="code-val">${visData.codes[item.byte] || 'N/A'}</code></td>
        `;

        // Mouse hover highlights tree path
        tr.addEventListener('mouseenter', () => highlightPath(visData.codes[item.byte]));
        tr.addEventListener('mouseleave', clearHighlight);

        tableBody.appendChild(tr);
    });

    // 2. Build Interactive SVG Tree
    renderHuffmanTree(visData.tree);
}

function handleCharacterSearch(e) {
    const query = e.target.value.toLowerCase();
    const rows = document.querySelectorAll('#freq-table-body tr');

    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        if (text.includes(query)) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

/**
 * Render Huffman Binary Tree in SVG
 */
function renderHuffmanTree(rootNode) {
    const svg = document.getElementById('tree-svg');
    svg.innerHTML = ''; // Clear SVG canvas

    if (!rootNode) return;

    // Dimensions
    const container = document.getElementById('tree-canvas-container');
    const width = container.clientWidth || 800;
    const height = 550;
    
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    // Tree Layout Logic:
    // 1. Traverse in-order to assign leaf nodes horizontal positions sequentially
    let leaves = [];
    function assignLeafOrder(node) {
        if (!node) return;
        if (node.isLeaf) {
            leaves.push(node);
        } else {
            assignLeafOrder(node.left);
            assignLeafOrder(node.right);
        }
    }
    assignLeafOrder(rootNode);

    const leafCount = leaves.length;
    const paddingX = 40;
    const leafSpacing = (width - paddingX * 2) / Math.max(1, leafCount - 1);
    
    // Map leaves to their x index positions
    leaves.forEach((leaf, idx) => {
        leaf.x = paddingX + idx * leafSpacing;
    });

    // Determine depth of the tree
    function getDepth(node) {
        if (!node) return 0;
        if (node.isLeaf) return 1;
        return 1 + Math.max(getDepth(node.left), getDepth(node.right));
    }
    const maxDepth = getDepth(rootNode);
    const paddingY = 50;
    const levelHeight = (height - paddingY * 2) / Math.max(1, maxDepth - 1);

    // 2. Bottom-up Coordinate Calculation
    function computeCoords(node, depth, codePrefix) {
        if (!node) return;
        
        node.depth = depth;
        node.code = codePrefix;
        node.y = paddingY + depth * levelHeight;

        if (node.isLeaf) {
            // Leaf coordinates are already defined by horizontal order
            return;
        }

        // Recursively compute children first
        computeCoords(node.left, depth + 1, codePrefix + '0');
        computeCoords(node.right, depth + 1, codePrefix + '1');

        // Internal node x is the midpoint of its children's x coordinates
        node.x = (node.left.x + node.right.x) / 2;
    }
    computeCoords(rootNode, 0, '');

    // 3. Render Links & Nodes in SVG
    const linksGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const nodesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.appendChild(linksGroup);
    svg.appendChild(nodesGroup);

    function drawElements(node) {
        if (!node) return;

        if (!node.isLeaf) {
            // Draw links to children
            [node.left, node.right].forEach((child, idx) => {
                if (!child) return;
                const pathBit = idx === 0 ? '0' : '1';

                // Link line
                const link = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                link.setAttribute('x1', node.x);
                link.setAttribute('y1', node.y);
                link.setAttribute('x2', child.x);
                link.setAttribute('y2', child.y);
                link.setAttribute('class', 'link');
                link.setAttribute('id', `link-path-${child.code}`);
                linksGroup.appendChild(link);

                // Bit label on link
                const midX = (node.x + child.x) / 2;
                const midY = (node.y + child.y) / 2 - 4; // lift slightly above line
                
                const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                label.setAttribute('x', midX);
                label.setAttribute('y', midY);
                label.setAttribute('text-anchor', 'middle');
                label.setAttribute('class', 'link-label');
                label.setAttribute('id', `link-lbl-${child.code}`);
                label.textContent = pathBit;
                linksGroup.appendChild(label);
            });

            // Draw internal child nodes recursively
            drawElements(node.left);
            drawElements(node.right);
        }

        // Create Node Graphic Group
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', `node ${node.isLeaf ? 'leaf' : 'internal'}`);
        g.setAttribute('transform', `translate(${node.x},${node.y})`);
        g.setAttribute('id', `node-g-${node.code}`);

        // Node Circle
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('r', node.isLeaf ? '16' : '12');
        g.appendChild(circle);

        if (node.isLeaf) {
            // Leaf symbol text
            const textSym = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            textSym.setAttribute('y', '4');
            textSym.setAttribute('text-anchor', 'middle');
            textSym.setAttribute('class', 'sym-lbl');
            
            let charDisp = node.symbolDisp;
            if (charDisp === ' ') charDisp = 'SPC';
            if (charDisp === '\\n') charDisp = '\\n';
            if (charDisp === '\\r') charDisp = '\\r';
            if (charDisp === '\\t') charDisp = '\\t';
            textSym.textContent = charDisp;
            g.appendChild(textSym);

            // Frequency offset label (placed below node)
            const textFreq = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            textFreq.setAttribute('y', '32');
            textFreq.setAttribute('text-anchor', 'middle');
            textFreq.setAttribute('class', 'node-freq');
            textFreq.textContent = `f:${node.freq}`;
            g.appendChild(textFreq);

            // Interactivity: Highlight matching table row and tree path on leaf hover
            g.addEventListener('mouseenter', () => {
                highlightPath(node.code);
                highlightTableRow(node.symbol);
            });
            g.addEventListener('mouseleave', () => {
                clearHighlight();
                clearTableRowHighlight();
            });
        } else {
            // Internal Node Frequency inside circle
            const textFreq = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            textFreq.setAttribute('y', '4');
            textFreq.setAttribute('text-anchor', 'middle');
            textFreq.setAttribute('class', 'node-freq');
            textFreq.textContent = node.freq;
            g.appendChild(textFreq);
        }

        nodesGroup.appendChild(g);
    }

    drawElements(rootNode);
}

/**
 * Highlight SVG tree nodes & lines along binary prefix code path
 */
function highlightPath(binaryCode) {
    if (!binaryCode) return;
    
    clearHighlight();

    // Iterate through code path levels (e.g. for "010", we highlight "", "0", "01", "010")
    let currentPath = '';
    
    // Highlight root node
    const rootNodeG = document.getElementById('node-g-');
    if (rootNodeG) rootNodeG.querySelector('circle').style.stroke = 'var(--accent)';

    for (let i = 0; i < binaryCode.length; i++) {
        currentPath += binaryCode[i];
        
        // Highlight link
        const link = document.getElementById(`link-path-${currentPath}`);
        if (link) link.classList.add('highlighted');

        // Highlight label
        const lbl = document.getElementById(`link-lbl-${currentPath}`);
        if (lbl) lbl.classList.add('highlighted');

        // Highlight child node
        const nodeG = document.getElementById(`node-g-${currentPath}`);
        if (nodeG) {
            nodeG.querySelector('circle').style.stroke = 'var(--accent)';
            nodeG.querySelector('circle').style.strokeWidth = '3.5px';
        }
    }
}

function clearHighlight() {
    // Remove link highlights
    document.querySelectorAll('.link').forEach(el => el.classList.remove('highlighted'));
    document.querySelectorAll('.link-label').forEach(el => el.classList.remove('highlighted'));
    
    // Restore node circles
    document.querySelectorAll('.node circle').forEach(el => {
        el.style.stroke = '';
        el.style.strokeWidth = '';
    });
}

function highlightTableRow(byteVal) {
    clearTableRowHighlight();
    const row = document.getElementById(`char-row-${byteVal}`);
    if (row) {
        row.classList.add('highlighted-row');
        row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function clearTableRowHighlight() {
    document.querySelectorAll('#freq-table-body tr').forEach(row => {
        row.classList.remove('highlighted-row');
    });
}

// ==========================================================================
// UI Helpers & Utilities
// ==========================================================================

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'warning') icon = 'fa-triangle-exclamation';
    if (type === 'error') icon = 'fa-circle-exclamation';

    toast.innerHTML = `
        <i class="fa-solid ${icon}"></i>
        <div class="toast-msg">${escapeHtml(message)}</div>
    `;

    container.appendChild(toast);

    // Remove toast after 4s
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s reverse forwards';
        toast.addEventListener('animationend', () => toast.remove());
    }, 4000);
}

function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

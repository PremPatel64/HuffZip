const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5000;

// Setup directories
const ROOT_DIR = path.join(__dirname, '..');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const DOWNLOADS_DIR = path.join(ROOT_DIR, 'downloads');
const TEMP_DIR = path.join(ROOT_DIR, 'temp');
const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

[UPLOADS_DIR, DOWNLOADS_DIR, TEMP_DIR, DATA_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Initialize history file if it doesn't exist
if (!fs.existsSync(HISTORY_FILE)) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({ history: [] }, null, 2));
}

// In-memory mapping of fileId to actual filename + original name for downloads
// (Using an in-memory map or JSON file is standard; JSON file is better for persistence)
const METADATA_FILE = path.join(DATA_DIR, 'metadata.json');
if (!fs.existsSync(METADATA_FILE)) {
    fs.writeFileSync(METADATA_FILE, JSON.stringify({}, null, 2));
}

function getMetadata() {
    try {
        return JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
    } catch (e) {
        return {};
    }
}

function saveMetadata(fileId, meta) {
    const data = getMetadata();
    data[fileId] = meta;
    fs.writeFileSync(METADATA_FILE, JSON.stringify(data, null, 2));
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files
app.use(express.static(path.join(ROOT_DIR, 'frontend')));

// Multer storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        // Prevent directory traversal and secure filename using random string
        const uniqueSuffix = crypto.randomBytes(8).toString('hex');
        const cleanName = path.basename(file.originalname).replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, `${uniqueSuffix}-${cleanName}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 15 * 1024 * 1024 // 15MB max
    }
});

// Get the path to compiled Huffman C++ binary
const HUFFMAN_EXE = path.join(ROOT_DIR, 'compression', process.platform === 'win32' ? 'huffman.exe' : 'huffman');

/**
 * Execute Huffman binary securely
 * @param {string[]} args Arguments to pass to the binary
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
function runHuffman(args) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(HUFFMAN_EXE)) {
            return reject(new Error(`Huffman engine executable not found. Please compile huffman.cpp. Path: ${HUFFMAN_EXE}`));
        }
        // execFile executes binary directly without shell, preventing command injection
        execFile(HUFFMAN_EXE, args, (error, stdout, stderr) => {
            if (error) {
                return reject({ error, stdout, stderr });
            }
            resolve({ stdout, stderr });
        });
    });
}

// Helper: load operation log
function getHistoryList() {
    try {
        const data = fs.readFileSync(HISTORY_FILE, 'utf8');
        return JSON.parse(data).history;
    } catch (e) {
        return [];
    }
}

// Helper: save to history log
function addHistoryEntry(entry) {
    try {
        const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        data.history.unshift(entry); // Add newest at front
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Failed to write history:', e);
    }
}

// ----------------- API ROUTES -----------------

// POST /api/compress
app.post('/api/compress', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file uploaded.' });
    }

    const inputPath = req.file.path;
    const originalName = req.file.originalname;
    const fileId = crypto.randomUUID();
    
    // Generate secure paths
    const compressedName = `${originalName}.huf`;
    const outputPath = path.join(DOWNLOADS_DIR, `${fileId}.huf`);

    try {
        // Run Huffman compression
        const startTime = Date.now();
        const compressResult = await runHuffman(['-c', inputPath, outputPath]);
        const stdout = compressResult.stdout;

        // Parse stdout stats
        let originalSize = 0;
        let compressedSize = 0;
        let timeElapsed = 0;
        let spaceSavings = 0;
        let compressionRatio = 1.0;

        const origMatch = stdout.match(/Original size:\s+(\d+)\s+bytes/);
        const compMatch = stdout.match(/Compressed size:\s+(\d+)\s+bytes/);
        const timeMatch = stdout.match(/Time elapsed:\s+([\d.]+)\s+seconds/);
        const ratioMatch = stdout.match(/Compression ratio:\s+([\d.]+)/);
        const savingsMatch = stdout.match(/Space savings:\s+([\d.]+)\s+%/);

        if (origMatch) originalSize = parseInt(origMatch[1], 10);
        if (compMatch) compressedSize = parseInt(compMatch[1], 10);
        if (timeMatch) timeElapsed = parseFloat(timeMatch[1]);
        if (ratioMatch) compressionRatio = parseFloat(ratioMatch[1]);
        if (savingsMatch) spaceSavings = parseFloat(savingsMatch[1]);

        if (originalSize === 0) {
            originalSize = req.file.size;
            compressedSize = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
        }

        // Run C++ program in visualization mode to get the tree and character frequencies
        // This leverages the C++ binary as the single source of truth for the Huffman algorithm
        let visualization = null;
        try {
            const visResult = await runHuffman(['-v', inputPath]);
            visualization = JSON.parse(visResult.stdout);
        } catch (visErr) {
            console.error('Failed to generate visualization data:', visErr);
        }

        // Save download metadata
        saveMetadata(fileId, {
            filePath: outputPath,
            originalName: compressedName,
            mimeType: 'application/octet-stream'
        });

        // Add history entry
        const historyEntry = {
            id: fileId,
            fileName: originalName,
            type: 'compress',
            originalSize,
            compressedSize,
            ratio: compressionRatio,
            savings: spaceSavings,
            time: timeElapsed,
            date: new Date().toLocaleDateString(),
            timeStr: new Date().toLocaleTimeString()
        };
        addHistoryEntry(historyEntry);

        res.json({
            success: true,
            stats: {
                fileId,
                originalName,
                compressedName,
                originalSize,
                compressedSize,
                ratio: compressionRatio,
                savings: spaceSavings,
                time: timeElapsed,
                downloadUrl: `/api/download/${fileId}`
            },
            visualization
        });
    } catch (err) {
        console.error('Compression error:', err);
        res.status(500).json({ success: false, error: err.stderr || err.message || 'Compression failed.' });
    } finally {
        // Safe Cleanup of uploaded original file
        fs.unlink(inputPath, (cleanupErr) => {
            if (cleanupErr && cleanupErr.code !== 'ENOENT') {
                console.error('Failed to cleanup upload file:', cleanupErr);
            }
        });
    }
});

// POST /api/decompress
app.post('/api/decompress', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file uploaded.' });
    }

    const inputPath = req.file.path;
    const originalName = req.file.originalname;

    // Validate that it's a huf file extension
    if (!originalName.endsWith('.huf')) {
        fs.unlinkSync(inputPath);
        return res.status(400).json({ success: false, error: 'Invalid file format. Only .huf files are supported for decompression.' });
    }

    const fileId = crypto.randomUUID();
    
    // Resolve output filename (remove .huf extension, or append -decompressed)
    let restoredName = originalName.slice(0, -4);
    if (!restoredName) restoredName = 'restored_file';
    
    const outputPath = path.join(DOWNLOADS_DIR, `${fileId}-${restoredName}`);

    try {
        // Run Huffman decompression
        const decompressResult = await runHuffman(['-d', inputPath, outputPath]);
        const stdout = decompressResult.stdout;

        let decompressedSize = 0;
        let timeElapsed = 0;

        const sizeMatch = stdout.match(/Output size:\s+(\d+)\s+bytes/);
        const timeMatch = stdout.match(/Time elapsed:\s+([\d.]+)\s+seconds/);

        if (sizeMatch) decompressedSize = parseInt(sizeMatch[1], 10);
        if (timeMatch) timeElapsed = parseFloat(timeMatch[1]);

        if (decompressedSize === 0 && fs.existsSync(outputPath)) {
            decompressedSize = fs.statSync(outputPath).size;
        }

        // Save download metadata
        saveMetadata(fileId, {
            filePath: outputPath,
            originalName: restoredName,
            mimeType: 'application/octet-stream'
        });

        // Add history entry
        const historyEntry = {
            id: fileId,
            fileName: originalName,
            type: 'decompress',
            originalSize: decompressedSize, // for decompression, original size is the output size
            compressedSize: req.file.size,   // compressed size is the uploaded file size
            ratio: decompressedSize > 0 ? (req.file.size / decompressedSize) : 1.0,
            savings: decompressedSize > 0 ? (1 - (req.file.size / decompressedSize)) * 100 : 0,
            time: timeElapsed,
            date: new Date().toLocaleDateString(),
            timeStr: new Date().toLocaleTimeString()
        };
        addHistoryEntry(historyEntry);

        res.json({
            success: true,
            stats: {
                fileId,
                originalName,
                restoredName,
                decompressedSize,
                compressedSize: req.file.size,
                time: timeElapsed,
                downloadUrl: `/api/download/${fileId}`
            }
        });
    } catch (err) {
        console.error('Decompression error:', err);
        res.status(500).json({ success: false, error: err.stderr || err.message || 'Decompression failed.' });
    } finally {
        // Clean up upload file
        fs.unlink(inputPath, (cleanupErr) => {
            if (cleanupErr && cleanupErr.code !== 'ENOENT') {
                console.error('Failed to cleanup upload file:', cleanupErr);
            }
        });
    }
});

// POST /api/visualize-text
// Dedicated endpoint for testing text visualization on the fly
app.post('/api/visualize-text', async (req, res) => {
    const { text } = req.body;
    if (typeof text !== 'string') {
        return res.status(400).json({ success: false, error: 'Text content must be provided.' });
    }

    const tempId = crypto.randomUUID();
    const tempFilePath = path.join(TEMP_DIR, `${tempId}.txt`);

    try {
        fs.writeFileSync(tempFilePath, text, 'utf8');

        // Run C++ program in visualization mode
        const visResult = await runHuffman(['-v', tempFilePath]);
        const visualization = JSON.parse(visResult.stdout);

        res.json({
            success: true,
            visualization
        });
    } catch (err) {
        console.error('Visualization error:', err);
        res.status(500).json({ success: false, error: err.message || 'Failed to generate visualization.' });
    } finally {
        if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }
    }
});

// GET /api/history
app.get('/api/history', (req, res) => {
    res.json({ success: true, history: getHistoryList() });
});

// GET /api/stats
app.get('/api/stats', (req, res) => {
    const list = getHistoryList();
    
    let totalCompressed = 0;
    let totalDecompressed = 0;
    let totalOriginalBytes = 0;
    let totalSavedBytes = 0;
    let sumRatio = 0;
    let countCompress = 0;

    list.forEach(entry => {
        if (entry.type === 'compress') {
            totalCompressed++;
            totalOriginalBytes += entry.originalSize;
            totalSavedBytes += Math.max(0, entry.originalSize - entry.compressedSize);
            sumRatio += entry.ratio;
            countCompress++;
        } else if (entry.type === 'decompress') {
            totalDecompressed++;
        }
    });

    const averageRatio = countCompress > 0 ? (sumRatio / countCompress) : 0.0;
    const overallSavingsPercent = totalOriginalBytes > 0 ? (totalSavedBytes / totalOriginalBytes) * 100 : 0.0;

    res.json({
        success: true,
        stats: {
            totalOperations: list.length,
            totalCompressed,
            totalDecompressed,
            totalOriginalBytes,
            totalSavedBytes,
            averageRatio,
            overallSavingsPercent
        }
    });
});

// GET /api/download/:fileId
app.get('/api/download/:fileId', (req, res) => {
    const fileId = req.params.fileId;
    
    // Prevent directory traversal by strictly checking UUID format
    if (!/^[a-f0-9-]{36}$/i.test(fileId)) {
        return res.status(400).json({ error: 'Invalid identifier format.' });
    }

    const metadata = getMetadata();
    const meta = metadata[fileId];

    if (!meta || !meta.filePath || !fs.existsSync(meta.filePath)) {
        return res.status(404).json({ error: 'File not found or has expired.' });
    }

    // Set download headers securely
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(meta.originalName)}"`);
    res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');

    const fileStream = fs.createReadStream(meta.filePath);
    fileStream.pipe(res);
});

// ----------------- HOUSEKEEPING / CLEANUP SCHEDULE -----------------
// Sweep through files and delete everything older than 15 minutes
function performHousekeeping() {
    const TIMEOUT_MS = 15 * 60 * 1000; // 15 mins
    const now = Date.now();

    [UPLOADS_DIR, DOWNLOADS_DIR, TEMP_DIR].forEach(dir => {
        fs.readdir(dir, (err, files) => {
            if (err) return;
            files.forEach(file => {
                const filePath = path.join(dir, file);
                fs.stat(filePath, (statErr, stats) => {
                    if (statErr) return;
                    if (now - stats.mtimeMs > TIMEOUT_MS) {
                        fs.unlink(filePath, unlinkErr => {
                            if (!unlinkErr) {
                                console.log(`Housekeeping: Deleted expired file ${file}`);
                            }
                        });
                    }
                });
            });
        });
    });
}

// Run housekeeping every 10 minutes
setInterval(performHousekeeping, 10 * 60 * 1000);

// Start server
app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`Server is running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
    console.log(`Huffman executable: ${HUFFMAN_EXE}`);
    console.log(`====================================================`);
});

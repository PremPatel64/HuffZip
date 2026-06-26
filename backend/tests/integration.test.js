const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const http = require('http');

const ROOT_DIR = path.join(__dirname, '..', '..');
const HUFFMAN_EXE = path.join(ROOT_DIR, 'compression', process.platform === 'win32' ? 'huffman.exe' : 'huffman');

const TEST_INPUT = path.join(__dirname, 'test-input.txt');
const TEST_COMPRESSED = path.join(__dirname, 'test-output.huf');
const TEST_RESTORED = path.join(__dirname, 'test-restored.txt');

// Ensure tests directory exists
if (!fs.existsSync(__dirname)) {
    fs.mkdirSync(__dirname, { recursive: true });
}

// 1. Create a dummy test file
const originalContent = 'BEEP BOOP BEER! HUFFMAN COMPRESSION INTEGRATION TEST MESSAGE. 1234567890.';
fs.writeFileSync(TEST_INPUT, originalContent, 'utf8');

console.log('--- STARTING HUFFMAN INTEGRATION TESTS ---');

function runStep(name, fn) {
    return new Promise((resolve) => {
        console.log(`\n[TEST STEP] Running: ${name}...`);
        fn()
            .then(() => {
                console.log(`[PASS] ${name}`);
                resolve(true);
            })
            .catch((err) => {
                console.error(`[FAIL] ${name}`);
                console.error(err);
                resolve(false);
            });
    });
}

async function main() {
    let allPassed = true;

    // Step 1: Validate C++ compression execution
    const step1 = await runStep('C++ Engine: Compression', () => {
        return new Promise((resolve, reject) => {
            execFile(HUFFMAN_EXE, ['-c', TEST_INPUT, TEST_COMPRESSED], (error, stdout, stderr) => {
                if (error) return reject(error);
                console.log('Stdout:', stdout.trim());
                if (fs.existsSync(TEST_COMPRESSED) && fs.statSync(TEST_COMPRESSED).size > 0) {
                    resolve();
                } else {
                    reject(new Error('Compressed file not created or empty.'));
                }
            });
        });
    });
    if (!step1) allPassed = false;

    // Step 2: Validate C++ decompression execution
    const step2 = await runStep('C++ Engine: Decompression', () => {
        return new Promise((resolve, reject) => {
            execFile(HUFFMAN_EXE, ['-d', TEST_COMPRESSED, TEST_RESTORED], (error, stdout, stderr) => {
                if (error) return reject(error);
                console.log('Stdout:', stdout.trim());
                if (!fs.existsSync(TEST_RESTORED)) {
                    return reject(new Error('Restored file not created.'));
                }
                const restoredContent = fs.readFileSync(TEST_RESTORED, 'utf8');
                if (restoredContent === originalContent) {
                    resolve();
                } else {
                    reject(new Error(`Content mismatch. Expected "${originalContent}" but got "${restoredContent}"`));
                }
            });
        });
    });
    if (!step2) allPassed = false;

    // Step 3: Validate C++ visualization mode
    const step3 = await runStep('C++ Engine: Visualization output JSON validation', () => {
        return new Promise((resolve, reject) => {
            execFile(HUFFMAN_EXE, ['-v', TEST_INPUT], (error, stdout, stderr) => {
                if (error) return reject(error);
                try {
                    const json = JSON.parse(stdout);
                    console.log('Parsed Frequencies count:', json.frequencies.length);
                    console.log('Parsed Codes count:', Object.keys(json.codes).length);
                    if (json.frequencies.length > 0 && json.tree) {
                        resolve();
                    } else {
                        reject(new Error('Invalid visualization JSON content structure.'));
                    }
                } catch (e) {
                    reject(new Error('Stdout is not valid JSON: ' + e.message));
                }
            });
        });
    });
    if (!step3) allPassed = false;

    // Step 4: Express API Endpoint validation
    const step4 = await runStep('Express Server API: Live server endpoint tests', () => {
        return new Promise((resolve, reject) => {
            // Start server in background
            const serverPath = path.join(ROOT_DIR, 'backend', 'server.js');
            const serverProcess = spawn('node', [serverPath], {
                env: { ...process.env, PORT: '5001', NODE_ENV: 'test' }
            });

            serverProcess.stdout.on('data', (data) => {
                const output = data.toString();
                if (output.includes('Server is running')) {
                    // Trigger tests now that server is active
                    runApiTests()
                        .then(() => {
                            serverProcess.kill();
                            resolve();
                        })
                        .catch((err) => {
                            serverProcess.kill();
                            reject(err);
                        });
                }
            });

            serverProcess.stderr.on('data', (data) => {
                console.error('Server Stderr:', data.toString().trim());
            });

            setTimeout(() => {
                serverProcess.kill();
                reject(new Error('Server took too long to start or did not reply.'));
            }, 8000);
        });
    });
    if (!step4) allPassed = false;

    // Cleanup files
    [TEST_INPUT, TEST_COMPRESSED, TEST_RESTORED].forEach(f => {
        if (fs.existsSync(f)) fs.unlinkSync(f);
    });

    console.log('\n=======================================');
    if (allPassed) {
        console.log('ALL INTEGRATION TESTS PASSED SUCCESSFULLY!');
        process.exit(0);
    } else {
        console.error('SOME INTEGRATION TESTS FAILED.');
        process.exit(1);
    }
}

// Helper: HTTP Request calls to test endpoints
function makePostRequest(options, body) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ statusCode: res.statusCode, headers: res.headers, body: JSON.parse(data) });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, headers: res.headers, rawBody: data });
                }
            });
        });
        req.on('error', (err) => reject(err));
        req.write(JSON.stringify(body));
        req.end();
    });
}

function makeGetRequest(options) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, rawBody: data });
                }
            });
        });
        req.on('error', (err) => reject(err));
        req.end();
    });
}

async function runApiTests() {
    // Test text visualization endpoint
    const visResult = await makePostRequest({
        hostname: 'localhost',
        port: 5001,
        path: '/api/visualize-text',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, { text: 'HELLO HUFFMAN' });

    if (visResult.statusCode !== 200 || !visResult.body.success) {
        throw new Error(`Text visualization failed with status ${visResult.statusCode}`);
    }
    console.log('   [API SUBTEST] POST /api/visualize-text: PASS');

    // Test stats endpoint
    const statsResult = await makeGetRequest({
        hostname: 'localhost',
        port: 5001,
        path: '/api/stats',
        method: 'GET'
    });
    if (statsResult.statusCode !== 200 || !statsResult.body.success) {
        throw new Error(`GET /api/stats failed with status ${statsResult.statusCode}`);
    }
    console.log('   [API SUBTEST] GET /api/stats: PASS');

    // Test history endpoint
    const historyResult = await makeGetRequest({
        hostname: 'localhost',
        port: 5001,
        path: '/api/history',
        method: 'GET'
    });
    if (historyResult.statusCode !== 200 || !historyResult.body.success) {
        throw new Error(`GET /api/history failed with status ${historyResult.statusCode}`);
    }
    console.log('   [API SUBTEST] GET /api/history: PASS');
}

main();

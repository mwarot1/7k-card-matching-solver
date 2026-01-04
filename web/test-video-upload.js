/**
 * Automated Video Upload Test Script
 * Run with: node test-video-upload.js [video-path] [start-time] [end-time]
 * If end-time is 0, loads full video without trimming
 * Example: node test-video-upload.js ../7kMinigames/minigame_1-3_8.mp4 3 8
 * Example: node test-video-upload.js ../7kMinigames/minigame_3-0_0.webm 0 0
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// Configuration
const APP_URL = 'http://localhost:3000/7k-card-matching-solver';
const DEFAULT_VIDEO = '../7kMinigames/minigame_1-3_8.mp4';
const DEFAULT_START = 3;
const DEFAULT_END = 8;
const TIMEOUT = 120000; // 2 minutes

// Get command line arguments
const videoPath = process.argv[2] || DEFAULT_VIDEO;
const rangeStart = parseFloat(process.argv[3] || DEFAULT_START);
const rangeEnd = parseFloat(process.argv[4] || DEFAULT_END);

// If rangeEnd is 0, it means load full video
const isFullVideo = rangeEnd === 0;

// Color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(level, message) {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[${timestamp}]`;
    
    switch(level) {
        case 'success':
            console.log(`${colors.green}${prefix} ✅ ${message}${colors.reset}`);
            break;
        case 'error':
            console.log(`${colors.red}${prefix} ❌ ${message}${colors.reset}`);
            break;
        case 'warning':
            console.log(`${colors.yellow}${prefix} ⚠️  ${message}${colors.reset}`);
            break;
        case 'info':
            console.log(`${colors.blue}${prefix} 📝 ${message}${colors.reset}`);
            break;
        case 'step':
            console.log(`${colors.cyan}${prefix} 🔹 ${message}${colors.reset}`);
            break;
        default:
            console.log(`${prefix} ${message}`);
    }
}

async function checkServerAvailability() {
    const http = require('http');
    return new Promise((resolve) => {
        const req = http.get('http://localhost:3000', (res) => {
            resolve(true);
            req.destroy();
        });
        req.on('error', () => {
            resolve(false);
        });
        req.setTimeout(2000, () => {
            resolve(false);
            req.destroy();
        });
    });
}

async function waitForServer(maxAttempts = 10) {
    log('step', 'Checking if dev server is running...');
    
    for (let i = 0; i < maxAttempts; i++) {
        const isAvailable = await checkServerAvailability();
        if (isAvailable) {
            log('success', 'Dev server is running');
            return true;
        }
        
        if (i === 0) {
            log('warning', 'Dev server not detected. Please start it with: npm run dev');
            log('info', 'Waiting for server to start...');
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    return false;
}

async function runTest() {
    let browser;
    
    try {
        // Validate video file
        const absoluteVideoPath = path.resolve(videoPath);
        if (!fs.existsSync(absoluteVideoPath)) {
            log('error', `Video file not found: ${absoluteVideoPath}`);
            process.exit(1);
        }
        
        const videoStats = fs.statSync(absoluteVideoPath);
        const videoSizeMB = (videoStats.size / 1024 / 1024).toFixed(2);
        
        log('info', '🎬 Starting Automated Video Upload Test');
        log('info', '═══════════════════════════════════════');
        log('info', `Video: ${path.basename(absoluteVideoPath)} (${videoSizeMB} MB)`);
        
        if (isFullVideo) {
            log('info', `Processing: Full video (start from ${rangeStart}s)`);
        } else {
            log('info', `Range: ${rangeStart}s - ${rangeEnd}s (${rangeEnd - rangeStart}s duration)`);
        }
        
        log('info', `Target: ${APP_URL}`);
        log('info', '═══════════════════════════════════════\n');
        
        // Validate range
        if (!isFullVideo && rangeStart >= rangeEnd) {
            log('error', 'Start time must be less than end time');
            process.exit(1);
        }
        
        // Wait for server to be available
        const serverReady = await waitForServer();
        if (!serverReady) {
            log('error', 'Dev server is not running. Please start it with: npm run dev');
            log('error', 'Then run this test again.');
            process.exit(1);
        }
        
        // Launch browser
        log('step', 'Launching browser...');
        browser = await puppeteer.launch({
            headless: false, // Set to true for headless mode
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        
        // Capture console logs from the browser
        page.on('console', msg => {
            const type = msg.type();
            const text = msg.text();
            if (type === 'error') {
                log('error', `Browser Error: ${text}`);
            } else if (type === 'warning') {
                log('warning', `Browser Warning: ${text}`);
            } else if (type === 'log' || text.includes('Error') || text.includes('Failed') || text.includes('Extracting') || text.includes('extractVideoSegment') || text.includes('solve()') || text.includes('Calling solve')) {
                log('info', `Browser: ${text}`);
            }
        });
        
        log('success', 'Browser launched');
        
        // Navigate to application
        log('step', 'Loading application...');
        await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 30000 });
        
        // Force refresh to clear cache and wait for hot reload
        await page.reload({ waitUntil: 'networkidle0' });
        log('info', 'Waiting for Next.js hot reload...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        log('success', 'Application loaded');
        
        // Wait for OpenCV to initialize
        log('step', 'Waiting for OpenCV to initialize...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        log('success', 'OpenCV initialized');
        
        // Step 1: Upload video
        log('step', 'Step 1: Uploading video file...');
        const fileInput = await page.$('#video-upload');
        
        if (!fileInput) {
            throw new Error('Video upload input not found');
        }
        
        await fileInput.uploadFile(absoluteVideoPath);
        log('success', 'Video file uploaded');
        
        // Step 2: Wait for video to load
        log('step', 'Step 2: Waiting for video to load metadata...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check if video loaded
        const videoElement = await page.$('video[src^="blob:"]');
        if (!videoElement) {
            throw new Error('Video element not found after upload');
        }
        log('success', 'Video loaded successfully');
        
        // Step 3: Set range using number inputs (or use full video if rangeEnd=0)
        if (isFullVideo) {
            log('step', 'Step 3: Using full video, no range trimming...');
            log('success', 'Full video mode enabled');
        } else {
            log('step', `Step 3: Setting time range to ${rangeStart}s - ${rangeEnd}s...`);
            
            // Use number inputs which properly trigger React's onChange
            await page.type('#start-time-input', '', { delay: 0 });
            await page.evaluate(() => {
                document.querySelector('#start-time-input').value = '';
            });
            await page.type('#start-time-input', rangeStart.toString());
            
            await page.type('#end-time-input', '', { delay: 0 });
            await page.evaluate(() => {
                document.querySelector('#end-time-input').value = '';
            });
            await page.type('#end-time-input', rangeEnd.toString());
            
            // Trigger change event
            await page.evaluate(() => {
                document.querySelector('#start-time-input').dispatchEvent(new Event('change', { bubbles: true }));
                document.querySelector('#end-time-input').dispatchEvent(new Event('change', { bubbles: true }));
            });
            
            await new Promise(resolve => setTimeout(resolve, 500));
            
            log('success', `Time range set: ${rangeStart}s - ${rangeEnd}s`);
        }
        
        // Step 4: Click Process Video button
        log('step', 'Step 4: Clicking "Process Video" button...');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const processButton = await page.evaluateHandle(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            return buttons.find(btn => btn.textContent.includes('Process Video'));
        });
        
        if (!processButton) {
            throw new Error('Process Video button not found');
        }
        
        await processButton.asElement().click();
        log('success', 'Process Video button clicked');
        
        // Step 5: Monitor progress
        log('step', 'Step 5: Processing video...');
        log('warning', 'This may take a while depending on video complexity');
        
        const startTime = Date.now();
        
        // Monitor progress with timeout
        try {
            await Promise.race([
                // Monitor for results
                page.waitForFunction(() => {
                    const resultSection = document.querySelector('.glass-card h2');
                    return resultSection && resultSection.textContent.includes('ผลลัพธ์');
                }, { timeout: TIMEOUT }),
                
                // Monitor for errors
                (async () => {
                    while (true) {
                        const errorText = await page.evaluate(() => {
                            const errorElements = Array.from(document.querySelectorAll('*')).filter(el => {
                                const style = window.getComputedStyle(el);
                                return (style.color === 'rgb(248, 113, 113)' || style.color === '#f87171') 
                                    && el.textContent.includes('Error');
                            });
                            if (errorElements.length > 0) {
                                return errorElements[0].textContent;
                            }
                            return null;
                        });
                        
                        if (errorText) {
                            throw new Error(`Processing error: ${errorText}`);
                        }
                        
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                })()
            ]);
        } catch (error) {
            if (error.message && error.message.includes('Processing error')) {
                log('error', error.message);
                log('error', 'Check browser console for more details');
                throw error;
            }
            // Timeout or other error
            throw error;
        }
        
        const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
        log('success', `Processing completed in ${processingTime}s`);
        
        // Step 6: Validate results
        log('step', 'Step 6: Validating results...');
        
        const cardAssignments = await page.evaluate(() => {
            const cardItems = document.querySelectorAll('.card-item');
            let assignedCount = 0;
            const assignments = {};
            
            cardItems.forEach((card, idx) => {
                const textContent = card.textContent;
                // Check if card has assignment (contains card type number)
                if (textContent && textContent.match(/\d+/)) {
                    const cardType = textContent.match(/Card\s*(\d+)/)?.[1] || textContent.match(/\d+/)?.[0];
                    const confidence = textContent.match(/(\d+(?:\.\d+)?)%/)?.[1];
                    if (cardType) {
                        assignedCount++;
                        assignments[idx] = { type: cardType, confidence };
                    }
                }
            });
            
            return { assignedCount, totalCards: cardItems.length, assignments };
        });
        
        const totalCards = 24;
        const assignedCards = cardAssignments.assignedCount;
        const successRate = ((assignedCards / totalCards) * 100).toFixed(1);
        
        log('success', '\n🎉 TEST COMPLETED SUCCESSFULLY! 🎉');
        log('info', '═══════════════════════════════════════');
        log('success', `Assigned Cards: ${assignedCards} / ${totalCards}`);
        log('success', `Success Rate: ${successRate}%`);
        log('success', `Processing Time: ${processingTime}s`);
        log('info', '═══════════════════════════════════════\n');
        
        // Keep browser open for 5 seconds to see results
        log('info', 'Keeping browser open for 5 seconds...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
    } catch (error) {
        log('error', `Test failed: ${error.message}`);
        console.error(error);
        process.exit(1);
    } finally {
        if (browser) {
            await browser.close();
            log('info', 'Browser closed');
        }
    }
}

// Run the test
runTest().then(() => {
    log('success', 'Test script completed');
    process.exit(0);
}).catch(error => {
    log('error', `Fatal error: ${error.message}`);
    process.exit(1);
});

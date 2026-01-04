#!/usr/bin/env node

/**
 * Batch Test Runner for Minigame Videos
 * Discovers minigame_{X}-{S}_{E}.(mp4|webm|mov|mkv|avi|flv) files and runs tests on each
 * If E=0, loads full video without trimming
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MINIGAMES_DIR = path.join(__dirname, '../7kMinigames');
const SUPPORTED_FORMATS = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.flv'];

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function parseMinigameFilename(filename) {
  // Match pattern: minigame_{X}-{S}_{E}.(mp4|webm|mov|mkv|avi|flv)
  // E=0 means full video, no need to trim
  const match = filename.match(/minigame_(\d+)-(\d+(?:\.\d+)?)_(\d+(?:\.\d+)?)\.(mp4|webm|mov|mkv|avi|flv)$/);
  if (match) {
    return {
      filename,
      testNumber: parseInt(match[1]),
      startTime: parseFloat(match[2]),
      endTime: parseFloat(match[3]),
      isFullVideo: parseFloat(match[3]) === 0
    };
  }
  return null;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  log('\n🎬 BATCH TEST RUNNER FOR MINIGAME VIDEOS', 'cyan');
  log('═'.repeat(60), 'cyan');

  // Check if minigames directory exists
  if (!fs.existsSync(MINIGAMES_DIR)) {
    log(`✗ Minigames directory not found: ${MINIGAMES_DIR}`, 'red');
    process.exit(1);
  }

  // Discover minigame files (all supported formats)
  const files = fs.readdirSync(MINIGAMES_DIR).filter(f => {
    const ext = path.extname(f);
    return SUPPORTED_FORMATS.includes(ext);
  });
  const minigames = files
    .map(f => parseMinigameFilename(f))
    .filter(m => m !== null)
    .sort((a, b) => a.testNumber !== b.testNumber ? a.testNumber - b.testNumber : a.startTime - b.startTime);

  if (minigames.length === 0) {
    log(`✗ No minigame files matching pattern minigame_*-*_*.(mp4|webm|mov|mkv|avi|flv) found in ${MINIGAMES_DIR}`, 'red');
    process.exit(1);
  }

  log(`\n📋 Found ${minigames.length} test video(s):`, 'blue');
  minigames.forEach((m, idx) => {
    const rangeStr = m.isFullVideo ? 'full video' : `range: ${m.startTime}s - ${m.endTime}s`;
    log(`  ${idx + 1}. ${m.filename} (${rangeStr})`, 'yellow');
  });

  // Summary stats
  const results = [];
  const startTime = Date.now();

  log(`\n▶️  Starting batch execution...`, 'cyan');
  log('═'.repeat(60), 'cyan');

  // Run tests sequentially
  for (let i = 0; i < minigames.length; i++) {
    const minigame = minigames[i];
    const testNum = i + 1;
    // Compute relative path from web directory to video file
    const fullVideoPath = path.join(MINIGAMES_DIR, minigame.filename);
    const videoPath = path.relative(__dirname, fullVideoPath);

    log(`\n[${testNum}/${minigames.length}] Running: ${minigame.filename}`, 'magenta');
    const rangeStr = minigame.isFullVideo ? 'Full video' : `Range: ${minigame.startTime}s - ${minigame.endTime}s`;
    log(rangeStr, 'yellow');
    log('─'.repeat(60), 'yellow');

    const testStartTime = Date.now();
    
    try {
      // Run the test
      // If isFullVideo, pass endTime=0 to indicate full video processing
      const endTimeArg = minigame.isFullVideo ? 0 : minigame.endTime;
      const command = `node test-video-upload.js ${videoPath} ${minigame.startTime} ${endTimeArg}`;
      execSync(command, { 
        stdio: 'inherit',
        cwd: __dirname
      });

      const duration = ((Date.now() - testStartTime) / 1000).toFixed(1);
      log(`✅ Test completed in ${duration}s`, 'green');
      
      results.push({
        testNumber: minigame.testNumber,
        filename: minigame.filename,
        status: '✅ PASS',
        duration: parseFloat(duration)
      });

      // Wait between tests
      if (i < minigames.length - 1) {
        log('\n⏳ Waiting 3 seconds before next test...', 'cyan');
        await sleep(3000);
      }
    } catch (err) {
      const duration = ((Date.now() - testStartTime) / 1000).toFixed(1);
      log(`❌ Test failed after ${duration}s`, 'red');
      
      results.push({
        testNumber: minigame.testNumber,
        filename: minigame.filename,
        status: '❌ FAIL',
        duration: parseFloat(duration)
      });
    }
  }

  // Print summary
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  
  log('\n' + '═'.repeat(60), 'cyan');
  log('📊 TEST SUMMARY', 'cyan');
  log('═'.repeat(60), 'cyan');
  
  results.forEach(r => {
    const statusColor = r.status.includes('✅') ? 'green' : 'red';
    log(`  ${r.status} | Test ${r.testNumber}: ${r.filename} (${r.duration}s)`, statusColor);
  });

  const passCount = results.filter(r => r.status.includes('✅')).length;
  const failCount = results.filter(r => r.status.includes('❌')).length;
  const successRate = ((passCount / results.length) * 100).toFixed(1);

  log('\n' + '─'.repeat(60), 'cyan');
  log(`Total Tests: ${results.length}`, 'blue');
  log(`✅ Passed: ${passCount}`, 'green');
  log(`❌ Failed: ${failCount}`, failCount > 0 ? 'red' : 'green');
  log(`Success Rate: ${successRate}%`, successRate === '100.0' ? 'green' : 'yellow');
  log(`Total Duration: ${totalDuration}s`, 'blue');
  log('═'.repeat(60), 'cyan');

  process.exit(failCount > 0 ? 1 : 0);
}

// Run the batch tests
runTests().catch(err => {
  log(`\n❌ Fatal error: ${err.message}`, 'red');
  process.exit(1);
});

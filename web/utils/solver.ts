/**
 * CardSolver Client-Side Implementation (V3.1)
 * Ports the logic from solver.py to TypeScript using OpenCV.js.
 */

export interface Point {
    x: number;
    y: number;
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface SolveResult {
    pairs_count: number;
    pairs: [number, number][];
    grid_faces: Record<string, string | null>;
    status: string;
    cards_detected?: number;
    step_history?: Array<{step: string, duration: number}>;
}

export type ProgressCallback = (current: number, total: number, stage: string, stepHistory?: Array<{step: string, duration: number}>) => void;

declare global {
    interface Window {
        cv: any;
    }
}

export class ClientSideSolver {
    private cv: any;
    private backCardTemplate: any = null;
    private locations: Point[][] = [];
    private cardFaces: Map<number, any> = new Map();
    private progressCallback?: ProgressCallback;
    private stepHistory: Array<{step: string, duration: number}> = [];
    private currentStepStart: number = 0;

    constructor(progressCallback?: ProgressCallback) {
        this.cv = typeof window !== 'undefined' ? window.cv : null;
        this.progressCallback = progressCallback;
    }

    /**
     * Loads the back card template from a URL.
     */
    async init(templateUrl: string) {
        if (!this.cv) {
            throw new Error("OpenCV.js not loaded.");
        }

        const img = await this.loadImage(templateUrl);
        const mat = this.cv.imread(img);
        this.backCardTemplate = new this.cv.Mat();
        this.cv.cvtColor(mat, this.backCardTemplate, this.cv.COLOR_RGBA2GRAY);
        mat.delete();
        console.log("ClientSideSolver: Template loaded successfully.");
    }

    private async loadImage(url: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
            img.src = url;
        });
    }

    /**
     * Non-Maximum Suppression (Simplified for browser)
     */
    private nms(detections: any[], overlapThresh: number = 0.25): any[] {
        if (detections.length === 0) return [];

        // Sort by score descending
        detections.sort((a, b) => b.score - a.score);

        const pick: any[] = [];
        const suppressed = new Set<number>();

        for (let i = 0; i < detections.length; i++) {
            if (suppressed.has(i)) continue;
            const best = detections[i];
            pick.push(best);

            for (let j = i + 1; j < detections.length; j++) {
                if (suppressed.has(j)) continue;
                const current = detections[j];

                const x1 = Math.max(best.x, current.x);
                const y1 = Math.max(best.y, current.y);
                const x2 = Math.min(best.x + best.width, current.x + current.width);
                const y2 = Math.min(best.y + best.height, current.y + current.height);

                const w_overlap = Math.max(0, x2 - x1);
                const h_overlap = Math.max(0, y2 - y1);
                const overlap = (w_overlap * h_overlap) / (best.width * best.height);

                if (overlap > overlapThresh) {
                    suppressed.add(j);
                }
            }
        }
        return pick;
    }

    /**
     * Extracts frames from a video Blob at a specific interval.
     */
    private async extractFramesFromBlob(videoBlob: Blob, fps: number = 10): Promise<{ ts: number, mat: any }[]> {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.src = URL.createObjectURL(videoBlob);
            video.muted = true;
            video.playsInline = true;
            
            const frames: { ts: number, mat: any }[] = [];
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            video.onloadedmetadata = async () => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const duration = Math.min(video.duration, 30); // Extended to 30 seconds
                const interval = 1 / fps;

                try {
                    for (let ts = 0; ts < duration; ts += interval) {
                        video.currentTime = ts;
                        await new Promise(r => {
                            video.onseeked = r;
                        });
                        if (ctx) {
                            ctx.drawImage(video, 0, 0);
                            const mat = this.cv.imread(canvas);
                            frames.push({ ts, mat });
                        }
                    }
                    URL.revokeObjectURL(video.src);
                    resolve(frames);
                } catch (err) {
                    URL.revokeObjectURL(video.src);
                    reject(err);
                }
            };

            video.onerror = (e) => {
                URL.revokeObjectURL(video.src);
                reject(e);
            };
        });
    }

    /**
     * Detects 24 card locations using multi-scale template matching.
     */
    async detectCardLocations(frames: { ts: number, mat: any }[]): Promise<Rect[]> {
        if (!this.backCardTemplate) throw new Error("Template not loaded");

        let bestDetections: any[] = [];
        const gray = new this.cv.Mat();
        const templateGray = this.backCardTemplate;

        // Start with quick scan (every 4th frame, max 50 frames)
        // If 24 cards not found, extend to scan all frames
        const quickScanLimit = Math.min(frames.length, 50);
        let frameStep = 4;
        let framesToScan = quickScanLimit;
        
        // Quick scan first
        for (let i = 0; i < quickScanLimit; i += frameStep) {
            const frameNum = Math.floor(i / frameStep) + 1;
            const totalFrames = Math.floor(quickScanLimit / frameStep);
            if (this.progressCallback) {
                this.progressCallback(frameNum, totalFrames, 'Detecting cards', this.stepHistory);
                // Yield to allow UI update
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            
            const frame = frames[i].mat;
            this.cv.cvtColor(frame, gray, this.cv.COLOR_RGBA2GRAY);

            // Reduced scale range (0.3-1.5) and fewer steps (20 instead of 30) for speed
            let frameDetections: any[] = [];
            
            for (let scale = 0.3; scale <= 1.5; scale += 0.06) {
                const tw = Math.round(templateGray.cols * scale);
                const th = Math.round(templateGray.rows * scale);
                if (tw < 10 || th < 10) continue;

                const resizedTemplate = new this.cv.Mat();
                this.cv.resize(templateGray, resizedTemplate, new this.cv.Size(tw, th));

                const res = new this.cv.Mat();
                this.cv.matchTemplate(gray, resizedTemplate, res, this.cv.TM_CCOEFF_NORMED);

                const threshold = 0.45;
                const detections: any[] = [];
                
                const data = res.data32F;
                for (let r = 0; r < res.rows; r++) {
                    for (let c = 0; c < res.cols; c++) {
                        const score = data[r * res.cols + c];
                        if (score >= threshold) {
                            detections.push({ x: c, y: r, width: tw, height: th, score });
                        }
                    }
                }

                const uniqueDetections = this.nms(detections, 0.25);
                
                if (uniqueDetections.length > frameDetections.length) {
                    frameDetections = uniqueDetections;
                }

                if (uniqueDetections.length === 24) {
                    resizedTemplate.delete();
                    res.delete();
                    gray.delete();
                    return uniqueDetections;
                }

                resizedTemplate.delete();
                res.delete();
            }
            
            if (frameDetections.length > bestDetections.length) {
                bestDetections = frameDetections;
            }
        }

        // If we didn't find 24 cards in quick scan, do a thorough scan of all frames
        if (bestDetections.length < 24 && frames.length > quickScanLimit) {
            console.log(`⚠️ Quick scan found only ${bestDetections.length} cards. Extending to full video scan...`);
            
            // Send progress update before starting extended scan
            if (this.progressCallback) {
                this.progressCallback(0, Math.floor((frames.length - quickScanLimit) / 2), 'Extended scan', this.stepHistory);
            }
            
            for (let i = quickScanLimit; i < frames.length; i += 2) {
                const frameNum = Math.floor((i - quickScanLimit) / 2) + 1;
                const totalFrames = Math.ceil((frames.length - quickScanLimit) / 2);
                if (this.progressCallback) {
                    this.progressCallback(Math.min(frameNum, totalFrames), totalFrames, 'Extended scan', this.stepHistory);
                    // Yield to allow UI update
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
                
                const frame = frames[i].mat;
                this.cv.cvtColor(frame, gray, this.cv.COLOR_RGBA2GRAY);

                let frameDetections: any[] = [];
                
                for (let scale = 0.3; scale <= 1.5; scale += 0.06) {
                    const tw = Math.round(templateGray.cols * scale);
                    const th = Math.round(templateGray.rows * scale);
                    if (tw < 10 || th < 10) continue;

                    const resizedTemplate = new this.cv.Mat();
                    this.cv.resize(templateGray, resizedTemplate, new this.cv.Size(tw, th));

                    const res = new this.cv.Mat();
                    this.cv.matchTemplate(gray, resizedTemplate, res, this.cv.TM_CCOEFF_NORMED);

                    const threshold = 0.45;
                    const detections: any[] = [];
                    
                    const data = res.data32F;
                    for (let r = 0; r < res.rows; r++) {
                        for (let c = 0; c < res.cols; c++) {
                            const score = data[r * res.cols + c];
                            if (score >= threshold) {
                                detections.push({ x: c, y: r, width: tw, height: th, score });
                            }
                        }
                    }

                    const uniqueDetections = this.nms(detections, 0.25);
                    
                    if (uniqueDetections.length > frameDetections.length) {
                        frameDetections = uniqueDetections;
                    }

                    if (uniqueDetections.length === 24) {
                        console.log(`✅ Found 24 cards at frame ${i} during extended scan`);
                        resizedTemplate.delete();
                        res.delete();
                        gray.delete();
                        return uniqueDetections;
                    }

                    resizedTemplate.delete();
                    res.delete();
                }
                
                if (frameDetections.length > bestDetections.length) {
                    bestDetections = frameDetections;
                }
            }
        }

        gray.delete();
        console.log(`Detection complete: found ${bestDetections.length} cards`);
        return bestDetections;
    }

    /**
     * Main solve method.
     */
    async solve(videoBlob: Blob): Promise<SolveResult> {
        if (!this.cv) throw new Error("OpenCV.js not initialized");
        
        this.stepHistory = [];
        
        // 1. Extract frames
        this.currentStepStart = Date.now();
        const frames = await this.extractFramesFromBlob(videoBlob, 10);
        this.stepHistory.push({step: 'Extract frames', duration: Date.now() - this.currentStepStart});

        // 2. Detect card locations
        this.currentStepStart = Date.now();
        const rects = await this.detectCardLocations(frames);
        this.stepHistory.push({step: 'Detect cards', duration: Date.now() - this.currentStepStart});
        const cardsDetected = rects.length;
        
        if (rects.length === 0) {
            frames.forEach(f => f.mat.delete());
            return { pairs_count: 0, pairs: [], grid_faces: {}, status: "No cards detected", cards_detected: 0 };
        }

        // Sort rects: top-to-bottom, then left-to-right
        const avgH = rects.reduce((sum, r) => sum + r.height, 0) / rects.length;
        const binSize = avgH * 0.5;
        rects.sort((a, b) => {
            const rowA = Math.floor(a.y / binSize);
            const rowB = Math.floor(b.y / binSize);
            if (rowA !== rowB) return rowA - rowB;
            return a.x - b.x;
        });

        console.log(`Detected and sorted ${rects.length} card locations.`);

        // 3. Find baseline (frames where cards are face down)
        this.currentStepStart = Date.now();
        let baselineIdx = -1;
        let stableCount = 0;
        const gray = new this.cv.Mat();
        
        for (let i = 0; i < frames.length; i++) {
            if (this.progressCallback && i % 5 === 0) {
                this.progressCallback(Math.min(i + 1, frames.length), frames.length, 'Finding baseline', this.stepHistory);
                // Yield to allow UI update
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            this.cv.cvtColor(frames[i].mat, gray, this.cv.COLOR_RGBA2GRAY);
            let backCount = 0;
            
            for (const rect of rects) {
                try {
                    const roi = gray.roi(new this.cv.Rect(rect.x, rect.y, rect.width, rect.height));
                    const resizedTemplate = new this.cv.Mat();
                    this.cv.resize(this.backCardTemplate, resizedTemplate, new this.cv.Size(rect.width, rect.height));
                    
                    const res = new this.cv.Mat();
                    this.cv.matchTemplate(roi, resizedTemplate, res, this.cv.TM_CCOEFF_NORMED);
                    const score = res.data32F[0];
                    
                    if (score > 0.6) backCount++;
                    
                    roi.delete();
                    resizedTemplate.delete();
                    res.delete();
                } catch (e) {
                    console.warn('ROI error during baseline detection:', e);
                }
            }

            if (backCount >= 22) {
                if (baselineIdx === -1) baselineIdx = i;
                stableCount++;
            } else {
                if (baselineIdx !== -1 && stableCount >= 3) {
                    // Found stable sequence, use middle of sequence
                    baselineIdx = Math.floor((baselineIdx + (i - 1)) / 2);
                    break;
                }
                baselineIdx = -1;
                stableCount = 0;
            }
        }
        
        if (baselineIdx < 0) baselineIdx = 0;
        this.stepHistory.push({step: 'Find baseline', duration: Date.now() - this.currentStepStart});

        // 4. Extract faces
        this.currentStepStart = Date.now();
        const cardFaces = new Map<number, any>();
        const maxDiffs = new Array(rects.length).fill(0);
        
        const baselineFrameGray = new this.cv.Mat();
        this.cv.cvtColor(frames[baselineIdx].mat, baselineFrameGray, this.cv.COLOR_RGBA2GRAY);
        
        const perCardBaselines: any[] = [];
        for (const rect of rects) {
            try {
                const baseline = baselineFrameGray.roi(new this.cv.Rect(rect.x, rect.y, rect.width, rect.height));
                perCardBaselines.push(baseline.clone());
                baseline.delete();
            } catch (e) {
                console.warn('Error creating baseline ROI:', e);
                perCardBaselines.push(null);
            }
        }

        for (let i = baselineIdx; i < frames.length; i++) {
            if (this.progressCallback && (i - baselineIdx) % 5 === 0) {
                const maxFrames = frames.length - baselineIdx;
                this.progressCallback(Math.min(i - baselineIdx + 1, maxFrames), maxFrames, 'Extracting faces', this.stepHistory);
                // Yield to allow UI update
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            
            this.cv.cvtColor(frames[i].mat, gray, this.cv.COLOR_RGBA2GRAY);
            
            for (let j = 0; j < rects.length; j++) {
                const rect = rects[j];
                const baselineRoi = perCardBaselines[j];
                if (!baselineRoi) continue;
                
                try {
                    const roi = gray.roi(new this.cv.Rect(rect.x, rect.y, rect.width, rect.height));
                    
                    const diff = new this.cv.Mat();
                    this.cv.absdiff(roi, baselineRoi, diff);
                    const meanDiff = this.cv.mean(diff)[0];
                    
                    // Extract frames with difference from baseline (face revealed)
                    const meanVal = this.cv.mean(roi)[0];
                    
                    // Look for any difference (>5) and reasonable brightness (>40, <200)
                    if (meanDiff > 5 && meanVal > 40 && meanVal < 200 && meanDiff > maxDiffs[j]) {
                        maxDiffs[j] = meanDiff;
                        if (cardFaces.has(j)) cardFaces.get(j).delete();
                        const faceRoi = frames[i].mat.roi(new this.cv.Rect(rect.x, rect.y, rect.width, rect.height));
                        cardFaces.set(j, faceRoi.clone());
                        faceRoi.delete();
                    }
                    
                    roi.delete();
                    diff.delete();
                } catch (e) {
                    console.warn(`Error processing face ${j}:`, e);
                }
            }
        }

        perCardBaselines.forEach(b => { if (b) b.delete(); });
        baselineFrameGray.delete();
        gray.delete();
        this.stepHistory.push({step: 'Extract faces', duration: Date.now() - this.currentStepStart});

        console.log(`Extracted ${cardFaces.size} card faces.`);
        console.log('📦 Extracted face indices:', Array.from(cardFaces.keys()).sort((a, b) => a - b));
        console.log('📊 Max diff values:', maxDiffs.map((v, i) => `[${i}]: ${v.toFixed(2)}`).join(', '));

        // 5. Find pairs
        this.currentStepStart = Date.now();
        const pairs = this.findPairs(cardFaces);
        this.stepHistory.push({step: 'Match pairs', duration: Date.now() - this.currentStepStart});
        
        // Convert faces to base64 for display
        const grid_faces: Record<string, string | null> = {};
        const canvas = document.createElement('canvas');
        for (let i = 0; i < rects.length; i++) {
            const face = cardFaces.get(i);
            if (face) {
                try {
                    canvas.width = face.cols;
                    canvas.height = face.rows;
                    this.cv.imshow(canvas, face);
                    grid_faces[i.toString()] = canvas.toDataURL();
                } catch (e) {
                    console.warn(`Error converting face ${i} to base64:`, e);
                    grid_faces[i.toString()] = null;
                }
            } else {
                grid_faces[i.toString()] = null;
            }
        }

        // Cleanup
        frames.forEach(f => f.mat.delete());
        cardFaces.forEach(f => f.delete());

        return {
            pairs_count: pairs.length,
            pairs: pairs as [number, number][],
            grid_faces,
            status: pairs.length === 12 ? "Solved" : `Found ${pairs.length} pairs`,
            cards_detected: cardsDetected,
            step_history: this.stepHistory
        };
    }

    private findPairs(cardFaces: Map<number, any>): [number, number][] {
        const indices = Array.from(cardFaces.keys()).sort((a, b) => a - b);
        const processedFaces = new Map<number, any>();
        
        for (const idx of indices) {
            const face = cardFaces.get(idx);
            const gray = new this.cv.Mat();
            this.cv.cvtColor(face, gray, this.cv.COLOR_RGBA2GRAY);
            const resized = new this.cv.Mat();
            this.cv.resize(gray, resized, new this.cv.Size(64, 64));
            // Equalize hist for better matching
            this.cv.equalizeHist(resized, resized);
            processedFaces.set(idx, resized);
            gray.delete();
        }

        const scores: { score: number, i: number, j: number }[] = [];
        for (let i = 0; i < indices.length; i++) {
            for (let j = i + 1; j < indices.length; j++) {
                const idx1 = indices[i];
                const idx2 = indices[j];
                const face1 = processedFaces.get(idx1);
                const face2 = processedFaces.get(idx2);
                
                const res = new this.cv.Mat();
                this.cv.matchTemplate(face1, face2, res, this.cv.TM_CCOEFF_NORMED);
                const score = res.data32F[0];
                scores.push({ score, i: idx1, j: idx2 });
                res.delete();
            }
        }

        scores.sort((a, b) => b.score - a.score);
        
        console.log('\n🔍 All Pair Scores (Top 30):');
        scores.slice(0, 30).forEach(({ score, i, j }, idx) => {
            console.log(`  ${idx + 1}. (${i}, ${j}): ${score.toFixed(4)} ${score > 0.4 ? '✅' : '❌'}`);
        });
        
        const pairs: [number, number][] = [];
        const matched = new Set<number>();
        
        console.log(`\n🎯 DEBUG: Starting greedy selection with ${indices.length} indices.`);
        for (const { score, i, j } of scores) {
            if (matched.has(i) || matched.has(j)) {
                if (score > 0.4) {
                    console.log(`  ⏭️  Skipped (${i}, ${j}): ${score.toFixed(4)} - already matched`);
                }
                continue;
            }
            if (score > 0.4) {
                pairs.push([i, j]);
                matched.add(i);
                matched.add(j);
                console.log(`  ✅ Matched (${i}, ${j}) with score ${score.toFixed(4)}. Total pairs: ${pairs.length}`);
            } else {
                console.log(`  ❌ Rejected (${i}, ${j}): ${score.toFixed(4)} - below threshold`);
            }
            if (pairs.length === 12) {
                console.log('\n✨ DEBUG: Found all 12 pairs.');
                break;
            }
        }
        
        if (pairs.length < 12) {
            const unmatched = indices.filter(idx => !matched.has(idx));
            console.log(`Warning: Only found ${pairs.length} pairs. Unmatched: ${unmatched}`);
            console.log(`DEBUG: Matched indices: ${Array.from(matched).sort((a, b) => a - b)}`);
        }

        processedFaces.forEach(f => f.delete());
        return pairs;
    }

    /**
     * Cleanup OpenCV mats.
     */
    dispose() {
        if (this.backCardTemplate) this.backCardTemplate.delete();
        this.cardFaces.forEach(mat => mat.delete());
        this.cardFaces.clear();
    }
}

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
    card_assignments: Record<number, {cardType: number, confidence: number} | null>;
    grid_faces: Record<string, string | null>;
    status: string;
    cards_detected?: number;
    step_history?: Array<{step: string, duration: number}>;
    baseline_frame_idx?: number;
    baseline_frame_ts?: number;
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
    private referenceTemplates: Map<number, any> = new Map();
    private locations: Point[][] = [];
    private cardFaces: Map<number, any> = new Map();
    private progressCallback?: ProgressCallback;
    private stepHistory: Array<{step: string, duration: number}> = [];
    private currentStepStart: number = 0;
    private baselineFrameIdx: number = -1;
    private baselineFrameTs: number = -1;

    constructor(progressCallback?: ProgressCallback) {
        this.cv = typeof window !== 'undefined' ? window.cv : null;
        this.progressCallback = progressCallback;
    }

    /**
     * Loads the back card template and reference face templates from URLs.
     */
    async init(templateUrl: string) {
        if (!this.cv) {
            throw new Error("OpenCV.js not loaded.");
        }

        // Load back card template
        const img = await this.loadImage(templateUrl);
        const mat = this.cv.imread(img);
        this.backCardTemplate = new this.cv.Mat();
        this.cv.cvtColor(mat, this.backCardTemplate, this.cv.COLOR_RGBA2GRAY);
        mat.delete();
        console.log("ClientSideSolver: Template loaded successfully.");

        // Load 12 reference face templates
        for (let cardType = 1; cardType <= 12; cardType++) {
            const refUrl = `/7k-card-matching-solver/templates/reference_faces/card_${cardType}.png`;
            try {
                const refImg = await this.loadImage(refUrl);
                const refMat = this.cv.imread(refImg);
                
                // Preprocess: convert to grayscale, resize to 128x128, equalize histogram
                const gray = new this.cv.Mat();
                this.cv.cvtColor(refMat, gray, this.cv.COLOR_RGBA2GRAY);
                const resized = new this.cv.Mat();
                this.cv.resize(gray, resized, new this.cv.Size(128, 128));
                const equalized = new this.cv.Mat();
                this.cv.equalizeHist(resized, equalized);
                
                this.referenceTemplates.set(cardType, equalized);
                
                // Cleanup intermediate mats
                refMat.delete();
                gray.delete();
                resized.delete();
                
                console.log(`Loaded reference template for card type ${cardType}`);
            } catch (err) {
                console.error(`Failed to load reference template ${cardType}:`, err);
            }
        }
        
        console.log(`Loaded ${this.referenceTemplates.size} reference templates.`);
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
     * @param videoBlob - The video file as a Blob
     * @param fps - Frames per second to extract (default: 10)
     * @param startTime - Start time in seconds (default: 0)
     * @param endTime - End time in seconds. If undefined or 0, processes the full video without trimming
     * @returns Array of frames with timestamps and OpenCV Mat objects
     */
    private async extractFramesFromBlob(videoBlob: Blob, fps: number = 10, startTime: number = 0, endTime?: number): Promise<{ ts: number, mat: any }[]> {
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
                
                // Calculate the actual time range to extract
                const videoEnd = Math.min(endTime && endTime > 0 ? endTime : video.duration, video.duration);
                const videoStart = Math.max(0, Math.min(startTime, videoEnd));
                const duration = Math.min(videoEnd - videoStart, 30); // Max 30 seconds
                const interval = 1 / fps;
                
                console.log(`Extracting frames from ${videoStart}s to ${videoStart + duration}s (${duration}s duration) at ${fps} FPS`);

                try {
                    for (let offset = 0; offset < duration; offset += interval) {
                        const ts = videoStart + offset;
                        if (ts > videoEnd) break; // Safety check
                        
                        video.currentTime = ts;
                        await new Promise(r => {
                            video.onseeked = r;
                        });
                        if (ctx) {
                            ctx.drawImage(video, 0, 0);
                            try {
                                const mat = this.cv.imread(canvas);
                                if (!mat || mat.empty()) {
                                    console.warn(`Frame at ${ts}s is empty, skipping`);
                                    continue;
                                }
                                frames.push({ ts, mat });
                            } catch (cvError) {
                                console.error(`OpenCV error reading frame at ${ts}s:`, cvError);
                                // Continue to next frame instead of failing completely
                                continue;
                            }
                        }
                    }
                    URL.revokeObjectURL(video.src);
                    if (frames.length === 0) {
                        reject(new Error('No frames could be extracted from video'));
                    } else {
                        console.log(`Successfully extracted ${frames.length} frames`);
                        resolve(frames);
                    }
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
                    this.baselineFrameIdx = i;
                    this.baselineFrameTs = frames[i].ts;
                    console.log(`✅ Found all 24 cards at frame index ${i}, timestamp ${frames[i].ts.toFixed(2)}s`);
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
                        this.baselineFrameIdx = i;
                        this.baselineFrameTs = frames[i].ts;
                        console.log(`✅ Found all 24 cards at frame index ${i}, timestamp ${frames[i].ts.toFixed(2)}s during extended scan`);
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
     * Assigns card types to each detected position by matching against reference templates.
     * @param frames Array of video frames
     * @param rects Detected card rectangles
     * @param stride Process every Nth frame (default: 2)
     * @returns Map of position to best matching card type and confidence
     */
    private async assignCardTypes(
        frames: { ts: number, mat: any }[], 
        rects: Rect[], 
        stride: number = 2
    ): Promise<Map<number, {cardType: number, confidence: number, frameIdx: number}>> {
        const assignments = new Map<number, {cardType: number, confidence: number, frameIdx: number}>();
        const gray = new this.cv.Mat();
        
        console.log(`\n🔍 Assigning card types for ${rects.length} positions using ${this.referenceTemplates.size} references...`);
        
        // For each card position
        for (let pos = 0; pos < rects.length; pos++) {
            const rect = rects[pos];
            let bestMatch = { cardType: 0, confidence: 0, frameIdx: 0 };
            
            // Scan frames with stride
            for (let frameIdx = 0; frameIdx < frames.length; frameIdx += stride) {
                if (this.progressCallback && frameIdx % 10 === 0) {
                    const progress = pos * frames.length + frameIdx;
                    const total = rects.length * frames.length;
                    this.progressCallback(
                        Math.floor(progress / stride), 
                        Math.floor(total / stride), 
                        `Assigning cards`, 
                        this.stepHistory
                    );
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
                
                try {
                    // Extract ROI from frame
                    this.cv.cvtColor(frames[frameIdx].mat, gray, this.cv.COLOR_RGBA2GRAY);
                    const roi = gray.roi(new this.cv.Rect(rect.x, rect.y, rect.width, rect.height));
                    
                    // Resize and equalize to match reference preprocessing (128x128)
                    const resized = new this.cv.Mat();
                    this.cv.resize(roi, resized, new this.cv.Size(128, 128));
                    const equalized = new this.cv.Mat();
                    this.cv.equalizeHist(resized, equalized);
                    
                    // Compare against all 12 reference templates
                    for (let cardType = 1; cardType <= 12; cardType++) {
                        const refTemplate = this.referenceTemplates.get(cardType);
                        if (!refTemplate) continue;
                        
                        const res = new this.cv.Mat();
                        this.cv.matchTemplate(equalized, refTemplate, res, this.cv.TM_CCOEFF_NORMED);
                        const score = res.data32F[0];
                        
                        if (score > bestMatch.confidence) {
                            bestMatch = { cardType, confidence: score, frameIdx };
                        }
                        
                        res.delete();
                    }
                    
                    roi.delete();
                    resized.delete();
                    equalized.delete();
                } catch (e) {
                    console.warn(`Error processing position ${pos}, frame ${frameIdx}:`, e);
                }
                
                // Early stopping: if we found a very high confidence match (>92%), stop scanning more frames
                if (bestMatch.confidence > 0.92) {
                    console.log(`  Position ${pos}: Early stop at confidence ${bestMatch.confidence.toFixed(3)}`);
                    break;
                }
            }
            
            // Store best match if confidence exceeds threshold
            const threshold = 0.5;
            if (bestMatch.confidence > threshold) {
                assignments.set(pos, bestMatch);
                console.log(`  Position ${pos}: Card Type ${bestMatch.cardType} (confidence: ${bestMatch.confidence.toFixed(3)}, frame: ${bestMatch.frameIdx})`);
            } else {
                console.log(`  Position ${pos}: No match (best: ${bestMatch.confidence.toFixed(3)})`);
            }
        }
        
        gray.delete();
        console.log(`✅ Assigned ${assignments.size}/${rects.length} positions\n`);
        return assignments;
    }

    /**
     * Solves the card matching puzzle from a video.
     * @param videoBlob - The video file as a Blob
     * @param startTime - Start time in seconds (default: 0)
     * @param endTime - End time in seconds. If undefined or 0, processes the full video without trimming
     * @returns SolveResult containing card assignments and baseline frame information
     */
    async solve(videoBlob: Blob, startTime: number = 0, endTime?: number): Promise<SolveResult> {
        console.log(`solve() called with startTime=${startTime}, endTime=${endTime}`);
        
        if (!this.cv) throw new Error("OpenCV.js not initialized");
        
        // Reset baseline frame tracking for each new solve operation
        this.baselineFrameIdx = -1;
        this.baselineFrameTs = -1;
        this.stepHistory = [];
        
        // 1. Extract frames
        this.currentStepStart = Date.now();
        const frames = await this.extractFramesFromBlob(videoBlob, 10, startTime, endTime);
        this.stepHistory.push({step: 'Extract frames', duration: Date.now() - this.currentStepStart});
        
        // 2. Detect card locations to find baseline frame
        this.currentStepStart = Date.now();
        const rects = await this.detectCardLocations(frames);
        this.stepHistory.push({step: 'Detect cards', duration: Date.now() - this.currentStepStart});
        const cardsDetected = rects.length;
        
        if (rects.length === 0) {
            frames.forEach(f => f.mat.delete());
            return { pairs_count: 0, card_assignments: {}, grid_faces: {}, status: "No cards detected", cards_detected: 0 };
        }

        // Trim frames to 6 seconds starting from baseline frame
        // This optimizes processing by focusing only on relevant frames after game starts
        let processFrames = frames;
        if (this.baselineFrameIdx >= 0 && this.baselineFrameTs >= 0) {
            const SECONDS_AFTER_BASELINE = 6;
            const baselineIdx = frames.findIndex(f => f.ts >= this.baselineFrameTs);
            if (baselineIdx >= 0) {
                const endIdx = frames.findIndex((f, idx) => idx > baselineIdx && f.ts >= this.baselineFrameTs + SECONDS_AFTER_BASELINE);
                const trimEndIdx = endIdx >= 0 ? endIdx : frames.length;
                processFrames = frames.slice(baselineIdx, trimEndIdx);
                
                // Clean up frames outside the processing window
                frames.slice(0, baselineIdx).forEach(f => f.mat.delete());
                frames.slice(trimEndIdx).forEach(f => f.mat.delete());
                
                const windowDurationSec = (processFrames[processFrames.length - 1].ts - this.baselineFrameTs).toFixed(2);
                console.log(`📊 Using baseline-aligned window: frames ${baselineIdx}-${trimEndIdx} (${processFrames.length} frames, ${windowDurationSec}s)`);
            }
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

        // 3. Assign card types using reference templates
        this.currentStepStart = Date.now();
        const assignments = await this.assignCardTypes(processFrames, rects, 2);
        this.stepHistory.push({step: 'Assign card types', duration: Date.now() - this.currentStepStart});

        // 4. Extract faces from best matching frames
        this.currentStepStart = Date.now();
        const cardFaces = new Map<number, any>();
        
        for (let pos = 0; pos < rects.length; pos++) {
            const assignment = assignments.get(pos);
            if (!assignment) continue;
            
            const rect = rects[pos];
            const frameIdx = assignment.frameIdx;
            
            try {
                const faceRoi = processFrames[frameIdx].mat.roi(new this.cv.Rect(rect.x, rect.y, rect.width, rect.height));
                cardFaces.set(pos, faceRoi.clone());
                faceRoi.delete();
            } catch (e) {
                console.warn(`Error extracting face at position ${pos}:`, e);
            }
        }
        
        this.stepHistory.push({step: 'Extract faces', duration: Date.now() - this.currentStepStart});

        console.log(`Extracted ${cardFaces.size} card faces.`);
        
        // Convert assignments to result format
        const card_assignments: Record<number, {cardType: number, confidence: number} | null> = {};
        let assignedCount = 0;
        for (let i = 0; i < rects.length; i++) {
            const assignment = assignments.get(i);
            if (assignment) {
                card_assignments[i] = {
                    cardType: assignment.cardType,
                    confidence: assignment.confidence
                };
                assignedCount++;
            } else {
                card_assignments[i] = null;
            }
        }
        
        console.log(`✅ Assigned ${assignedCount}/${rects.length} cards to types`);
        console.log('📊 Assignments:', card_assignments);
        
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
        processFrames.forEach(f => f.mat.delete());
        cardFaces.forEach(f => f.delete());

        // Log baseline frame info if found
        if (this.baselineFrameIdx >= 0) {
            console.log(`📍 Game baseline frame: index ${this.baselineFrameIdx}, timestamp ${this.baselineFrameTs.toFixed(2)}s`);
        }

        return {
            pairs_count: assignedCount,
            card_assignments,
            grid_faces,
            status: assignedCount === 24 ? "All cards assigned" : `Assigned ${assignedCount}/${rects.length} cards`,
            cards_detected: cardsDetected,
            step_history: this.stepHistory,
            baseline_frame_idx: this.baselineFrameIdx,
            baseline_frame_ts: this.baselineFrameTs
        };
    }

    /**
     * Cleanup OpenCV mats.
     */
    dispose() {
        if (this.backCardTemplate) this.backCardTemplate.delete();
        this.referenceTemplates.forEach(mat => mat.delete());
        this.referenceTemplates.clear();
        this.cardFaces.forEach(mat => mat.delete());
        this.cardFaces.clear();
    }
}

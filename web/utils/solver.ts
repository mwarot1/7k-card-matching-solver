import type { Mat } from './opencv-types';

declare const cv: any;

export interface SolveResult {
    pairs: [number, number][];
    grid_faces: Record<string, string | null>;
    pairs_count: number;
    status: string;
}

export class ClientSolver {
    private backCardTemplate: Mat | null = null;
    private locations: number[][][] = []; // Array of polygons [pointIndex][x,y]
    private cardFaces: Map<number, Mat> = new Map();

    constructor() { }

    async init(templateUrl: string) {
        const resp = await fetch(templateUrl);
        const blob = await resp.blob();
        const img = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        this.backCardTemplate = cv.imread(canvas);
        cv.cvtColor(this.backCardTemplate, this.backCardTemplate, cv.COLOR_RGBA2GRAY);
    }

    private nms(detections: { x: number; y: number; score: number; width: number; height: number }[], minDistance: number) {
        const kept: typeof detections = [];
        detections.sort((a, b) => b.score - a.score);
        for (const d of detections) {
            let overlap = false;
            for (const k of kept) {
                const dist = Math.sqrt(Math.pow(d.x - k.x, 2) + Math.pow(d.y - k.y, 2));
                if (dist < minDistance) {
                    overlap = true;
                    break;
                }
            }
            if (!overlap) kept.push(d);
        }
        return kept;
    }

    private detectCardLocations(frameGray: Mat): number[][][] {
        let bestDetections: any[] = [];
        let bestScale = 1.0;
        const templateH = this.backCardTemplate!.rows;
        const templateW = this.backCardTemplate!.cols;

        // Multi-scale matching
        for (let scale = 0.4; scale <= 1.2; scale += 0.05) {
            const scaledW = Math.floor(templateW * scale);
            const scaledH = Math.floor(templateH * scale);
            const scaledTemplate = new cv.Mat();
            cv.resize(this.backCardTemplate, scaledTemplate, new cv.Size(scaledW, scaledH));

            const result = new cv.Mat();
            cv.matchTemplate(frameGray, scaledTemplate, result, cv.TM_CCOEFF_NORMED);

            const threshold = 0.65;
            const detections: any[] = [];
            const data = result.data32F;
            for (let r = 0; r < result.rows; r++) {
                for (let c = 0; c < result.cols; c++) {
                    const score = data[r * result.cols + c];
                    if (score >= threshold) {
                        detections.push({ x: c, y: r, score, width: scaledW, height: scaledH });
                    }
                }
            }

            const filtered = this.nms(detections, scaledW * 0.8);
            if (Math.abs(filtered.length - 24) < Math.abs(bestDetections.length - 24)) {
                bestDetections = filtered;
                bestScale = scale;
            }

            scaledTemplate.delete();
            result.delete();
            if (bestDetections.length === 24) break;
        }

        // Sort: Top-to-bottom, Left-to-right
        const rowHeight = (bestDetections[0]?.height || 100) * 0.5;
        bestDetections.sort((a, b) => {
            const rowA = Math.floor(a.y / rowHeight);
            const rowB = Math.floor(b.y / rowHeight);
            if (rowA !== rowB) return rowA - rowB;
            return a.x - b.x;
        });

        return bestDetections.map(d => [
            [d.x, d.y],
            [d.x + d.width, d.y],
            [d.x + d.width, d.y + d.height],
            [d.x, d.y + d.height]
        ]);
    }

    // Simplified version for the browser
    async solve(capturedFrames: { ts: number; frame: ImageData; reg: number[] }[]): Promise<SolveResult> {
        if (!this.backCardTemplate) throw new Error("Solver not initialized");
        if (capturedFrames.length === 0) throw new Error("No frames provided");

        const mats = capturedFrames.map(f => {
            const mat = cv.matFromImageData(f.frame);
            const gray = new cv.Mat();
            cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
            mat.delete();
            return gray;
        });

        // 1. Detect Grid (using first frame for simplicity, update for cumulative later if needed)
        this.locations = this.detectCardLocations(mats[0]);
        console.log("Detected", this.locations.length, "cards");

        // Clear previous faces
        this.cardFaces.forEach(f => f.delete());
        this.cardFaces.clear();

        const maxDiffs: Record<number, number> = {};
        this.locations.forEach((_, i) => maxDiffs[i] = 0);

        // 2. Baseline Extraction
        // Determine the baseline frame (middle of first stable 'all-back' sequence)
        // For simplicity, we'll use the first frame as baseline for now if it has many cards
        const baselineIdx = 0;
        const perCardBaselines: Record<number, Mat> = {};

        this.locations.forEach((poly, i) => {
            const x1 = Math.floor(poly[0][0]);
            const y1 = Math.floor(poly[0][1]);
            const w = Math.floor(poly[2][0] - x1);
            const h = Math.floor(poly[2][1] - y1);
            const roi = mats[baselineIdx].roi(new cv.Rect(x1, y1, w, h));
            perCardBaselines[i] = roi.clone();
            roi.delete();
        });

        // 3. Face Extraction
        mats.forEach((mat) => {
            this.locations.forEach((poly, i) => {
                const x1 = Math.floor(poly[0][0]);
                const y1 = Math.floor(poly[0][1]);
                const w = Math.floor(poly[2][0] - x1);
                const h = Math.floor(poly[2][1] - y1);

                const roi = mat.roi(new cv.Rect(x1, y1, w, h));
                const baseline = perCardBaselines[i];

                // Difference calculation
                const diff = new cv.Mat();
                cv.absdiff(roi, baseline, diff);
                const sum = cv.sum(diff).val[0] / (w * h);

                if (sum > (maxDiffs[i] || 0)) {
                    maxDiffs[i] = sum;
                    if (this.cardFaces.has(i)) this.cardFaces.get(i)!.delete();
                    this.cardFaces.set(i, roi.clone());
                }

                roi.delete();
                diff.delete();
            });
        });

        // 4. Pair Finding
        const pairs: [number, number][] = this.findPairs();
        console.log("Found", pairs.length, "pairs");

        // 5. Convert Faces to Base64
        const gridFaces: Record<string, string | null> = {};
        for (let i = 0; i < 24; i++) {
            const face = this.cardFaces.get(i);
            if (face) {
                const canvas = document.createElement('canvas');
                cv.imshow(canvas, face);
                gridFaces[i.toString()] = canvas.toDataURL('image/png');
            } else {
                gridFaces[i.toString()] = null;
            }
        }

        // Cleanup
        mats.forEach(m => m.delete());
        Object.values(perCardBaselines).forEach(m => m.delete());

        return {
            pairs,
            grid_faces: gridFaces,
            pairs_count: pairs.length,
            status: pairs.length === 12 ? 'success' : 'partial'
        };
    }

    private findPairs(): [number, number][] {
        const indices = Array.from(this.cardFaces.keys()).sort((a, b) => a - b);
        const processedFaces: Record<number, Mat> = {};

        indices.forEach(idx => {
            const face = this.cardFaces.get(idx)!;
            const resized = new cv.Mat();
            cv.resize(face, resized, new cv.Size(64, 64));
            const equalized = new cv.Mat();
            // Since we already have grayscale, we just equalize
            // cv.equalizeHist(resized, equalized); // Note: OpenCV.js might have issues with some versions of this
            processedFaces[idx] = resized;
        });

        const scores: { score: number, idx1: number, idx2: number }[] = [];
        for (let i = 0; i < indices.length; i++) {
            for (let j = i + 1; j < indices.length; j++) {
                const idx1 = indices[i];
                const idx2 = indices[j];
                const result = new cv.Mat();
                cv.matchTemplate(processedFaces[idx1], processedFaces[idx2], result, cv.TM_CCOEFF_NORMED);
                const score = result.data32F[0];
                scores.push({ score, idx1, idx2 });
                result.delete();
            }
        }

        scores.sort((a, b) => b.score - a.score);
        const pairs: [number, number][] = [];
        const matched = new Set<number>();

        for (const s of scores) {
            if (matched.has(s.idx1) || matched.has(s.idx2)) continue;
            if (s.score > 0.4) {
                pairs.push([s.idx1, s.idx2]);
                matched.add(s.idx1);
                matched.add(s.idx2);
            }
            if (pairs.length === 12) break;
        }

        Object.values(processedFaces).forEach(m => m.delete());
        return pairs;
    }

    dispose() {
        if (this.backCardTemplate) this.backCardTemplate.delete();
        this.cardFaces.forEach(f => f.delete());
        this.cardFaces.clear();
    }
}

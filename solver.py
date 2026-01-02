import cv2
import numpy as np
import json
import os
import time
from typing import List, Tuple, Dict, Optional, Callable
try:
    from PIL import ImageGrab
    import win32gui
    import win32ui
    import win32con
except ImportError:
    # These are only needed for desktop live capture, not for the web API
    pass

from PIL import Image
from matching import load_locations_from_json

class FrameBuffer:
    """Stores a sequence of captured frames for retrospective analysis."""
    def __init__(self, max_frames: int = 100):
        self.frames: List[Tuple[float, np.ndarray, Tuple[int, int, int, int, Optional[int]]]] = []
        self.max_frames = max_frames

    def add(self, timestamp: float, frame: np.ndarray, region: Tuple[int, int, int, int, Optional[int]]):
        self.frames.append((timestamp, frame, region))
        if len(self.frames) > self.max_frames:
            self.frames.pop(0)

    def clear(self):
        self.frames = []

    def get_all(self):
        return self.frames

class CardSolver:
    def __init__(self, locations_path: str, video_path: str, template_path: str):
        self.locations = load_locations_from_json(locations_path)
        
        # Sort locations: Top-to-bottom, Left-to-right
        # We bin Y coordinates by 50px to group rows
        try:
            centroids = [np.mean(poly, axis=0) for poly in self.locations]
            # lexsort sorts by last key first, so we pass (x, y_binned) to sort by y then x
            sorted_indices = np.lexsort((
                [c[0] for c in centroids], 
                [int(c[1] / 50) for c in centroids]
            ))
            self.locations = [self.locations[i] for i in sorted_indices]
            print("Sorted locations top-to-bottom, left-to-right.")
        except Exception as e:
            print("Warning: Could not sort locations: " + str(e))

        self.video_path = video_path
        self.template_path = template_path
        self.card_faces: Dict[int, np.ndarray] = {} # Map location_index -> face_image
        
        # Load template for back of card comparison
        self.back_card_img = cv2.imread(template_path)
        if self.back_card_img is None:
            raise ValueError("Could not load template: " + template_path)
        self.back_card_gray = cv2.cvtColor(self.back_card_img, cv2.COLOR_BGR2GRAY)

        # Load reference image to get target size for resizing
        self.ref_img_path = "7kMinigames/card_all.png"
        ref_img = cv2.imread(self.ref_img_path)
        if ref_img is not None:
            self.ref_size = (ref_img.shape[1], ref_img.shape[0]) # w, h
        else:
            print("Warning: Could not load reference image " + self.ref_img_path + ". Resizing might fail.")
            self.ref_size = None

    def save_debug_screenshot(self, frame: np.ndarray, state_name: str, timestamp: float):
        """Saves a debug screenshot with the state name and timestamp."""
        debug_dir = "debug_screenshots"
        if not os.path.exists(debug_dir):
            os.makedirs(debug_dir)
            
        filename = debug_dir + "/" + f"{timestamp:.2f}" + "s_" + state_name + ".png"
        
        # Draw text on frame
        img_copy = frame.copy()
        cv2.putText(img_copy, "State: " + state_name, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
        cv2.putText(img_copy, "Time: " + f"{timestamp:.2f}" + "s", (10, 70), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
        
        cv2.imwrite(filename, img_copy)
        print("Saved debug screenshot: " + filename)

    def detect_game_start_frame(self, frame: np.ndarray, threshold: float = 0.4) -> bool:
        """
        Checks a single frame to see if all cards are 'Back'.
        Returns True if start is detected.
        """
        gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        all_back = True
        min_score = 1.0
        
        for i, poly in enumerate(self.locations):
            xs = [p[0] for p in poly]
            ys = [p[1] for p in poly]
            x_min, x_max = min(xs), max(xs)
            y_min, y_max = min(ys), max(ys)
            
            # Bounds check
            h, w = gray_frame.shape
            x_min = max(0, x_min); y_min = max(0, y_min)
            x_max = min(w, x_max); y_max = min(h, y_max)
            
            card_roi = gray_frame[y_min:y_max, x_min:x_max]
            
            if card_roi.shape[0] < self.back_card_gray.shape[0] or card_roi.shape[1] < self.back_card_gray.shape[1]:
                    back_resized = cv2.resize(self.back_card_gray, (card_roi.shape[1], card_roi.shape[0]))
                    res = cv2.matchTemplate(card_roi, back_resized, cv2.TM_CCOEFF_NORMED)
            else:
                    back_resized = cv2.resize(self.back_card_gray, (card_roi.shape[1], card_roi.shape[0]))
                    res = cv2.matchTemplate(card_roi, back_resized, cv2.TM_CCOEFF_NORMED)
            
            score = res[0][0]
            if score < min_score:
                min_score = score
            
            if score < threshold:
                all_back = False
        
        if min_score > 0.3:
            print("Debug: Min match score: " + f"{min_score:.2f}" + " (Threshold: " + str(threshold) + ")")
            
        return all_back

    def detect_game_start(self, cap, threshold: float = 0.6) -> Tuple[bool, float]:
        """
        Scans the video until all cards are considered 'Back' using template matching.
        Returns (True, timestamp) if start is detected, (False, 0) otherwise.
        """
        print("Waiting for game start (all cards face down)...")
        frame_count = 0
        
        while True:
            ret, frame = cap.read()
            if not ret:
                break
                
            timestamp = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
            
            # Check every 5th frame to save time
            if frame_count % 5 == 0:
                if self.detect_game_start_frame(frame, threshold):
                    print("Game start detected at " + f"{timestamp:.2f}" + "s")
                    self.save_debug_screenshot(frame, "GAME_START", timestamp)
                    return True, timestamp
            
            frame_count += 1
            
        return False, 0.0

    def process_video_end_to_end(self, threshold: float = 0.6):
        cap = cv2.VideoCapture(self.video_path)
        if not cap.isOpened():
            print("Error: Could not open video.")
            return

        fps = cap.get(cv2.CAP_PROP_FPS)
        
        # 1. Wait for start
        started, start_time = self.detect_game_start(cap, threshold)
        if not started:
            print("Could not detect game start.")
            return

        # 2. Capture faces
        print("Capturing faces...")
        max_frames = int(fps * (start_time + 4.0)) 
        frame_count = int(cap.get(cv2.CAP_PROP_POS_FRAMES))
        max_diffs = {i: 0.0 for i in range(len(self.locations))}
        
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            
            timestamp = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
            
            if frame_count >= max_frames:
                print("Reached scan limit at " + f"{timestamp:.2f}" + "s.")
                self.save_debug_screenshot(frame, "SCAN_LIMIT_REACHED", timestamp)
                break
            
            self._process_frame_for_faces(frame, max_diffs)
            frame_count += 1
            
        cap.release()
        print("Finished capturing. Found " + str(len(self.card_faces)) + "/" + str(len(self.locations)) + " faces.")

    def capture_window_direct(self, hwnd, region):
        """Capture window content directly using Windows API."""
        try:
            wDC = win32gui.GetWindowDC(hwnd)
            dcObj = win32ui.CreateDCFromHandle(wDC)
            cDC = dcObj.CreateCompatibleDC()
            dataBitMap = win32ui.CreateBitmap()
            dataBitMap.CreateCompatibleBitmap(dcObj, region[2], region[3])
            cDC.SelectObject(dataBitMap)
            result = win32gui.PrintWindow(hwnd, cDC.GetSafeHdc(), 3)
            if result == 0:
                dcObj.DeleteDC(); cDC.DeleteDC(); win32gui.ReleaseDC(hwnd, wDC); win32gui.DeleteObject(dataBitMap.GetHandle())
                return None
            bmpstr = dataBitMap.GetBitmapBits(True)
            img = np.frombuffer(bmpstr, dtype=np.uint8).reshape(region[3], region[2], 4)
            dcObj.DeleteDC(); cDC.DeleteDC(); win32gui.ReleaseDC(hwnd, wDC); win32gui.DeleteObject(dataBitMap.GetHandle())
            img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
            return img
        except Exception as e:
            print("Direct capture error: " + str(e))
            return None

    def _nms(self, detections: List[Tuple[int, int, int, int, float]], overlap_thresh: float = 0.3) -> List[Tuple[int, int, int, int, float]]:
        if not detections: return []
        detections = sorted(detections, key=lambda x: x[4], reverse=True)
        pick = []
        while detections:
            best = detections.pop(0)
            pick.append(best)
            remaining = []
            for d in detections:
                x1, y1 = max(best[0], d[0]), max(best[1], d[1])
                x2, y2 = min(best[0] + best[2], d[0] + d[2]), min(best[1] + best[3], d[1] + d[3])
                w_overlap, h_overlap = max(0, x2 - x1), max(0, y2 - y1)
                overlap = (w_overlap * h_overlap) / (best[2] * best[3])
                if overlap < overlap_thresh: remaining.append(d)
            detections = remaining
        return pick

    def detect_card_locations(self, frame: np.ndarray) -> List[Tuple[int, int, int, int, float]]:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        best_detections = []
        for scale in np.linspace(0.2, 1.8, 30):
            template_h, template_w = self.back_card_gray.shape
            tw, th = int(template_w * scale), int(template_h * scale)
            if tw < 10 or th < 10: continue
            template = cv2.resize(self.back_card_gray, (tw, th))
            res = cv2.matchTemplate(gray, template, cv2.TM_CCOEFF_NORMED)
            threshold = 0.55
            locs = np.where(res >= threshold)
            detections = []
            for pt in zip(*locs[::-1]):
                score = res[pt[1], pt[0]]
                detections.append((pt[0], pt[1], tw, th, score))
            detections = self._nms(detections)
            if len(detections) == 24: return detections
            if abs(len(detections) - 24) < abs(len(best_detections) - 24) or not best_detections:
                best_detections = detections
        return best_detections

    def _detections_to_polygons(self, detections: List[Tuple[int, int, int, int, float]]) -> List[np.ndarray]:
        if not detections: return []
        polygons = []
        for x, y, w, h, _ in detections:
            poly = np.array([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], dtype=np.int32)
            polygons.append(poly)
        avg_h = np.mean([h for _, _, _, h, _ in detections])
        bin_size = avg_h * 0.5
        centroids = [np.mean(poly, axis=0) for poly in polygons]
        sorted_indices = np.lexsort(([c[0] for c in centroids], [int(c[1] / bin_size) for c in centroids]))
        return [polygons[i] for i in sorted_indices]

    def solve_screen_session(self, region_callback: Callable[[], Tuple[int, int, int, int, Optional[int]]], callback: Callable[[str], None], stop_event, threshold: float = 0.4):
        print("Starting Record and Replay solver session")
        callback("Recording (8s)...")
        buffer = FrameBuffer(max_frames=600) 
        start_time = time.time()
        use_all_screens = True
        region = region_callback()
        if region and region[0] >= 0 and region[1] >= 0: use_all_screens = False
        while not stop_event.is_set():
            elapsed = time.time() - start_time
            if elapsed > 8.0: break
            region = region_callback()
            if not region: break
            try:
                screen = ImageGrab.grab(bbox=(region[0], region[1], region[0]+region[2], region[1]+region[3]), all_screens=use_all_screens)
                frame = cv2.cvtColor(np.array(screen), cv2.COLOR_RGB2BGR)
                buffer.add(elapsed, frame, region)
            except:
                if not use_all_screens: use_all_screens = True; continue
            time.sleep(0.1)
        if stop_event.is_set(): return
        self.solve_frames(buffer.get_all(), callback)

    def solve_video_session(self, video_path, callback=None):
        if callback is None: callback = lambda x: None
        print("Processing video: " + video_path)
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened(): return
        captured_frames = []
        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_count = 0
        while True:
            ret, frame = cap.read()
            if not ret: break
            h, w = frame.shape[:2]
            ts = frame_count / fps
            if ts > 8.0: break
            captured_frames.append((ts, frame, (0, 0, w, h)))
            frame_count += 1
        cap.release()
        print("Loaded " + str(len(captured_frames)) + " frames.")
        self.solve_frames(captured_frames, callback)

    def solve_frames(self, captured_frames, callback):
        if not captured_frames: return
        debug_screenshot_dir = "debug_screenshots"
        if not os.path.exists(debug_screenshot_dir): os.makedirs(debug_screenshot_dir)
        callback("Analyzing recording...")
        all_detections = []
        best_frame = captured_frames[0][1]
        for i in range(0, len(captured_frames), 2):
            ts, frame, reg = captured_frames[i]
            frame_detections = self.detect_card_locations(frame)
            if frame_detections: all_detections.extend(frame_detections)
            unique_detections = self._nms(all_detections)
            if len(unique_detections) == 24:
                print("Perfect 24-card grid accumulated at " + f"{ts:.2f}" + "s!")
                best_frame = frame; break
            if len(frame_detections) > 15: best_frame = frame
        final_detections = self._nms(all_detections)
        if not final_detections:
            if not self.locations: return
        else:
            self.locations = self._detections_to_polygons(final_detections)
            print("Dynamic calibration successful! Found " + str(len(self.locations)) + " cards.")
            debug_img = best_frame.copy()
            for i, poly in enumerate(self.locations):
                cv2.polylines(debug_img, [poly], True, (0, 255, 0), 2)
                cv2.putText(debug_img, str(i+1), tuple(poly[0]), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
            cv2.imwrite(debug_screenshot_dir + "/detected_grid.png", debug_img)

        callback("Extracting faces...")
        # Use absolute path for debug_faces to avoid pathing issues with API
        project_root = os.path.dirname(os.path.abspath(__file__))
        debug_faces_dir = os.path.join(project_root, "debug_faces")
        
        if not os.path.exists(debug_faces_dir): 
            os.makedirs(debug_faces_dir)
        else:
            # Clear old faces to prevent leakage from previous sessions
            import shutil
            for f in os.listdir(debug_faces_dir):
                if f.startswith("face_"):
                    try: os.remove(os.path.join(debug_faces_dir, f))
                    except: pass
        max_diffs = {i: 0.0 for i in range(len(self.locations))}
        self.card_faces = {}
        all_back_sequences = []
        current_seq_start = -1
        stable_count = 0
        for i, (ts, frame, reg) in enumerate(captured_frames):
            gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            back_count = 0
            for poly in self.locations:
                xs, ys = [p[0] for p in poly], [p[1] for p in poly]
                x1, y1, x2, y2 = max(0, min(xs)), max(0, min(ys)), min(reg[2], max(xs)), min(reg[3], max(ys))
                card_roi = gray_frame[y1:y2, x1:x2]
                if card_roi.size == 0: continue
                back_resized = cv2.resize(self.back_card_gray, (card_roi.shape[1], card_roi.shape[0]))
                res = cv2.matchTemplate(card_roi, back_resized, cv2.TM_CCOEFF_NORMED)
                if res[0][0] > 0.6: back_count += 1
            if back_count >= 22:
                if current_seq_start == -1: current_seq_start = i
                stable_count += 1
            else:
                if current_seq_start != -1 and stable_count >= 3: all_back_sequences.append((current_seq_start, i - 1))
                current_seq_start = -1; stable_count = 0
        if current_seq_start != -1 and stable_count >= 3: all_back_sequences.append((current_seq_start, len(captured_frames) - 1))
        
        if not all_back_sequences: start_idx = 0; baseline_idx = 0
        else:
            first_seq = all_back_sequences[0]
            baseline_idx = (first_seq[0] + first_seq[1]) // 2
            start_idx = first_seq[1]
            print("Stable game start found: Sequence " + str(first_seq[0]) + "-" + str(first_seq[1]) + ". Baseline from frame " + str(baseline_idx) + ".")

        cv2.imwrite(os.path.join(project_root, debug_screenshot_dir, "game_start.png"), captured_frames[baseline_idx][1])
        baseline_frame = captured_frames[baseline_idx][1]
        baseline_reg = captured_frames[baseline_idx][2]
        baseline_gray = cv2.cvtColor(baseline_frame, cv2.COLOR_BGR2GRAY)
        per_card_baselines = {}
        for i, poly in enumerate(self.locations):
            xs, ys = [p[0] for p in poly], [p[1] for p in poly]
            x1, y1, x2, y2 = max(0, min(xs)), max(0, min(ys)), min(baseline_reg[2], max(xs)), min(baseline_reg[3], max(ys))
            per_card_baselines[i] = baseline_gray[y1:y2, x1:x2].copy()
            cv2.imwrite(os.path.join(debug_faces_dir, "baseline_" + str(i) + ".png"), per_card_baselines[i])
            
        for ts, frame, reg in captured_frames[start_idx:]:
            self._process_frame_for_faces(frame, max_diffs, per_card_baselines)
            
        for i, face in self.card_faces.items():
            # Always save the best face found to ensure grid is populated
            cv2.imwrite(os.path.join(debug_faces_dir, f"face_{i}.png"), face)
            
        callback("Solving...")
        pairs = self.find_pairs()
        self.save_pairs(pairs, "card_pairs.json")
        if pairs:
            print("Found " + str(len(pairs)) + " pairs!")
            vis_frame = best_frame if best_frame is not None else captured_frames[0][1]
            self.visualize_solution(pairs, vis_frame, "solved_pairs.png")
            callback("Solved! Check solved_pairs.png")
        else:
            print("Failed to find pairs")
            callback("Failed to solve.")

    def _process_frame_for_faces(self, frame, max_diffs, per_card_baselines=None):
        gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        for i, poly in enumerate(self.locations):
            xs, ys = [p[0] for p in poly], [p[1] for p in poly]
            x_min, x_max, y_min, y_max = max(0, min(xs)), min(gray_frame.shape[1], max(xs)), max(0, min(ys)), min(gray_frame.shape[0], max(ys))
            card_roi = gray_frame[y_min:y_max, x_min:x_max]
            if card_roi.size == 0: continue
            if per_card_baselines and i in per_card_baselines: back_ref = per_card_baselines[i]
            else: back_ref = cv2.resize(self.back_card_gray, (card_roi.shape[1], card_roi.shape[0]))
            if card_roi.shape != back_ref.shape: back_ref = cv2.resize(back_ref, (card_roi.shape[1], card_roi.shape[0]))
            diff = cv2.absdiff(card_roi, back_ref)
            mean_diff = np.mean(diff)
            if np.mean(card_roi) > 170: continue
            if mean_diff > max_diffs[i]:
                max_diffs[i] = mean_diff
                self.card_faces[i] = frame[y_min:y_max, x_min:x_max].copy()

    def visualize_solution(self, pairs: List[Tuple[int, int]], source: any, output_path: str):
        if hasattr(source, 'shape'): img = source.copy()
        elif isinstance(source, str): img = cv2.imread(source)
        else: return
        if img is None: return
        np.random.seed(42)
        colors = np.random.randint(0, 255, (len(pairs), 3)).tolist()
        pairs.sort(key=lambda p: min(p[0], p[1]))
        for i, (idx1, idx2) in enumerate(pairs):
            poly1, poly2 = self.locations[idx1], self.locations[idx2]
            c1, c2 = np.mean(poly1, axis=0).astype(int), np.mean(poly2, axis=0).astype(int)
            radius = int((max([p[0] for p in poly1]) - min([p[0] for p in poly1])) / 4)
            color, label = colors[i], str(i + 1)
            font_scale = (radius * 1.5) / 22.0
            thickness = int(font_scale * 3)
            for c in [c1, c2]:
                cv2.circle(img, tuple(c), radius, color, -1)
                ts = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)[0]
                cv2.putText(img, label, (c[0]-ts[0]//2, c[1]+ts[1]//2), cv2.FONT_HERSHEY_SIMPLEX, font_scale, (0,0,0), thickness+4)
                cv2.putText(img, label, (c[0]-ts[0]//2, c[1]+ts[1]//2), cv2.FONT_HERSHEY_SIMPLEX, font_scale, (255,255,255), thickness)
        cv2.imwrite(output_path, img)

    def find_pairs(self) -> List[Tuple[int, int]]:
        pairs, matched_indices = [], set()
        indices = sorted(self.card_faces.keys())
        processed_faces = {}
        for idx in indices:
            gray = cv2.cvtColor(self.card_faces[idx], cv2.COLOR_BGR2GRAY)
            gray = cv2.equalizeHist(cv2.resize(gray, (64, 64)))
            processed_faces[idx] = gray
        scores = []
        for i in range(len(indices)):
            for j in range(i + 1, len(indices)):
                idx1, idx2 = indices[i], indices[j]
                score = cv2.matchTemplate(processed_faces[idx1], processed_faces[idx2], cv2.TM_CCOEFF_NORMED)[0][0]
                scores.append((score, idx1, idx2))
                if (idx1 == 6 and idx2 == 19) or (idx1 == 19 and idx2 == 6):
                    print("DEBUG: Score for pair (6, 19): " + f"{score:.4f}")
                if (idx1 == 3 and idx2 == 11) or (idx1 == 11 and idx2 == 3):
                    print("DEBUG: Score for pair (3, 11): " + f"{score:.4f}")
        scores.sort(key=lambda x: x[0], reverse=True)
        # Greedy selection
        print("DEBUG: Starting greedy selection with " + str(len(indices)) + " indices.")
        for score, idx1, idx2 in scores:
            if idx1 in matched_indices or idx2 in matched_indices:
                continue
                
            # Only accept if correlation is high enough
            if score > 0.4: 
                pairs.append((idx1, idx2))
                matched_indices.add(idx1)
                matched_indices.add(idx2)
                print("DEBUG: Matched (" + str(idx1) + ", " + str(idx2) + ") with score " + f"{score:.4f}. Total pairs: " + str(len(pairs)))
            
            if len(pairs) == 12:
                print("DEBUG: Found all 12 pairs.")
                break
                
        if len(pairs) < 12:
            unmatched = set(indices) - matched_indices
            print("Warning: Only found " + str(len(pairs)) + " pairs. Unmatched: " + str(unmatched))
            print("DEBUG: Matched indices: " + str(sorted(list(matched_indices))))
            
        return pairs

    def save_pairs(self, pairs: List[Tuple[int, int]], filepath: str):
        with open(filepath, 'w') as f: json.dump(pairs, f, indent=2)
        print("Saved " + str(len(pairs)) + " pairs to " + filepath)

if __name__ == "__main__":
    locations_path, video_path, template_path = "card_locations.json", "7kMinigames/Minigames_entry.mp4", "7kMinigames/BackCard.png"
    if os.path.exists(locations_path):
        solver = CardSolver(locations_path, video_path, template_path)
        solver.process_video_end_to_end(threshold=0.6)
        pairs = solver.find_pairs()
        solver.save_pairs(pairs, "card_pairs.json")

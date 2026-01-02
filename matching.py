import cv2
import numpy as np
from typing import List, Tuple, Union

def find_matches(source: Union[str, np.ndarray], template: Union[str, np.ndarray], threshold: float = 0.8) -> List[List[Tuple[int, int]]]:
    """
    Finds all occurrences of the template in the source image.
    
    Args:
        source: Path to the source image or numpy array.
        template: Path to the template image or numpy array.
        threshold: Matching threshold (0.0 to 1.0).
        
    Returns:
        A list of polygons, where each polygon is a list of (x, y) tuples 
        representing the corners of the matching rectangle:
        [top-left, top-right, bottom-right, bottom-left]
    """
    
    # Load images if paths are provided
    if isinstance(source, str):
        img_rgb = cv2.imread(source)
        if img_rgb is None:
            raise ValueError(f"Could not load source image: {source}")
    else:
        img_rgb = source

    if isinstance(template, str):
        template_img = cv2.imread(template)
        if template_img is None:
            raise ValueError(f"Could not load template image: {template}")
    else:
        template_img = template

    # Convert to grayscale for template matching
    img_gray = cv2.cvtColor(img_rgb, cv2.COLOR_BGR2GRAY)
    template_gray = cv2.cvtColor(template_img, cv2.COLOR_BGR2GRAY)
    
    w, h = template_gray.shape[::-1]

    # Perform template matching
    res = cv2.matchTemplate(img_gray, template_gray, cv2.TM_CCOEFF_NORMED)
    
    # Find locations where the match quality is greater than threshold
    loc = np.where(res >= threshold)
    
    polygons = []
    # zip(*loc[::-1]) iterates through (x, y) coordinates
    # We need to filter out duplicate matches that are too close to each other (non-maximum suppression)
    # But for a simple start, let's just return all points above threshold.
    # Actually, raw template matching often returns a cluster of points for a single object.
    # We should probably do some basic suppression or just return the raw rectangles if the user wants "all locations".
    # Given the request "detect all location", raw matches might be too many.
    # Let's use a simple distance check to avoid duplicates.
    
    matches = []
    for pt in zip(*loc[::-1]):
        matches.append(pt)

    # Simple non-maximum suppression (greedy)
    # Sort by score if we had it, but we just have locations.
    # Let's just iterate and ignore points close to already found ones.
    
    unique_matches = []
    min_dist = min(w, h) / 2 # Heuristic: matches shouldn't overlap more than half? 
                             # Actually, for cards, they might overlap. 
                             # But "exact same match" shouldn't be reported multiple times.
                             # Let's just return the raw locations for now as requested, 
                             # but maybe group them if they are literally 1 pixel apart?
                             # Standard approach: cv2.groupRectangles
    
    # Custom Non-Maximum Suppression (NMS)
    # We have a list of (x, y) locations. We want to keep only distinct matches.
    # Since we know the card size (w, h), we can ignore matches that are too close to existing ones.
    
    matches_locs = []
    for pt in zip(*loc[::-1]):
        matches_locs.append((int(pt[0]), int(pt[1])))
        
    # If we had scores, we should sort by score. 
    # cv2.matchTemplate returns scores in 'res'.
    # Let's get the scores for each point.
    scored_matches = []
    for pt in matches_locs:
        score = res[pt[1], pt[0]]
        scored_matches.append((pt, score))
        
    # Sort by score descending
    scored_matches.sort(key=lambda x: x[1], reverse=True)
    
    final_matches = []
    min_dist_sq = (w * 0.5) ** 2 + (h * 0.5) ** 2 # Minimum distance squared (heuristic: half diagonal)
    
    for (pt, score) in scored_matches:
        is_new = True
        for existing_pt in final_matches:
            dist_sq = (pt[0] - existing_pt[0]) ** 2 + (pt[1] - existing_pt[1]) ** 2
            if dist_sq < min_dist_sq:
                is_new = False
                break
        if is_new:
            final_matches.append(pt)
            
    print(f"DEBUG: Reduced {len(matches_locs)} raw matches to {len(final_matches)} distinct matches.")
    
    polygons = []
    for (x, y) in final_matches:
        # Define polygon: top-left, top-right, bottom-right, bottom-left
        polygon = [
            (x, y),
            (x + w, y),
            (x + w, y + h),
            (x, y + h)
        ]
        polygons.append(polygon)
        
    return polygons

import json
import os

def save_locations_to_json(locations: List[List[Tuple[int, int]]], filepath: str):
    """Saves the list of polygons to a JSON file."""
    try:
        # Convert numpy types to native python types for JSON serialization
        serializable_locations = []
        for poly in locations:
            serializable_poly = []
            for point in poly:
                serializable_poly.append((int(point[0]), int(point[1])))
            serializable_locations.append(serializable_poly)
            
        with open(filepath, 'w') as f:
            json.dump(serializable_locations, f, indent=2)
        print(f"Saved {len(locations)} locations to {filepath}")
    except Exception as e:
        print(f"Error saving locations to JSON: {e}")

def load_locations_from_json(filepath: str) -> List[List[Tuple[int, int]]]:
    """Loads the list of polygons from a JSON file."""
    try:
        with open(filepath, 'r') as f:
            locations = json.load(f)
        # Convert lists back to tuples for consistency if needed, though lists are fine for cv2
        # JSON loads tuples as lists.
        print(f"Loaded {len(locations)} locations from {filepath}")
        return locations
    except Exception as e:
        print(f"Error loading locations from JSON: {e}")
        return []

def visualize_matches(source: Union[str, np.ndarray], polygons: List[List[Tuple[int, int]]], output_path: str):
    """Draws red borders around detected polygons and saves the image."""
    if isinstance(source, str):
        img = cv2.imread(source)
        if img is None:
            print(f"Error: Could not load source image for visualization: {source}")
            return
    else:
        img = source.copy()

    for poly in polygons:
        # poly is a list of points (x, y). cv2.polylines expects numpy array of shape (pts, 1, 2)
        pts = np.array(poly, np.int32)
        pts = pts.reshape((-1, 1, 2))
        cv2.polylines(img, [pts], True, (0, 0, 255), 2) # Red color, thickness 2

    cv2.imwrite(output_path, img)
    print(f"Saved visualization to {output_path}")

def get_matches_from_video(video_path: str, template_path: str) -> Tuple[List[List[Tuple[int, int]]], np.ndarray]:
    """Scans video for matches and returns them along with the frame where they were found."""
    print(f"Scanning video: {video_path}")
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print("Error: Could not open video.")
        return [], None

    # Read a few frames to find one with the card
    frame_count = 0
    matches = []
    found_frame = None
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
            
        # Check every 30th frame to speed up
        if frame_count % 30 == 0:
            current_matches = find_matches(frame, template_path, threshold=0.8)
            if current_matches:
                print(f"Frame {frame_count}: Found {len(current_matches)} matches.")
                matches = current_matches
                found_frame = frame
                break
        
        frame_count += 1
        
    cap.release()
    return matches, found_frame

if __name__ == "__main__":
    template_path = "7kMinigames/BackCard.png"
    # User requested to use the static image containing all cards
    image_path = "7kMinigames/card_all.png"
    json_path = "card_locations.json"
    vis_path = "marked_location.png"
    
    locations = []
    frame_for_vis = None

    # We want to refresh the cache from this image, or load if it matches?
    # The user said "extract all 24 locations and save it", implying we should run detection now.
    # To be safe, let's force detection if we are switching sources, or just check if json exists.
    # But since we changed the source, the old json (from video) might be slightly different or valid.
    # Let's assume we want to regenerate it from this perfect image.
    
    if os.path.exists(image_path):
        print(f"Loading source image: {image_path}")
        frame_for_vis = cv2.imread(image_path)
        if frame_for_vis is None:
             print("Error: Could not load source image.")
        else:
             print("Detecting matches in source image...")
             locations = find_matches(frame_for_vis, template_path, threshold=0.8)
             print(f"Found {len(locations)} matches.")
             
             if locations:
                 save_locations_to_json(locations, json_path)
    else:
        print(f"Error: Source image not found at {image_path}")

    if locations and frame_for_vis is not None:
        visualize_matches(frame_for_vis, locations, vis_path)
    elif not locations:
        print("No matches found to visualize.")

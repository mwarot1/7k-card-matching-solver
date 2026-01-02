import cv2
import numpy as np
import os
import glob

def test_matching():
    debug_dir = "debug_faces"
    if not os.path.exists(debug_dir):
        print("Debug directory not found.")
        return

    # Load all faces
    faces = {}
    files = glob.glob(os.path.join(debug_dir, "face_*.png"))
    for f in files:
        # Extract index from filename "face_12.png"
        try:
            idx = int(os.path.basename(f).split('_')[1].split('.')[0])
            faces[idx] = cv2.imread(f)
        except:
            pass

    print(f"Loaded {len(faces)} faces.")
    
    # Define the pairs we want to check specifically
    check_pairs = [(1, 22), (10, 21)]
    
    target_size = (64, 64)

    for idx1, idx2 in check_pairs:
        if idx1 not in faces or idx2 not in faces:
            print(f"Skipping pair {idx1}-{idx2}: images not found.")
            continue
            
        img1 = faces[idx1]
        img2 = faces[idx2]
        
        gray1 = cv2.cvtColor(img1, cv2.COLOR_BGR2GRAY)
        gray2 = cv2.cvtColor(img2, cv2.COLOR_BGR2GRAY)
        
        g1 = cv2.resize(gray1, target_size)
        g2 = cv2.resize(gray2, target_size)
        
        # 1. Template Matching Score
        res = cv2.matchTemplate(g1, g2, cv2.TM_CCOEFF_NORMED)
        score_tm = res[0][0]
        
        # 2. Abs Diff Score (inverted, so higher is better for comparison)
        diff = cv2.absdiff(g1, g2)
        score_diff = 255 - np.mean(diff)
        
        print(f"\n--- Pair {idx1} vs {idx2} (User said CORRECT) ---")
        print(f"TM Score: {score_tm:.4f}")
        print(f"Diff Score: {score_diff:.2f}")
        
        # Find what the solver WOULD have picked for idx1
        best_tm_score = -1.0
        best_tm_idx = -1
        
        print(f"Top 3 matches for {idx1}:")
        all_scores = []
        for other_idx, other_img in faces.items():
            if other_idx == idx1: continue
            
            ogray = cv2.cvtColor(other_img, cv2.COLOR_BGR2GRAY)
            og = cv2.resize(ogray, target_size)
            
            res = cv2.matchTemplate(g1, og, cv2.TM_CCOEFF_NORMED)
            s = res[0][0]
            all_scores.append((s, other_idx))
            
        all_scores.sort(key=lambda x: x[0], reverse=True)
        
        for s, idx in all_scores[:3]:
            print(f"  -> {idx}: {s:.4f}")

if __name__ == "__main__":
    test_matching()

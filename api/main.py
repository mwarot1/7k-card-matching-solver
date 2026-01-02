from fastapi import FastAPI, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
import shutil
import os
import uuid
from typing import List, Dict
import cv2
import numpy as np
from solver import CardSolver

app = FastAPI(title="CardSolverV3 API")

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
if not os.path.exists(UPLOAD_DIR):
    os.makedirs(UPLOAD_DIR)

@app.get("/")
async def root():
    return {"message": "CardSolverV3 API is running"}

@app.post("/solve")
async def solve_video(file: UploadFile = File(...)):
    session_id = str(uuid.uuid4())
    file_path = os.path.join(UPLOAD_DIR, f"{session_id}_{file.filename}")
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    # Initialize solver
    # Note: We'll need to ensure templates are available to the API
    locations_path = "card_locations.json"
    template_path = "7kMinigames/BackCard.png"
    
    solver = CardSolver(locations_path, file_path, template_path)
    
    # Process video
    # We'll use a modified version of the video session for the API
    cap = cv2.VideoCapture(file_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    captured_frames = []
    frame_count = 0
    
    while True:
        ret, frame = cap.read()
        if not ret: break
        ts = frame_count / fps
        if ts > 8.0: break # Use the 8s limit
        h, w = frame.shape[:2]
        captured_frames.append((ts, frame, (0, 0, w, h)))
        frame_count += 1
    cap.release()

    # Solve logic
    solver.solve_frames(captured_frames, lambda x: print(f"API Progress: {x}"))
    pairs = solver.find_pairs()
    
    # Prepare results using images saved to debug_faces/
    import base64
    grid_faces = {}
    # base_dir should be the project root (parent of the api folder)
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    debug_faces_dir = os.path.join(base_dir, "debug_faces")
    
    for i in range(24):
        face_path = os.path.join(debug_faces_dir, f"face_{i}.png")
        if os.path.exists(face_path):
            with open(face_path, "rb") as f:
                encoded = base64.b64encode(f.read()).decode('utf-8')
                grid_faces[str(i)] = f"data:image/png;base64,{encoded}"
                print(f"DEBUG: Read face_{i}.png from disk")
        else:
            grid_faces[str(i)] = None

    print(f"DEBUG: Total grid_faces populated from disk: {len([f for f in grid_faces.values() if f is not None])}")

    # Convert pairs (tuples) to lists for clean JSON serialization
    json_pairs = [[int(p[0]), int(p[1])] for p in pairs]

    # Cleanup file
    os.remove(file_path)
    
    return {
        "session_id": session_id,
        "pairs_count": len(json_pairs),
        "pairs": json_pairs,
        "grid_faces": grid_faces,
        "status": "success" if len(json_pairs) == 12 else "partial"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

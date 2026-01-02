import cv2
import os
import time
from solver import CardSolver, FrameBuffer

def test_video(video_path):
    print(f"Testing solver with video: {video_path}")
    if not os.path.exists(video_path):
        print(f"Video not found: {video_path}")
        return

    locations_path = "card_locations.json"
    video_path_placeholder = r"c:\Users\mwaro\OneDrive\Documents\Code\7kMinigames\Migames_changing_aspect_ratio.mp4"
    template_path = r"c:\Users\mwaro\OneDrive\Documents\Code\7kMinigames\BackCard.png"
    
    solver = CardSolver(locations_path, video_path_placeholder, template_path)
    # Load templates
    solver.back_card = cv2.imread(r"c:\Users\mwaro\OneDrive\Documents\Code\7kMinigames\BackCard.png")
    if solver.back_card is None:
        print("Could not load BackCard.png")
        return
    solver.back_card_gray = cv2.cvtColor(solver.back_card, cv2.COLOR_BGR2GRAY)
    
    # Run video session
    solver.solve_video_session(video_path)

if __name__ == "__main__":
    video_path = r"c:\Users\mwaro\OneDrive\Documents\Code\7kMinigames\Migames_changing_aspect_ratio.mp4"
    test_video(video_path)

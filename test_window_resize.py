"""
Test to demonstrate that the current solver does NOT work with different window sizes.
This mock shows what happens when the game window is resized.
"""
import cv2
import numpy as np
import json
from matching import load_locations_from_json

def create_mock_game_frame(width, height, card_locations):
    """Create a mock game frame with cards at specified locations."""
    frame = np.zeros((height, width, 3), dtype=np.uint8)
    
    # Draw background
    frame[:] = (40, 40, 40)
    
    # Draw cards at the specified locations
    card_count = 0
    for i, poly in enumerate(card_locations):
        try:
            xs = [p[0] for p in poly]
            ys = [p[1] for p in poly]
            x_min, x_max = int(min(xs)), int(max(xs))
            y_min, y_max = int(min(ys)), int(max(ys))
            
            # Check if card is within frame bounds
            if x_min >= 0 and y_min >= 0 and x_max <= width and y_max <= height:
                # Draw card (blue rectangle)
                cv2.rectangle(frame, (x_min, y_min), (x_max, y_max), (200, 150, 100), -1)
                cv2.rectangle(frame, (x_min, y_min), (x_max, y_max), (255, 255, 255), 2)
                # Draw card number
                cv2.putText(frame, str(i+1), (x_min+10, y_min+30), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
                card_count += 1
            else:
                # Card is out of bounds - draw red X
                cv2.line(frame, (x_min, y_min), (x_max, y_max), (0, 0, 255), 3)
                cv2.line(frame, (x_max, y_min), (x_min, y_max), (0, 0, 255), 3)
        except:
            pass
    
    return frame, card_count

def test_multiple_resolutions():
    """Test how the solver handles different window sizes."""
    print("Testing Card Solver with Different Window Sizes")
    print("=" * 60)
    
    # Load the original card locations (calibrated for original size)
    locations = load_locations_from_json("card_locations.json")
    print(f"Loaded {len(locations)} card locations from JSON\n")
    
    # Test different resolutions
    test_sizes = [
        (2560, 1392, "Original Size (2560x1392)"),
        (1920, 1080, "Smaller Window (1920x1080)"),
        (3840, 2160, "Larger Window (3840x2160)"),
        (1280, 720, "Much Smaller (1280x720)"),
    ]
    
    for width, height, description in test_sizes:
        frame, visible_cards = create_mock_game_frame(width, height, locations)
        
        print(f"{description}:")
        print(f"  Resolution: {width}x{height}")
        print(f"  Cards visible: {visible_cards}/24")
        
        if visible_cards == 24:
            print(f"  Status: ✅ ALL CARDS VISIBLE - Solver will work!")
        elif visible_cards >= 12:
            print(f"  Status: ⚠️  PARTIAL - Some cards out of bounds")
        else:
            print(f"  Status: ❌ FAILED - Most cards out of bounds")
        
        # Save mock frame
        filename = f"mock_test_{width}x{height}.png"
        cv2.imwrite(filename, frame)
        print(f"  Saved: {filename}\n")
    
    print("=" * 60)
    print("\nCONCLUSION:")
    print("The current solver uses FIXED card locations from card_locations.json")
    print("It will ONLY work at the original calibration resolution (2560x1392)")
    print("To support any window size, you need DYNAMIC CALIBRATION.")
    print("\nCheck the generated mock_test_*.png files to see the difference!")

if __name__ == "__main__":
    test_multiple_resolutions()

import cv2
import json
from pathlib import Path

# Read the pairs
with open('card_pairs.json', 'r') as f:
    pairs = json.load(f)

# Create output directory
output_dir = Path('reference_faces_64x64')
output_dir.mkdir(exist_ok=True)

# For each pair, take the first card index as the reference
for pair_idx, (card1, card2) in enumerate(pairs, start=1):
    # Use the first card in the pair as the reference
    reference_idx = card1
    
    # Read the face image
    face_path = f'debug_faces/face_{reference_idx}.png'
    img = cv2.imread(face_path)
    
    if img is None:
        print(f'Warning: Could not read {face_path}')
        continue
    
    # Resize to 128x128
    resized = cv2.resize(img, (128, 128), interpolation=cv2.INTER_AREA)
    
    # Save with card type number (1-12)
    output_path = output_dir / f'card_{pair_idx}.png'
    cv2.imwrite(str(output_path), resized)
    print(f'Saved card_{pair_idx}.png (from face_{reference_idx}.png)')

print(f'\nCreated {len(pairs)} reference templates in {output_dir}/')
print('\nCard mapping:')
for pair_idx, (card1, card2) in enumerate(pairs, start=1):
    print(f'  Card Type {pair_idx}: positions {card1}, {card2}')
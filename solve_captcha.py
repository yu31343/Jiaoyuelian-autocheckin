import cv2
import numpy as np
import sys
import base64
import json
from io import BytesIO
from PIL import Image

def find_gap_position(bg_base64, jigsaw_base64):
    # Decode Base64 strings to image data
    try:
        bg_data = base64.b64decode(bg_base64)
        jigsaw_data = base64.b64decode(jigsaw_base64)
    except Exception as e:
        raise ValueError(f"Base64 decoding failed: {e}")

    # Use Pillow to open the image data
    try:
        bg_pil = Image.open(BytesIO(bg_data))
        jigsaw_pil = Image.open(BytesIO(jigsaw_data))
    except Exception as e:
        raise IOError(f"Pillow could not open image data: {e}")

    # Convert Pillow image to OpenCV format
    bg_img = cv2.cvtColor(np.array(bg_pil), cv2.COLOR_RGB2BGR)
    jigsaw_img = cv2.cvtColor(np.array(jigsaw_pil), cv2.COLOR_RGBA2BGRA) # Keep alpha channel

    # --- Start of new algorithm ---

    # 1. Process Jigsaw (Slider) Image
    # Use the alpha channel to create a mask for the jigsaw piece
    jigsaw_gray = cv2.cvtColor(jigsaw_img, cv2.COLOR_BGRA2GRAY)
    _, jigsaw_mask = cv2.threshold(jigsaw_gray, 1, 255, cv2.THRESH_BINARY)
    # Find contours of the jigsaw piece
    contours, _ = cv2.findContours(jigsaw_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise ValueError("Could not find contours in jigsaw image.")
    jigsaw_contour = contours[0]

    # 2. Process Background Image
    # Apply Canny edge detection to the background image
    bg_gray = cv2.cvtColor(bg_img, cv2.COLOR_BGR2GRAY)
    bg_edges = cv2.Canny(bg_gray, 100, 200)

    # 3. Find the Gap in the Background
    # Find contours in the edged background
    contours, _ = cv2.findContours(bg_edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise ValueError("Could not find any contours in the background image.")

    # 4. Match Jigsaw Contour to Background Contours
    # Iterate through background contours and find the one that best matches the jigsaw contour
    best_match_score = float('inf')
    best_match_contour = None
    for contour in contours:
        # cv2.matchShapes returns a score, lower is better
        match_score = cv2.matchShapes(jigsaw_contour, contour, cv2.CONTOURS_MATCH_I1, 0.0)
        if match_score < best_match_score:
            best_match_score = match_score
            best_match_contour = contour
    
    if best_match_contour is None:
        raise ValueError("Could not find a matching contour in the background.")

    # 5. Calculate the Offset
    # The offset is the x-coordinate of the bounding box of the best matching contour
    x, _, _, _ = cv2.boundingRect(best_match_contour)
    
    # This is a common adjustment needed because the contour found is the gap itself.
    # The slider needs to be moved to the left edge of the gap.
    # Sometimes a small calibration is needed. We start with a small deduction.
    return x - 6

if __name__ == '__main__':
    try:
        # Read data from stdin
        input_data = sys.stdin.read()
        data = json.loads(input_data)
        
        bg_base64_arg = data['background']
        jigsaw_base64_arg = data['jigsaw']

        offset = find_gap_position(bg_base64_arg, jigsaw_base64_arg)
        print(offset)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

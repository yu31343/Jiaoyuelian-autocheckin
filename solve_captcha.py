import cv2
import numpy as np
import sys
import requests
from io import BytesIO
from PIL import Image

def remove_black_border(img):
    # Convert PIL Image to OpenCV format
    img_cv = np.array(img)
    img_cv = cv2.cvtColor(img_cv, cv2.COLOR_RGB2BGR)

    gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 1, 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    if not contours:
        return img_cv # Return original if no contours found

    x, y, w, h = cv2.boundingRect(contours[0])
    cropped_img = img_cv[y:y+h, x:x+w]
    return cropped_img

def find_gap_position(bg_img_path, jigsaw_img_path):
    # Load images using OpenCV
    bg_img_cv = cv2.imread(bg_img_path)
    jigsaw_img_cv = cv2.imread(jigsaw_img_path)

    if bg_img_cv is None:
        raise FileNotFoundError(f"Background image not found at {bg_img_path}")
    if jigsaw_img_cv is None:
        raise FileNotFoundError(f"Jigsaw image not found at {jigsaw_img_path}")

    # Convert to grayscale
    bg_gray = cv2.cvtColor(bg_img_cv, cv2.COLOR_BGR2GRAY)
    jigsaw_gray = cv2.cvtColor(jigsaw_img_cv, cv2.COLOR_BGR2GRAY)

    # Remove black border from jigsaw (if any)
    jigsaw_cropped = remove_black_border(jigsaw_img_cv)
    jigsaw_gray_cropped = cv2.cvtColor(jigsaw_cropped, cv2.COLOR_BGR2GRAY)

    # Perform template matching
    # Use TM_CCOEFF_NORMED for better results with varying lighting
    result = cv2.matchTemplate(bg_gray, jigsaw_gray_cropped, cv2.TM_CCOEFF_NORMED)
    
    # Find the best match location
    min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(result)
    
    # The x-coordinate of the top-left corner of the best match
    # We need the x-coordinate of the gap, which is where the jigsaw piece fits
    # The template matching finds where the jigsaw *is* in the background.
    # The actual gap is usually to the left of the matched jigsaw piece.
    # This might require some calibration based on the specific captcha.
    # For now, let's assume the x-coordinate of the match is the offset.
    x_offset = max_loc[0]
    
    return x_offset

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("Usage: python solve_captcha.py <background_image_path> <jigsaw_image_path>")
        sys.exit(1)

    bg_path = sys.argv[1]
    jigsaw_path = sys.argv[2]

    try:
        offset = find_gap_position(bg_path, jigsaw_path)
        print(offset)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

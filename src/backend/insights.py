from typing import Dict, List, Any, Optional, Union
import cv2
import numpy as np
import logging

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def compute_histograms(masks_dict: Dict[int, np.ndarray], file_path: str = None, convert_to_monochrome: bool = False) -> Dict[str, Any]:
    """
    Compute histograms and other insights from the masks dictionary.
    
    Args:
        masks_dict: Dictionary mapping frame indices to mask arrays.
                   Each mask is a numpy array of shape (C, H, W) where:
                   - C is the number of channels (objects)
                   - H is the height
                   - W is the width
                   The masks are of type uint8, with values 0 and 1,
                   where 1 means the pixel is part of the mask.
        file_path: Path to the video file.
        convert_to_monochrome: Whether to convert the frame to monochrome.
    Returns:
        Dictionary with keys:
         - "histograms": mapping of frame indices to histograms of all objects in that frame.
           - Each histogram is a 2D array of shape [N, C, 256], representing the number of pixels
             that fall into each of 256 bins. For monochrome images, N = 1. For RGB images, N = 3.
         - "bin_edges": common to all histograms, bin edges for the intensity values. An array of shape [N, 257].
    """
    logger.debug(f"Computing histograms for {len(masks_dict)} frames")
    logger.debug(f"File path: {file_path}")
    
    # Open the video file
    cap = cv2.VideoCapture(file_path)
    if not cap.isOpened():
        logger.error(f"Failed to open video file: {file_path}")
        return {"histograms": {}, "bin_edges": None}
    
    bin_edges = np.arange(257)
    # Initialize the result dictionary
    result = {
        "histograms": {},
        "bin_edges": bin_edges.reshape(1, 257).repeat(3, axis=0)
    }
    
    # Process each frame
    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if len(frame.shape) == 2:
            frame = frame[:, :, np.newaxis]
        
        if convert_to_monochrome:
            frame = _convert_to_monochrome(frame)
        # frame.shape = (H, W, 1)
        
        # Check if this frame has a corresponding mask
        if frame_idx in masks_dict:
            # Get the mask for this frame
            mask = masks_dict[frame_idx]

            # Get the number of objects in the mask
            num_objects = mask.shape[0]
            
            # Initialize histograms for this frame
            frame_histograms = np.zeros((frame.shape[2], num_objects, 256), dtype=np.int32)
            
            # For each channel in the mask (each object)
            for obj_idx in range(mask.shape[0]):
                # Get the binary mask for this object
                obj_mask = mask[obj_idx]
                
                # Apply the mask to the frame (resulting in unraveled values)
                object_pixels = frame[obj_mask>0]
                # object_pixels.shape = (num_pixels_in_the_object, 3)

                # Calculate histograms for each color channel
                for channel in range(object_pixels.shape[1]):  # BGR channels
                    hist, _ = np.histogram(object_pixels[:, channel], bins=bin_edges)
                    frame_histograms[channel, obj_idx] = hist
            
            # Store the histograms for this frame
            result["histograms"][frame_idx] = frame_histograms
        
        frame_idx += 1
    
    # Release the video capture
    cap.release()
    
    logger.debug(f"Computed histograms for {len(result['histograms'])} frames")
    return result

def _convert_to_monochrome(frame: np.ndarray) -> np.ndarray:
    """
    Convert a frame to monochrome.

    Args:
        frame: The frame to convert to monochrome. Could be of shape [H, W, 3], [H, W, 1], or [H, W].
    Returns:
        The monochrome frame. Shape is [H, W, 1].
    """
    if len(frame.shape) == 2:
        return frame[:, :, np.newaxis]
    
    if frame.shape[2] == 3:
        return cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)[:, :, np.newaxis]
    elif frame.shape[2] == 1:
        logger.warning("Frame is already monochrome")
        return frame

    raise ValueError(f"Frame shape {frame.shape} is not supported")

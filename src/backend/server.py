import os
import json
import asyncio
import aiohttp
import aiofiles
import numpy as np
import cv2
from aiohttp import web
from pathlib import Path
from datetime import datetime
import logging
from typing import Dict, List, Any, Optional, TypedDict
import torch
from sam2.build_sam import build_sam2_video_predictor
import base64

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

DEBUG = True

# Constants
BASE_DIR = Path(__file__).parent.parent.parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "videos"
MASKS_DIR = DATA_DIR / "masks"
MODEL_DIR = DATA_DIR / "models"

# SAM2 model configuration
MODEL_CONFIG = "configs/sam2.1/sam2.1_hiera_l.yaml"  # internal to sam2 package, do not change
MODEL_CHECKPOINT = MODEL_DIR /"sam2.1_hiera_large.pt"

# Ensure directories exist
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MASKS_DIR.mkdir(parents=True, exist_ok=True)
MODEL_DIR.mkdir(parents=True, exist_ok=True)

# Global variables
sam2_predictor = None
video_cache = {}
inference_state = None

class PromptPoint(TypedDict):
    x: float
    y: float
    label: int

# Initialize SAM2 model
async def init_sam2():
    """Initialize the SAM2 model"""
    global sam2_predictor
    try:
        sam2_predictor = build_sam2_video_predictor(
            MODEL_CONFIG, MODEL_CHECKPOINT, device="cuda" if torch.cuda.is_available() else "cpu"
        )
        return True
    except Exception as e:
        logger.error(f"Error initializing SAM2: {e}")
        return False

# Process frame with prompts
async def process_frame_with_prompts(frame_idx: int, prompts: List[PromptPoint]) -> np.ndarray:
    """
    Process a frame with the given prompts using SAM2.

    This function is utilized when user is prompting. It is invoked on each prompt-point placement the user makes.
    It returns the mask of the frame with the prompt-points applied by the SAM2 model. The user then can see this mask
    to see the model's prediction for the mask of the current frame.
    Later, when the user is done prompting, the server will process the entire video with the given prompts and
    return masks for all frames, but this function will not be used then.
    
    Args:
        frame_idx: Index of the frame to process
        prompts: List of prompt points with x, y coordinates and label
        
    Returns:
        numpy array of the mask of shape (C, H, W)
    """
    global sam2_predictor
    
    if sam2_predictor is None:
        raise RuntimeError("SAM2 model not initialized")
    
    try:
        if DEBUG:
            logger.debug("\n=== Starting Video Processing ===")
            logger.debug(f"\nProcessing frame {frame_idx}:")
            
        # Prepare points and labels
        points = []
        labels = []
        
        points.append([prompts["x"], prompts["y"]])
        labels.append(prompts["label"])
        
        if DEBUG:
            logger.debug(f"Processing {len(points)} points:")
            for i, (point, label) in enumerate(zip(points, labels)):
                logger.debug(f"  Point {i + 1}: ({point[0]:.2f}, {point[1]:.2f}) - {'Positive' if label > 0 else 'Negative'}")
        
        # Convert to numpy arrays
        points = np.array(points)
        labels = np.array(labels)
        
        masks_frame = None
        # Process frame with SAM2
        if len(points) > 0:            
            if DEBUG:
                logger.debug(f"Calling SAM2 model with {len(points)} points")
            
            # Add points to the model
            processed_frame_idx, obj_ids, masks_frame = sam2_predictor.add_new_points_or_box(
                inference_state=inference_state,
                frame_idx=frame_idx,
                obj_id=None,
                points=points,
                labels=labels,
                clear_old_points=True
            )
            if processed_frame_idx != frame_idx:
                logger.warning(f"Frame index mismatch: {processed_frame_idx} != {frame_idx}")
            
            if DEBUG:
                logger.debug(f"Generated mask for frame {processed_frame_idx}")
                if masks_frame is not None:
                    logger.debug(f"Mask shape: {masks_frame.shape}")
            
        # Store mask directly as returned by SAM2
        if masks_frame is not None:
            masks_frame = masks_frame.detach().cpu().numpy()
            masks_frame = masks_frame[0]  # Remove batch dimension
            masks_frame = (masks_frame > 0).astype(np.uint8)

        if DEBUG:
            logger.debug("\n=== Processing Complete ===")
            logger.debug(f"Masks shape: {masks_frame.shape}")
        
        return masks_frame
    
    except Exception as e:
        logger.error(f"Error processing video: {e}")
        raise

# API Routes
async def handle_upload(request):
    """Handle video upload"""
    global inference_state
    try:
        # Check if SAM2 is initialized
        if sam2_predictor is None:
            initialized = await init_sam2()
            if not initialized:
                return web.json_response({
                    "status": "error",
                    "message": "SAM2 model not initialized. Please check server logs for details."
                }, status=500)
        
        # Check if the request has a video file
        if not request.content_type or not request.content_type.startswith('multipart/form-data'):
            return web.json_response({"status": "error", "message": "No video file provided"}, status=400)
        
        # Get the video file
        reader = await request.multipart()
        field = await reader.next()
        
        if field.name != 'file':
            return web.json_response({"status": "error", "message": "No video field found"}, status=400)
        
        # Read the file
        filename = field.filename
        if not filename:
            return web.json_response({"status": "error", "message": "No filename provided"}, status=400)
        
        # Generate a unique filename
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        unique_filename = f"{timestamp}_{filename}"
        file_path = UPLOAD_DIR / unique_filename
        
        # Save the file
        size = 0
        async with aiofiles.open(file_path, 'wb') as f:
            while True:
                chunk = await field.read_chunk()
                if not chunk:
                    break
                size += len(chunk)
                await f.write(chunk)
        
        # Get video properties using OpenCV
        cap = cv2.VideoCapture(str(file_path))
        if not cap.isOpened():
            return web.json_response({"status": "error", "message": "Could not open video file"}, status=400)
        
        # Get video properties
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        
        # Release the video capture
        cap.release()
        
        # Initialize inference state with the video
        try:
            inference_state = sam2_predictor.init_state(
                str(file_path),
                offload_video_to_cpu=True,  # Save GPU memory
                offload_state_to_cpu=True   # Save GPU memory
            )
            
            # Cache video info using the unique filename
            video_cache[unique_filename] = {
                "path": str(file_path),
                "frames": total_frames,
                "fps": fps,
                "width": width,
                "height": height
            }
            
            return web.json_response({
                "status": "success",
                "filename": unique_filename,  # Return the unique filename to the client
                "frames": total_frames,
                "fps": fps,
                "width": width,
                "height": height
            })
        except Exception as e:
            logger.error(f"Error initializing inference state: {e}")
            # Clean up the file if it was created
            if os.path.exists(file_path):
                os.remove(str(file_path))
            return web.json_response({"status": "error", "message": str(e)}, status=500)
    
    except Exception as e:
        logger.error(f"Error handling upload: {e}")
        # Clean up the file if it was created
        if 'file_path' in locals() and os.path.exists(file_path):
            os.remove(str(file_path))
        return web.json_response({"status": "error", "message": str(e)}, status=500)

async def process_video_with_prompts(sam2_predictor) -> List[tuple[int, np.ndarray]]:
    """Process all frames of the video with the prompts applied by the user so far.

    Args:
        sam2_predictor: The SAM2 predictor object, with proper state of prompts.
        
    Returns:
        Masks for all frames of shape (N, C, H, W), where:
            - N is the number of frames,
            - C is the number of channels,
            - H is the height,
            - W is the width.
        The masks are returned as a numpy array of type uint8, of values 0 and 1,
        where 1 means the pixel is part of the mask.
    """
    global inference_state
    
    if inference_state is None:
        raise RuntimeError("Inference state not initialized. Please upload a video first.")
    
    # propagate the prompts to get masklets throughout the video
    for frame_idx, object_ids, masks in sam2_predictor.propagate_in_video(
            inference_state=inference_state,
            start_frame_idx=0
        ):
        masks = masks.detach().cpu().numpy()
        masks = masks[0]  # Remove batch dimension
        masks = (masks > 0).astype(np.uint8)
        yield frame_idx, masks

async def handle_process_video(request):
    """Handle video processing with prompts applied by the user so far"""
    try:
        # Check if SAM2 is initialized
        if sam2_predictor is None:
            initialized = await init_sam2()
            if not initialized:
                return web.json_response({
                    "status": "error",
                    "message": "SAM2 model not initialized. Please check server logs for details."
                }, status=500)
                
        if DEBUG:
            logger.debug("=== Received Video Processing Request ===")
        
        # Process video with SAM2
        try:
            # Process video with prompts
            masks = []
            async for frame_idx, mask in process_video_with_prompts(sam2_predictor):
                masks.append(mask)
            masks = np.array(masks)
            
            if DEBUG:
                logger.debug("\n=== Processing Results ===")
                logger.debug(f"Generated masks for {len(masks)} frames, masks shape: {masks.shape}")
            
            # Save masks
            mask_path = MASKS_DIR / f"last_video_masks.json"
            async with aiofiles.open(mask_path, 'w') as f:
                await f.write(json.dumps({
                    'masks': masks.tolist()
                }))
            
            return web.json_response({
                "status": "success",
                "masks": masks.tolist()
            })
            
        except Exception as e:
            logger.error(f"Error processing video with SAM2: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return web.json_response({
                "status": "error",
                "message": f"Error processing video: {str(e)}"
            }, status=500)
            
    except Exception as e:
        logger.error(f"Error handling process video request: {e}")
        return web.json_response({
            "status": "error",
            "message": str(e)
        }, status=500)

async def handle_process_frame(request):
    """Handle processing a single frame with prompts"""
    try:
        # Check if SAM2 is initialized
        if sam2_predictor is None:
            initialized = await init_sam2()
            if not initialized:
                return web.json_response({
                    "status": "error",
                    "message": "SAM2 model not initialized. Please check server logs for details."
                }, status=500)
        
        # Parse request data
        data = await request.json()
        
        if 'frame_idx' not in data or 'prompts' not in data:
            return web.json_response({
                "status": "error",
                "message": "Missing required fields: frame_idx and prompts"
            }, status=400)
        
        frame_idx = data['frame_idx']
        prompts = data['prompts']
        
        if DEBUG:
            logger.debug(f"Processing frame {frame_idx} with prompts: {prompts}")
        
        # Process frame with prompts
        try:
            masks = await process_frame_with_prompts(frame_idx, prompts)
            
            return web.json_response({
                "status": "success",
                "masks": masks.tolist()
            })
        except Exception as e:
            logger.error(f"Error processing frame: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return web.json_response({
                "status": "error",
                "message": f"Error processing frame: {str(e)}"
            }, status=500)
    except Exception as e:
        logger.error(f"Error handling process frame request: {e}")
        return web.json_response({
            "status": "error",
            "message": str(e)
        }, status=500)

async def handle_root(request):
    """Serve the index.html file"""
    return web.FileResponse(BASE_DIR / "src" / "frontend" / "static" / "index.html")

# Create application
app = web.Application()

# Add routes
app.router.add_get('/', handle_root)  # Add root route
app.router.add_post('/upload', handle_upload)
app.router.add_post('/process-video', handle_process_video)
app.router.add_post('/process-frame', handle_process_frame)  # Use the new handler instead of the function directly

# Add static routes for different content types
app.router.add_static('/static', path=str(BASE_DIR / "src" / "frontend" / "static"))
app.router.add_static('/static/videos', path=str(UPLOAD_DIR))  # Serve videos from data/videos
app.router.add_static('/static/masks', path=str(MASKS_DIR))  # Serve masks from data/masks

async def startup(app):
    """Initialize the application on startup."""
    try:
        # Initialize SAM2 model
        initialized = await init_sam2()
        if not initialized:
            logger.warning("SAM2 model initialization failed. The model will be initialized on first use.")
    except Exception as e:
        logger.error(f"Error during startup: {e}")
        logger.warning("SAM2 model initialization failed. The model will be initialized on first use.")

app.on_startup.append(startup)

if __name__ == '__main__':
    web.run_app(app, host='0.0.0.0', port=8080) 
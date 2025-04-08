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
from typing import Dict, List, Any, Optional
import torch
from sam2.build_sam import build_sam2_video_predictor
import base64

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

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

# Process video with prompts
async def process_video_with_prompts(video_path: str, prompts: Dict[int, List[Dict[str, Any]]]) -> Dict[str, Any]:
    """
    Process a video with the given prompts using SAM2.
    
    Args:
        video_path: Path to the video file
        prompts: Dictionary mapping frame indices to lists of prompt points
        
    Returns:
        Dictionary containing mask data for each frame
    """
    global sam2_predictor
    
    if sam2_predictor is None:
        raise RuntimeError("SAM2 model not initialized")
    
    try:
        # Open the video
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Could not open video: {video_path}")
        
        # Get video properties
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        
        # Initialize SAM2 state
        inference_state = sam2_predictor.init_state(
            video_path,
            offload_video_to_cpu=True,  # Save GPU memory
            offload_state_to_cpu=True   # Save GPU memory
        )
        
        # Process each frame with prompts
        masks = {}
        
        # Sort frame indices to process in order
        frame_indices = sorted(prompts.keys())
        
        for frame_idx in frame_indices:
            # Set frame position - convert to float to avoid type error
            cap.set(cv2.CAP_PROP_POS_FRAMES, float(frame_idx))
            ret, frame = cap.read()
            
            if not ret:
                logger.warning(f"Could not read frame {frame_idx}")
                continue
            
            # Convert BGR to RGB
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            
            # Get prompts for this frame
            frame_prompts = prompts[frame_idx]
            
            # Prepare points and labels
            points = []
            labels = []
            
            for prompt in frame_prompts:
                points.append([prompt["x"], prompt["y"]])
                labels.append(prompt["label"])
            
            # Convert to numpy arrays
            points = np.array(points)
            labels = np.array(labels)
            
            # Process frame with SAM2
            if len(points) > 0:
                # Ensure frame_idx is an integer for the SAM2 model
                frame_idx_int = int(frame_idx)
                
                # Add points to the model
                frame_idx, obj_ids, masks_frame = sam2_predictor.add_new_points_or_box(
                    inference_state=inference_state,
                    frame_idx=frame_idx_int,
                    obj_id=None,
                    points=points,
                    labels=labels,
                    clear_old_points=True
                )
                
                # Store mask
                masks[frame_idx] = masks_frame.tolist()
        
        # Release video capture
        cap.release()
        
        return {
            "status": "success",
            "masks": masks,
            "total_frames": total_frames,
            "fps": fps,
            "width": width,
            "height": height
        }
    
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

async def handle_process_video(request):
    """Handle video processing with prompts"""
    try:
        # Check if SAM2 is initialized
        if sam2_predictor is None:
            initialized = await init_sam2()
            if not initialized:
                return web.json_response({
                    "status": "error",
                    "message": "SAM2 model not initialized. Please check server logs for details."
                }, status=500)
        
        # Get request data
        data = await request.json()
        filename = data.get('filename')
        prompts = data.get('prompts', {})
        
        if not filename:
            return web.json_response({"status": "error", "message": "No filename provided"}, status=400)
        
        # Get video info from cache
        video_info = video_cache.get(filename)
        if not video_info:
            return web.json_response({"status": "error", "message": "Video not found"}, status=404)
        
        # Process video with SAM2
        try:
            # Process video with prompts
            masks = await process_video_with_prompts(video_info['path'], prompts)
            
            # Save masks
            mask_path = MASKS_DIR / f"{filename}_masks.json"
            async with aiofiles.open(mask_path, 'w') as f:
                await f.write(json.dumps({
                    'masks': masks['masks'],
                    'total_frames': masks['total_frames'],
                    'fps': masks['fps'],
                    'width': masks['width'],
                    'height': masks['height']
                }))
            
            return web.json_response({
                "status": "success",
                "masks": masks['masks']
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

async def handle_get_masks(request):
    """Handle retrieving mask data"""
    try:
        # Get filename from path
        filename = request.match_info.get('filename')
        if not filename:
            return web.json_response({"status": "error", "message": "No filename provided"}, status=400)
        
        # Check if masks file exists
        mask_filename = f"{os.path.splitext(filename)[0]}_masks.json"
        mask_path = MASKS_DIR / mask_filename
        
        if not mask_path.exists():
            return web.json_response({"status": "error", "message": "Masks not found"}, status=404)
        
        # Read masks file
        async with aiofiles.open(mask_path, 'r') as f:
            content = await f.read()
            masks_data = json.loads(content)
        
        return web.json_response(masks_data)
    
    except Exception as e:
        logger.error(f"Error retrieving masks: {e}")
        return web.json_response({"status": "error", "message": str(e)}, status=500)

async def handle_root(request):
    """Serve the index.html file"""
    return web.FileResponse(BASE_DIR / "src" / "frontend" / "static" / "index.html")

# Create application
app = web.Application()

# Add routes
app.router.add_get('/', handle_root)  # Add root route
app.router.add_post('/upload', handle_upload)
app.router.add_post('/process-video', handle_process_video)
app.router.add_get('/get-masks/{filename}', handle_get_masks)

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
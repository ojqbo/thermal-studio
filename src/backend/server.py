import aiohttp
from aiohttp import web
import os
import logging
import json
from pathlib import Path
import numpy as np
from datetime import datetime
import cv2
import base64
import torch
from sam2.build_sam import build_sam2_video_predictor

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Constants
UPLOAD_DIR = Path('data/videos')
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Initialize SAM2 model
MODEL_CONFIG = "configs/sam2.1/sam2.1_hiera_l.yaml"
MODEL_CHECKPOINT = "data/models/sam2.1_hiera_large.pt"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# Global variables for SAM2
predictor = None
current_state = None

async def init_sam2():
    """Initialize the SAM2 model."""
    global predictor
    try:
        predictor = build_sam2_video_predictor(MODEL_CONFIG, MODEL_CHECKPOINT, device=DEVICE)
        logger.info("SAM2 model initialized successfully")
    except Exception as e:
        logger.error(f"Error initializing SAM2 model: {str(e)}")
        raise

# Routes
async def handle_root(request):
    return web.FileResponse('src/frontend/static/index.html')

async def handle_upload(request):
    try:
        reader = await request.multipart()
        field = await reader.next()
        
        if field.name != 'video':
            return web.Response(text='No video file provided', status=400)
            
        # Generate unique filename with timestamp
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"{timestamp}_{field.filename}"
        filepath = UPLOAD_DIR / filename
        
        # Save the video file
        with open(filepath, 'wb') as f:
            while True:
                chunk = await field.read_chunk()
                if not chunk:
                    break
                f.write(chunk)
        
        # Get video properties using OpenCV
        try:
            cap = cv2.VideoCapture(str(filepath))
            if not cap.isOpened():
                raise ValueError("Could not open video file")
                
            # Get video properties
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps = float(cap.get(cv2.CAP_PROP_FPS))
            num_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            
            cap.release()
            
            logger.info(f"Video loaded successfully: {filename}")
            logger.info(f"Video properties: {width}x{height}, {fps} fps, {num_frames} frames")
            
            # Initialize SAM2 if not already done
            if predictor is None:
                await init_sam2()
            
            # Initialize SAM2 state with the video
            with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
                current_state = predictor.init_state(str(filepath))
                
        except Exception as e:
            logger.error(f"Error loading video: {str(e)}")
            if 'cap' in locals():
                cap.release()
            filepath.unlink()  # Delete invalid video file
            return web.Response(text=f'Invalid video file: {str(e)}', status=400)
                
        return web.json_response({
            'status': 'success',
            'filename': filename,
            'frames': num_frames,
            'fps': fps,
            'width': width,
            'height': height
        })
    except Exception as e:
        logger.error(f"Error handling upload: {str(e)}")
        return web.Response(text=str(e), status=500)

async def handle_point_prompt(request):
    try:
        global predictor, current_state
        
        if predictor is None:
            await init_sam2()
        
        data = await request.json()
        video_path = UPLOAD_DIR / data.get('filename')
        
        if not video_path.exists():
            return web.Response(text='Video file not found', status=404)
            
        # Get point coordinates and frame number
        x = data.get('x')
        y = data.get('y')
        frame = data.get('frame')
        
        if None in (x, y, frame):
            return web.Response(text='Missing required parameters', status=400)
            
        # Initialize state if needed
        if current_state is None:
            with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
                current_state = predictor.init_state(str(video_path))
        
        # Process point with SAM2
        with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
            # Create point prompt
            point_prompt = {
                'points': np.array([[x, y]]),
                'labels': np.array([1])  # 1 for foreground
            }
            
            # Add point and get masks
            frame_idx, object_ids, masks = predictor.add_new_points_or_box(current_state, point_prompt)
            
            # Get the frame and apply masks
            frame = current_state['frames'][frame_idx]
            result = frame.copy()
            result[masks[0] > 0] = [255, 0, 0]  # Highlight segmented area in red
            
            # Convert result to base64
            _, buffer = cv2.imencode('.jpg', cv2.cvtColor(result, cv2.COLOR_RGB2BGR))
            frame_base64 = base64.b64encode(buffer).decode('utf-8')
            
            return web.json_response({
                'status': 'success',
                'frame': frame_idx,
                'point': {'x': x, 'y': y},
                'frame_data': frame_base64
            })
            
    except Exception as e:
        logger.error(f"Error handling point prompt: {str(e)}")
        return web.Response(text=str(e), status=500)

async def handle_frame_extraction(request):
    try:
        global predictor, current_state
        
        if predictor is None:
            await init_sam2()
        
        data = await request.json()
        video_path = UPLOAD_DIR / data.get('filename')
        
        if not video_path.exists():
            return web.Response(text='Video file not found', status=404)
            
        frame = data.get('frame')
        if frame is None:
            return web.Response(text='Missing frame parameter', status=400)
            
        # Initialize state if needed
        if current_state is None:
            with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
                current_state = predictor.init_state(str(video_path))
        
        # Get frame using OpenCV
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            return web.Response(text='Could not open video file', status=400)
            
        # Set frame position
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame)
        ret, frame_data = cap.read()
        cap.release()
        
        if not ret:
            return web.Response(text='Could not read frame', status=400)
            
        # Convert BGR to RGB
        frame_data = cv2.cvtColor(frame_data, cv2.COLOR_BGR2RGB)
        
        # Process frame with SAM2
        with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
            # Apply any existing masks
            if 'masks' in current_state and current_state['masks'] is not None:
                for mask in current_state['masks']:
                    frame_data[mask > 0] = [255, 0, 0]  # Highlight segmented areas in red
            
            # Convert frame to base64 for sending to frontend
            _, buffer = cv2.imencode('.jpg', cv2.cvtColor(frame_data, cv2.COLOR_RGB2BGR))
            frame_base64 = base64.b64encode(buffer).decode('utf-8')
            
            return web.json_response({
                'status': 'success',
                'frame': frame,
                'frame_data': frame_base64
            })
            
    except Exception as e:
        logger.error(f"Error handling frame extraction: {str(e)}")
        return web.Response(text=str(e), status=500)

# Create application
app = web.Application()

# Add routes
app.router.add_get('/', handle_root)  # Add root route handler
app.router.add_post('/upload', handle_upload)
app.router.add_post('/point-prompt', handle_point_prompt)
app.router.add_post('/frame-extraction', handle_frame_extraction)

# Serve static files
app.router.add_static('/static', 'src/frontend/static')

if __name__ == '__main__':
    # Development server settings
    web.run_app(
        app,
        host='0.0.0.0',
        port=8080,
        access_log=logging.getLogger('aiohttp.access'),
        access_log_format='%a %t "%r" %s %b "%{Referer}i" "%{User-Agent}i"'
    ) 
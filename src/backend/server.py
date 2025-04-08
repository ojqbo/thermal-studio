import aiohttp
from aiohttp import web
import os
import logging
import json
from pathlib import Path
import decord
import numpy as np
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Constants
UPLOAD_DIR = Path('data/videos')
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

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
        
        # Verify video can be opened with decord
        try:
            vr = decord.VideoReader(str(filepath))
            logger.info(f"Video loaded successfully: {filename}")
            logger.info(f"Video properties: {vr.shape}, {vr.fps} fps, {len(vr)} frames")
        except Exception as e:
            logger.error(f"Error loading video with decord: {str(e)}")
            filepath.unlink()  # Delete invalid video file
            return web.Response(text=f'Invalid video file: {str(e)}', status=400)
                
        return web.json_response({
            'status': 'success',
            'filename': filename,
            'frames': len(vr),
            'fps': float(vr.fps),
            'shape': vr.shape
        })
    except Exception as e:
        logger.error(f"Error handling upload: {str(e)}")
        return web.Response(text=str(e), status=500)

async def handle_point_prompt(request):
    try:
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
            
        # Load the specific frame
        vr = decord.VideoReader(str(video_path))
        frame_idx = int(frame * vr.fps)  # Convert time to frame index
        frame_idx = min(max(0, frame_idx), len(vr) - 1)  # Ensure valid frame index
        
        frame_data = vr[frame_idx].asnumpy()
        
        # TODO: Process point with SAM2 model
        # For now, return dummy response
        return web.json_response({
            'status': 'success',
            'frame': frame_idx,
            'point': {'x': x, 'y': y},
            'message': 'Point processed (dummy response)'
        })
        
    except Exception as e:
        logger.error(f"Error handling point prompt: {str(e)}")
        return web.Response(text=str(e), status=500)

async def handle_frame_extraction(request):
    try:
        data = await request.json()
        video_path = UPLOAD_DIR / data.get('filename')
        
        if not video_path.exists():
            return web.Response(text='Video file not found', status=404)
            
        frame = data.get('frame')
        if frame is None:
            return web.Response(text='Missing frame parameter', status=400)
            
        # Load the specific frame
        vr = decord.VideoReader(str(video_path))
        frame_idx = int(frame * vr.fps)  # Convert time to frame index
        frame_idx = min(max(0, frame_idx), len(vr) - 1)  # Ensure valid frame index
        
        frame_data = vr[frame_idx].asnumpy()
        
        # Convert frame to base64 for sending to frontend
        import base64
        import cv2
        _, buffer = cv2.imencode('.jpg', cv2.cvtColor(frame_data, cv2.COLOR_RGB2BGR))
        frame_base64 = base64.b64encode(buffer).decode('utf-8')
        
        return web.json_response({
            'status': 'success',
            'frame': frame_idx,
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
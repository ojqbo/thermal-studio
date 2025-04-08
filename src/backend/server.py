import aiohttp
from aiohttp import web
import os
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Routes
async def handle_upload(request):
    try:
        reader = await request.multipart()
        field = await reader.next()
        
        if field.name != 'video':
            return web.Response(text='No video file provided', status=400)
            
        # Create videos directory if it doesn't exist
        os.makedirs('data/videos', exist_ok=True)
        
        # Save the video file
        filename = field.filename
        filepath = os.path.join('data/videos', filename)
        
        with open(filepath, 'wb') as f:
            while True:
                chunk = await field.read_chunk()
                if not chunk:
                    break
                f.write(chunk)
                
        return web.Response(text=f'Video uploaded successfully: {filename}')
    except Exception as e:
        logger.error(f"Error handling upload: {str(e)}")
        return web.Response(text=str(e), status=500)

async def handle_point_prompt(request):
    try:
        data = await request.json()
        # TODO: Implement point prompt processing
        return web.Response(text='Point prompt received')
    except Exception as e:
        logger.error(f"Error handling point prompt: {str(e)}")
        return web.Response(text=str(e), status=500)

async def handle_frame_extraction(request):
    try:
        data = await request.json()
        # TODO: Implement frame extraction
        return web.Response(text='Frame extraction requested')
    except Exception as e:
        logger.error(f"Error handling frame extraction: {str(e)}")
        return web.Response(text=str(e), status=500)

# Create application
app = web.Application()

# Add routes
app.router.add_post('/upload', handle_upload)
app.router.add_post('/point-prompt', handle_point_prompt)
app.router.add_post('/frame-extraction', handle_frame_extraction)

# Serve static files
app.router.add_static('/static', 'src/frontend/static')

if __name__ == '__main__':
    web.run_app(app, host='0.0.0.0', port=8080) 
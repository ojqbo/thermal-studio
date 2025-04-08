// Global variables
let video = null;
let videoCanvas = null;
let videoCtx = null;
let segmentationCanvas = null;
let segmentationCtx = null;
let histogramCanvas = null;
let histogramCtx = null;
let isPlaying = false;
let points = [];

// Initialize when OpenCV is loaded
function onOpenCVLoad() {
    console.log('OpenCV.js is ready');
    initializeCanvas();
}

function onOpenCVError() {
    console.error('Failed to load OpenCV.js');
}

// Initialize canvas elements
function initializeCanvas() {
    videoCanvas = document.getElementById('videoCanvas');
    videoCtx = videoCanvas.getContext('2d');
    
    segmentationCanvas = document.getElementById('segmentationCanvas');
    segmentationCtx = segmentationCanvas.getContext('2d');
    
    histogramCanvas = document.getElementById('histogramCanvas');
    histogramCtx = histogramCanvas.getContext('2d');
    
    // Set up event listeners
    setupEventListeners();
}

// Set up event listeners
function setupEventListeners() {
    const uploadButton = document.getElementById('uploadButton');
    const videoInput = document.getElementById('videoInput');
    const playPauseButton = document.getElementById('playPauseButton');
    const addPointButton = document.getElementById('addPointButton');
    const clearPointsButton = document.getElementById('clearPointsButton');
    
    uploadButton.addEventListener('click', handleUpload);
    videoInput.addEventListener('change', handleVideoSelect);
    playPauseButton.addEventListener('click', togglePlayPause);
    addPointButton.addEventListener('click', enablePointSelection);
    clearPointsButton.addEventListener('click', clearPoints);
    
    // Add canvas click listener for point selection
    videoCanvas.addEventListener('click', handleCanvasClick);
}

// Handle video file selection
async function handleVideoSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Create video element
    video = document.createElement('video');
    video.src = URL.createObjectURL(file);
    
    // Wait for video metadata to load
    await new Promise((resolve) => {
        video.onloadedmetadata = () => {
            // Set canvas dimensions to match video
            videoCanvas.width = video.videoWidth;
            videoCanvas.height = video.videoHeight;
            segmentationCanvas.width = video.videoWidth;
            segmentationCanvas.height = video.videoHeight;
            resolve();
        };
    });
    
    // Draw first frame
    drawVideoFrame();
}

// Handle video upload
async function handleUpload() {
    const fileInput = document.getElementById('videoInput');
    const file = fileInput.files[0];
    if (!file) {
        alert('Please select a video file first');
        return;
    }
    
    const formData = new FormData();
    formData.append('video', file);
    
    try {
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });
        
        if (response.ok) {
            const result = await response.text();
            console.log('Upload successful:', result);
        } else {
            console.error('Upload failed:', await response.text());
        }
    } catch (error) {
        console.error('Error uploading video:', error);
    }
}

// Draw current video frame
function drawVideoFrame() {
    if (!video || !videoCtx) return;
    
    videoCtx.drawImage(video, 0, 0, videoCanvas.width, videoCanvas.height);
    
    // Draw points
    points.forEach(point => {
        videoCtx.beginPath();
        videoCtx.arc(point.x, point.y, 5, 0, 2 * Math.PI);
        videoCtx.fillStyle = 'red';
        videoCtx.fill();
    });
    
    if (isPlaying) {
        requestAnimationFrame(drawVideoFrame);
    }
}

// Toggle play/pause
function togglePlayPause() {
    if (!video) return;
    
    isPlaying = !isPlaying;
    if (isPlaying) {
        video.play();
        drawVideoFrame();
    } else {
        video.pause();
    }
}

// Enable point selection mode
function enablePointSelection() {
    videoCanvas.style.cursor = 'crosshair';
}

// Handle canvas click for point selection
async function handleCanvasClick(event) {
    if (!video || !videoCanvas) return;
    
    const rect = videoCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Add point
    points.push({ x, y });
    
    // Draw point
    videoCtx.beginPath();
    videoCtx.arc(x, y, 5, 0, 2 * Math.PI);
    videoCtx.fillStyle = 'red';
    videoCtx.fill();
    
    // Send point to backend
    try {
        const response = await fetch('/point-prompt', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                x,
                y,
                frame: video.currentTime
            })
        });
        
        if (response.ok) {
            const result = await response.text();
            console.log('Point processed:', result);
        } else {
            console.error('Point processing failed:', await response.text());
        }
    } catch (error) {
        console.error('Error processing point:', error);
    }
}

// Clear all points
function clearPoints() {
    points = [];
    drawVideoFrame();
} 
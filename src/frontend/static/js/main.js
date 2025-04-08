// Global variables
let video = null;
let videoCanvas = null;
let segmentationCanvas = null;
let histogramCanvas = null;
let videoContext = null;
let segmentationContext = null;
let histogramContext = null;
let isPlaying = false;
let currentFrame = null;
let currentVideoFile = null;
let isProcessing = false;

// Initialize the application
async function init() {
    // Get DOM elements
    video = document.getElementById('video');
    videoCanvas = document.getElementById('videoCanvas');
    segmentationCanvas = document.getElementById('segmentationCanvas');
    histogramCanvas = document.getElementById('histogramCanvas');
    
    // Get contexts
    videoContext = videoCanvas.getContext('2d');
    segmentationContext = segmentationCanvas.getContext('2d');
    histogramContext = histogramCanvas.getContext('2d');

    // Set initial canvas sizes
    videoCanvas.width = 800;
    videoCanvas.height = 600;
    segmentationCanvas.width = 800;
    segmentationCanvas.height = 600;
    histogramCanvas.width = 400;
    histogramCanvas.height = 300;

    // Set up event listeners
    document.getElementById('uploadBtn').addEventListener('click', () => {
        document.getElementById('videoInput').click();
    });

    document.getElementById('videoInput').addEventListener('change', handleVideoUpload);
    document.getElementById('playPauseBtn').addEventListener('click', togglePlayPause);
    document.getElementById('processBtn').addEventListener('click', processFrame);
    document.getElementById('resetBtn').addEventListener('click', resetVideo);

    // Add canvas click listener for point selection
    videoCanvas.addEventListener('click', handleCanvasClick);
}

// Handle video file upload
async function handleVideoUpload(event) {
    const file = event.target.files[0];
    if (file) {
        // Create FormData for upload
        const formData = new FormData();
        formData.append('video', file);

        try {
            // Show loading state
            document.getElementById('uploadBtn').disabled = true;
            document.getElementById('uploadBtn').textContent = 'Uploading...';

            // Upload video to server
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Upload failed: ${await response.text()}`);
            }

            const result = await response.json();
            currentVideoFile = result.filename;

            // Set up video element
            const url = URL.createObjectURL(file);
            video.src = url;
            video.onloadedmetadata = () => {
                // Set canvas dimensions to match video
                videoCanvas.width = video.videoWidth;
                videoCanvas.height = video.videoHeight;
                segmentationCanvas.width = video.videoWidth;
                segmentationCanvas.height = video.videoHeight;
                
                // Enable controls
                document.getElementById('playPauseBtn').disabled = false;
                document.getElementById('processBtn').disabled = false;
                document.getElementById('resetBtn').disabled = false;
            };
        } catch (error) {
            console.error('Error uploading video:', error);
            alert('Error uploading video: ' + error.message);
        } finally {
            // Reset button state
            document.getElementById('uploadBtn').disabled = false;
            document.getElementById('uploadBtn').textContent = 'Upload Video';
        }
    }
}

// Handle canvas click for point selection
async function handleCanvasClick(event) {
    if (!currentVideoFile || !video || isProcessing) return;

    const rect = videoCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    try {
        isProcessing = true;
        document.getElementById('processBtn').disabled = true;
        document.getElementById('processBtn').textContent = 'Processing...';

        // Send point to server for processing
        const response = await fetch('/point-prompt', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                filename: currentVideoFile,
                x: x,
                y: y,
                frame: video.currentTime
            })
        });

        if (!response.ok) {
            throw new Error(`Point processing failed: ${await response.text()}`);
        }

        const result = await response.json();
        console.log('Point processed:', result);

        // Update segmentation and histogram
        await updateSegmentation(result);
    } catch (error) {
        console.error('Error processing point:', error);
        alert('Error processing point: ' + error.message);
    } finally {
        isProcessing = false;
        document.getElementById('processBtn').disabled = false;
        document.getElementById('processBtn').textContent = 'Process Frame';
    }
}

// Toggle video play/pause
function togglePlayPause() {
    if (video.paused) {
        video.play();
        isPlaying = true;
        document.getElementById('playPauseBtn').textContent = 'Pause';
        requestAnimationFrame(updateFrame);
    } else {
        video.pause();
        isPlaying = false;
        document.getElementById('playPauseBtn').textContent = 'Play';
    }
}

// Update video frame
function updateFrame() {
    if (isPlaying) {
        videoContext.drawImage(video, 0, 0, videoCanvas.width, videoCanvas.height);
        currentFrame = videoContext.getImageData(0, 0, videoCanvas.width, videoCanvas.height);
        requestAnimationFrame(updateFrame);
    }
}

// Process current frame with SAM2
async function processFrame() {
    if (!currentFrame || !currentVideoFile || isProcessing) return;

    try {
        isProcessing = true;
        document.getElementById('processBtn').disabled = true;
        document.getElementById('processBtn').textContent = 'Processing...';

        // Request frame from server
        const response = await fetch('/frame-extraction', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                filename: currentVideoFile,
                frame: video.currentTime
            })
        });

        if (!response.ok) {
            throw new Error(`Frame extraction failed: ${await response.text()}`);
        }

        const result = await response.json();
        
        // Update segmentation and histogram
        await updateSegmentation(result);
    } catch (error) {
        console.error('Error processing frame:', error);
        alert('Error processing frame: ' + error.message);
    } finally {
        isProcessing = false;
        document.getElementById('processBtn').disabled = false;
        document.getElementById('processBtn').textContent = 'Process Frame';
    }
}

// Update segmentation and histogram with server response
async function updateSegmentation(result) {
    if (!result.frame_data) return;

    // Create image from base64 data
    const img = new Image();
    img.onload = () => {
        // Draw segmentation
        segmentationContext.clearRect(0, 0, segmentationCanvas.width, segmentationCanvas.height);
        segmentationContext.drawImage(img, 0, 0, segmentationCanvas.width, segmentationCanvas.height);

        // Get image data for histogram
        const imageData = segmentationContext.getImageData(0, 0, segmentationCanvas.width, segmentationCanvas.height);
        updateHistogram(imageData);
    };
    img.src = 'data:image/jpeg;base64,' + result.frame_data;
}

// Update temperature histogram
function updateHistogram(result) {
    // Calculate temperature distribution
    const histogram = calculateHistogram(result);
    
    // Draw histogram
    drawHistogram(histogram);
}

// Calculate temperature histogram
function calculateHistogram(result) {
    // Create a simple histogram from the frame data
    const histogram = new Array(256).fill(0);
    const data = result.data;
    
    for (let i = 0; i < data.length; i += 4) {
        const value = data[i]; // Use red channel as temperature value
        histogram[value]++;
    }
    
    return histogram;
}

// Draw temperature histogram
function drawHistogram(histogram) {
    const ctx = histogramContext;
    const width = histogramCanvas.width;
    const height = histogramCanvas.height;
    
    // Clear previous histogram
    ctx.clearRect(0, 0, width, height);
    
    // Find maximum value for scaling
    const maxValue = Math.max(...histogram);
    
    // Draw histogram
    ctx.fillStyle = '#2196F3';
    const barWidth = width / histogram.length;
    
    histogram.forEach((value, index) => {
        const barHeight = (value / maxValue) * height;
        ctx.fillRect(
            index * barWidth,
            height - barHeight,
            barWidth - 1,
            barHeight
        );
    });
}

// Reset video to beginning
function resetVideo() {
    video.currentTime = 0;
    video.pause();
    isPlaying = false;
    document.getElementById('playPauseBtn').textContent = 'Play';
    videoContext.clearRect(0, 0, videoCanvas.width, videoCanvas.height);
    segmentationContext.clearRect(0, 0, segmentationCanvas.width, segmentationCanvas.height);
    histogramContext.clearRect(0, 0, histogramCanvas.width, histogramCanvas.height);
}

// Initialize when the page loads
window.addEventListener('load', init); 
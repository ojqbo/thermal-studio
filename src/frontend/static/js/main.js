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
let sam2Model = null;

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

    // Initialize SAM2 model
    try {
        sam2Model = await loadSAM2Model();
        console.log('SAM2 model loaded successfully');
    } catch (error) {
        console.error('Error loading SAM2 model:', error);
        alert('Failed to load SAM2 model. Please check the console for details.');
    }
}

// Handle video file upload
function handleVideoUpload(event) {
    const file = event.target.files[0];
    if (file) {
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
    if (!currentFrame || !sam2Model) return;

    try {
        // Convert frame to format expected by SAM2
        const input = preprocessFrame(currentFrame);
        
        // Run SAM2 inference
        const result = await sam2Model.predict(input);
        
        // Post-process and display results
        displaySegmentation(result);
        updateHistogram(result);
    } catch (error) {
        console.error('Error processing frame:', error);
        alert('Error processing frame. Please check the console for details.');
    }
}

// Preprocess frame for SAM2
function preprocessFrame(frame) {
    // Convert ImageData to tensor and normalize
    // This is a placeholder - actual implementation will depend on SAM2's requirements
    return frame;
}

// Display segmentation results
function displaySegmentation(result) {
    // Clear previous segmentation
    segmentationContext.clearRect(0, 0, segmentationCanvas.width, segmentationCanvas.height);
    
    // Draw new segmentation
    // This is a placeholder - actual implementation will depend on SAM2's output format
    segmentationContext.putImageData(result, 0, 0);
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

// Load SAM2 model
async function loadSAM2Model() {
    // This is a placeholder - actual implementation will depend on how SAM2 is loaded
    // You'll need to implement the actual model loading logic here
    return null;
}

// Initialize when the page loads
window.addEventListener('load', init); 
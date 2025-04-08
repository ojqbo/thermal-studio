// Global variables
let videoFile = null;
let videoElement = null;
let canvasElement = null;
let ctx = null;
let currentFrame = 0;
let totalFrames = 0;
let fps = 0;
let isPlaying = false;
let videoWidth = 0;
let videoHeight = 0;
let isProcessing = false;
let currentVideo = null;  // Store current video information

// New state variables for the two-phase interface
let currentMode = 'setup'; // 'setup' or 'viewing'
let currentPointType = 1; // 1 for positive, 0 for negative
let framePrompts = {}; // {frameIndex: [{x, y, label}, ...]}
let maskData = null; // Will store mask data from backend

// Mask visualization settings
let maskOpacity = 0.5;
let maskColor = 'rgba(255, 0, 0, 0.5)'; // Default red with 50% opacity

// DOM elements
const uploadForm = document.getElementById('upload-form');
const videoSection = document.getElementById('video-section');
const canvasContainer = document.getElementById('canvas-container');
const controls = document.getElementById('controls');
const frameSlider = document.getElementById('frame-slider');
const frameDisplay = document.getElementById('frame-display');
const playPauseBtn = document.getElementById('play-pause');
const uploadBtn = document.getElementById('upload-btn');
const fileInput = document.getElementById('file-input');
const analysisSection = document.getElementById('analysis-section');
const histogramContainer = document.getElementById('histogram-container');

// New UI elements
const modeToggle = document.getElementById('mode-toggle');
const pointTypeSelector = document.getElementById('point-type');
const processVideoBtn = document.getElementById('process-video');
const clearPointsBtn = document.getElementById('clear-points');
const clearAllPointsBtn = document.getElementById('clear-all-points');
const canvas = document.getElementById('canvas');

// Mask control elements
const maskOpacitySlider = document.getElementById('mask-opacity');
const maskColorSelector = document.getElementById('mask-color');

// Initialize the application
function init() {
    // Initialize canvas element
    canvasElement = canvas;
    if (!canvasElement) {
        console.error('Canvas element not found');
        return;
    }
    
    // Add event listeners for file upload
    uploadForm.addEventListener('submit', handleUpload);
    fileInput.addEventListener('change', handleFileSelect);
    
    // Add event listeners for video controls
    playPauseBtn.addEventListener('click', togglePlayPause);
    frameSlider.addEventListener('input', handleFrameChange);
    
    // Add event listeners for new UI elements
    modeToggle.addEventListener('change', handleModeChange);
    pointTypeSelector.addEventListener('change', handlePointTypeChange);
    processVideoBtn.addEventListener('click', handleProcessVideo);
    clearPointsBtn.addEventListener('click', clearCurrentFramePoints);
    clearAllPointsBtn.addEventListener('click', clearAllPoints);
    
    // Add canvas click handler for point placement
    canvasElement.addEventListener('click', handleCanvasClick);
    canvasElement.addEventListener('contextmenu', handleCanvasRightClick);
    
    // Add mask control event listeners
    if (maskOpacitySlider) {
        maskOpacitySlider.addEventListener('input', handleMaskOpacityChange);
    }
    
    if (maskColorSelector) {
        maskColorSelector.addEventListener('change', handleMaskColorChange);
    }
    
    // Initialize UI state
    updateUIState();
}

// Handle file selection
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (file && file.type.startsWith('video/')) {
        videoFile = file;
        uploadBtn.disabled = false;
    } else {
        alert('Please select a valid video file');
        uploadBtn.disabled = true;
    }
}

// Handle file upload
async function handleUpload(event) {
    event.preventDefault();
    
    if (!videoFile) {
        alert('Please select a video file first');
        return;
    }
    
    const formData = new FormData();
    formData.append('file', videoFile);
    
    try {
        isProcessing = true;
        updateUIState();
        
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`Upload failed: ${await response.text()}`);
        }
        
        const data = await response.json();
        
        if (data.status === 'success') {
            // Store current video information
            currentVideo = {
                filename: data.filename,
                frames: data.frames,
                fps: data.fps,
                width: data.width,
                height: data.height
            };
            
            // Initialize video properties
            totalFrames = data.frames;
            fps = data.fps;
            videoWidth = data.width;
            videoHeight = data.height;
            
            // Update UI
            frameSlider.max = totalFrames - 1;
            frameSlider.value = 0;
            frameDisplay.textContent = `Frame: 0 / ${totalFrames - 1}`;
            
            // Load the video
            await loadVideo(data.filename);
            
            // Reset state for new video
            resetState();
            
            // Show video section
            videoSection.style.display = 'block';
            analysisSection.style.display = 'block';
        } else {
            throw new Error('Upload failed: ' + data.message);
        }
    } catch (error) {
        console.error('Error uploading video:', error);
        alert(error.message);
    } finally {
        isProcessing = false;
        updateUIState();
    }
}

// Load video after upload
async function loadVideo(filename) {
    return new Promise((resolve, reject) => {
        videoElement = document.createElement('video');
        videoElement.src = `/static/videos/${filename}`;  // This path is correct as it matches the server's static route
        videoElement.crossOrigin = 'anonymous';
        
        videoElement.addEventListener('loadedmetadata', () => {
            canvasElement.width = videoWidth;
            canvasElement.height = videoHeight;
            ctx = canvasElement.getContext('2d');
            
            // Draw first frame
            videoElement.currentTime = 0;
            videoElement.addEventListener('seeked', () => {
                ctx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
                resolve();
            }, { once: true });
        });
        
        videoElement.addEventListener('error', (e) => {
            console.error('Error loading video:', e);
            reject(new Error('Error loading video'));
        });
    });
}

// Toggle play/pause
function togglePlayPause() {
    if (!videoElement) return;
    
    if (isPlaying) {
        videoElement.pause();
        playPauseBtn.textContent = 'Play';
    } else {
        videoElement.play();
        playPauseBtn.textContent = 'Pause';
    }
    
    isPlaying = !isPlaying;
}

// Handle frame change
function handleFrameChange() {
    if (!videoElement) return;
    
    currentFrame = parseInt(frameSlider.value);
    videoElement.currentTime = currentFrame / fps;
    frameDisplay.textContent = `Frame: ${currentFrame} / ${totalFrames - 1}`;
    
    // Draw current frame
    ctx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
    
    // Draw points for current frame if in setup mode
    if (currentMode === 'setup') {
        drawPointsForFrame(currentFrame);
    }
    
    // Draw masks if in viewing mode
    if (currentMode === 'viewing' && maskData) {
        drawMasksForFrame(currentFrame);
    }
}

// Handle mode change
function handleModeChange() {
    currentMode = modeToggle.checked ? 'viewing' : 'setup';
    updateUIState();
    
    // Redraw current frame with appropriate overlays
    if (currentMode === 'setup') {
        drawPointsForFrame(currentFrame);
    } else if (maskData) {
        drawMasksForFrame(currentFrame);
    }
}

// Handle point type change
function handlePointTypeChange() {
    currentPointType = parseInt(pointTypeSelector.value);
}

// Handle mask opacity change
function handleMaskOpacityChange() {
    maskOpacity = parseFloat(maskOpacitySlider.value);
    updateMaskColor();
    
    // Redraw masks if in viewing mode
    if (currentMode === 'viewing' && maskData) {
        drawMasksForFrame(currentFrame);
    }
}

// Handle mask color change
function handleMaskColorChange() {
    updateMaskColor();
    
    // Redraw masks if in viewing mode
    if (currentMode === 'viewing' && maskData) {
        drawMasksForFrame(currentFrame);
    }
}

// Update mask color with current opacity
function updateMaskColor() {
    const color = maskColorSelector.value;
    const r = parseInt(color.substr(1, 2), 16);
    const g = parseInt(color.substr(3, 2), 16);
    const b = parseInt(color.substr(5, 2), 16);
    
    maskColor = `rgba(${r}, ${g}, ${b}, ${maskOpacity})`;
}

// Handle canvas click for point placement
function handleCanvasClick(event) {
    if (currentMode !== 'setup' || !canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Add point to current frame
    addPoint(currentFrame, x, y, currentPointType);
    
    // Redraw points
    drawPointsForFrame(currentFrame);
}

// Handle canvas right-click for point removal
function handleCanvasRightClick(event) {
    event.preventDefault();
    
    if (currentMode !== 'setup' || !canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Find and remove the closest point
    removeClosestPoint(currentFrame, x, y);
    
    // Redraw points
    drawPointsForFrame(currentFrame);
}

// Add point to frame
function addPoint(frameIndex, x, y, label) {
    if (!framePrompts[frameIndex]) {
        framePrompts[frameIndex] = [];
    }
    
    framePrompts[frameIndex].push({ x, y, label });
}

// Remove closest point to coordinates
function removeClosestPoint(frameIndex, x, y) {
    if (!framePrompts[frameIndex] || framePrompts[frameIndex].length === 0) return;
    
    let closestIndex = -1;
    let minDistance = Infinity;
    
    for (let i = 0; i < framePrompts[frameIndex].length; i++) {
        const point = framePrompts[frameIndex][i];
        const distance = Math.sqrt(Math.pow(point.x - x, 2) + Math.pow(point.y - y, 2));
        
        if (distance < minDistance) {
            minDistance = distance;
            closestIndex = i;
        }
    }
    
    if (closestIndex !== -1 && minDistance < 20) { // Only remove if within 20px
        framePrompts[frameIndex].splice(closestIndex, 1);
    }
}

// Clear points for current frame
function clearCurrentFramePoints() {
    if (framePrompts[currentFrame]) {
        framePrompts[currentFrame] = [];
        drawPointsForFrame(currentFrame);
    }
}

// Clear all points
function clearAllPoints() {
    framePrompts = {};
    drawPointsForFrame(currentFrame);
}

// Draw points for a specific frame
function drawPointsForFrame(frameIndex) {
    if (!ctx || currentMode !== 'setup') return;
    
    // Redraw the current frame
    ctx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
    
    // Draw points
    if (framePrompts[frameIndex]) {
        framePrompts[frameIndex].forEach(point => {
            ctx.beginPath();
            ctx.arc(point.x, point.y, 5, 0, 2 * Math.PI);
            
            if (point.label === 1) {
                // Positive point (green)
                ctx.fillStyle = 'rgba(0, 255, 0, 0.7)';
                ctx.strokeStyle = 'white';
            } else {
                // Negative point (red)
                ctx.fillStyle = 'rgba(255, 0, 0, 0.7)';
                ctx.strokeStyle = 'white';
            }
            
            ctx.fill();
            ctx.stroke();
        });
    }
}

// Draw masks for a specific frame
function drawMasksForFrame(frameIndex) {
    if (!ctx || currentMode !== 'viewing' || !maskData) return;
    
    // Redraw the current frame
    ctx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
    
    // Draw mask if available for this frame
    if (maskData[frameIndex]) {
        const mask = maskData[frameIndex];
        
        // Create a semi-transparent overlay with current color and opacity
        ctx.fillStyle = maskColor;
        
        // Optimize mask rendering by using a single fill operation
        // Create a path for all mask pixels
        ctx.beginPath();
        
        // Use a more efficient approach for large masks
        if (mask.length > 100 || mask[0].length > 100) {
            // For large masks, use a more efficient approach
            const imageData = ctx.createImageData(canvasElement.width, canvasElement.height);
            const data = imageData.data;
            
            // Set alpha channel based on mask
            for (let y = 0; y < mask.length; y++) {
                for (let x = 0; x < mask[y].length; x++) {
                    if (mask[y][x] > 0) {
                        const index = (y * canvasElement.width + x) * 4;
                        const color = hexToRgb(maskColorSelector.value);
                        
                        data[index] = color.r;     // R
                        data[index + 1] = color.g; // G
                        data[index + 2] = color.b; // B
                        data[index + 3] = Math.floor(maskOpacity * 255); // A
                    }
                }
            }
            
            ctx.putImageData(imageData, 0, 0);
        } else {
            // For smaller masks, use the path approach
            for (let y = 0; y < mask.length; y++) {
                for (let x = 0; x < mask[y].length; x++) {
                    if (mask[y][x] > 0) {
                        ctx.rect(x, y, 1, 1);
                    }
                }
            }
            
            ctx.fill();
        }
    }
}

// Helper function to convert hex color to RGB
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : {r: 255, g: 0, b: 0}; // Default to red if parsing fails
}

// Handle process video button click
async function handleProcessVideo() {
    if (Object.keys(framePrompts).length === 0) {
        alert('Please add at least one point before processing');
        return;
    }
    
    try {
        isProcessing = true;
        updateUIState();
        
        // Send prompts to backend
        const response = await fetch('/process-video', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                filename: currentVideo.filename,  // Use the unique filename from upload
                prompts: framePrompts
            })
        });
        
        if (!response.ok) {
            throw new Error(`Processing failed: ${await response.text()}`);
        }
        
        const data = await response.json();
        
        if (data.status === 'success') {
            // Store mask data
            maskData = data.masks;
            
            // Switch to viewing mode
            currentMode = 'viewing';
            modeToggle.checked = true;
            
            // Update UI
            updateUIState();
            
            // Draw masks
            drawMasksForFrame(currentFrame);
        } else {
            throw new Error('Processing failed: ' + data.message);
        }
    } catch (error) {
        console.error('Error processing video:', error);
        alert(error.message);
    } finally {
        isProcessing = false;
        updateUIState();
    }
}

// API Integration Functions
async function processVideo() {
    if (!currentVideo || !framePrompts || Object.keys(framePrompts).length === 0) {
        showError('Please add points to at least one frame before processing.');
        return;
    }

    try {
        updateUIState({ processing: true });
        const response = await fetch('/process-video', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                filename: currentVideo.name,
                prompts: framePrompts
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to process video');
        }

        const result = await response.json();
        if (result.success) {
            await getMasks(currentVideo.name);
            currentMode = 'viewing';
            updateUIState({ mode: currentMode });
            showSuccess('Video processed successfully!');
        } else {
            throw new Error(result.error || 'Failed to process video');
        }
    } catch (error) {
        showError(error.message);
        console.error('Error processing video:', error);
    } finally {
        updateUIState({ processing: false });
    }
}

async function getMasks(filename) {
    try {
        const response = await fetch(`/get-masks/${filename}`);
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to retrieve masks');
        }

        const result = await response.json();
        if (result.success) {
            maskData = result.masks;
            drawFrame(currentFrameIndex);
        } else {
            throw new Error(result.error || 'Failed to retrieve masks');
        }
    } catch (error) {
        showError(error.message);
        console.error('Error retrieving masks:', error);
    }
}

// UI Feedback Functions
function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    document.body.appendChild(errorDiv);
    setTimeout(() => errorDiv.remove(), 5000);
}

function showSuccess(message) {
    const successDiv = document.createElement('div');
    successDiv.className = 'success-message';
    successDiv.textContent = message;
    document.body.appendChild(successDiv);
    setTimeout(() => successDiv.remove(), 5000);
}

// Update UI state based on current mode and processing state
function updateUIState() {
    // Disable controls during processing
    const controls = [
        frameSlider, 
        playPauseBtn, 
        modeToggle, 
        pointTypeSelector, 
        processVideoBtn, 
        clearPointsBtn, 
        clearAllPointsBtn,
        maskOpacitySlider,
        maskColorSelector
    ];
    
    controls.forEach(control => {
        if (control) {
            control.disabled = isProcessing;
        }
    });
    
    // Show/hide elements based on mode
    if (pointTypeSelector) {
        pointTypeSelector.parentElement.style.display = currentMode === 'setup' ? 'block' : 'none';
    }
    
    if (processVideoBtn) {
        processVideoBtn.style.display = currentMode === 'setup' ? 'block' : 'none';
    }
    
    if (clearPointsBtn) {
        clearPointsBtn.style.display = currentMode === 'setup' ? 'block' : 'none';
    }
    
    if (clearAllPointsBtn) {
        clearAllPointsBtn.style.display = currentMode === 'setup' ? 'block' : 'none';
    }
    
    // Show/hide mask controls based on mode and mask data
    if (maskOpacitySlider && maskColorSelector) {
        const maskControls = document.getElementById('mask-controls');
        if (maskControls) {
            maskControls.style.display = (currentMode === 'viewing' && maskData) ? 'block' : 'none';
        }
    }
    
    // Update canvas cursor based on mode
    if (canvas) {
        canvas.style.cursor = currentMode === 'setup' ? 'crosshair' : 'default';
    }
}

// Reset state for new video
function resetState() {
    currentFrame = 0;
    isPlaying = false;
    currentMode = 'setup';
    framePrompts = {};
    maskData = null;
    
    if (modeToggle) {
        modeToggle.checked = false;
    }
    
    updateUIState();
}

// Call init when the DOM is loaded
document.addEventListener('DOMContentLoaded', init); 
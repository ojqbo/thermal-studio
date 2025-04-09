// Global variables
const DEBUG = true;  // Debug flag

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

// Mask state
let masks = {}; // {frameIndex: {objectId: maskData}}
let maskOpacity = 0.5;
let maskColors = [
    'rgba(255, 165, 0, 0.5)',  // Orange
    'rgba(106, 90, 205, 0.5)', // Slate blue
    'rgba(50, 205, 50, 0.5)',  // Lime green
    'rgba(255, 105, 180, 0.5)', // Hot pink
    'rgba(70, 130, 180, 0.5)'  // Steel blue
];

// Object tracking state
let objects = [{
    id: 1,
    label: 'Object 1',
    thumbnail: null,
    points: {}, // {frameIndex: [{x, y, label}]}
    color: maskColors[0]
}];
let currentObjectId = 1;
let currentAction = 'add'; // 'add' or 'remove'

// DOM elements
const uploadForm = document.getElementById('upload-form');
const uploadSection = document.getElementById('upload-section');
const workspace = document.getElementById('workspace');
const canvas = document.getElementById('canvas');
const playPauseBtn = document.getElementById('play-pause');
const frameSlider = document.getElementById('frame-slider');
const frameDisplay = document.getElementById('frame-display');
const addObjectBtn = document.getElementById('add-object');
const startOverBtn = document.getElementById('start-over');
const trackObjectsBtn = document.getElementById('track-objects');
const tooltip = document.getElementById('tooltip');
const fileInput = document.getElementById('file-input');

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
    
    // Add event listeners for object controls
    addObjectBtn.addEventListener('click', handleAddObject);
    startOverBtn.addEventListener('click', handleStartOver);
    trackObjectsBtn.addEventListener('click', handleTrackObjects);
    
    // Add canvas click handler for point placement
    canvasElement.addEventListener('click', handleCanvasClick);
    canvasElement.addEventListener('contextmenu', handleCanvasRightClick);
    
    // Add tooltip close handler
    document.querySelector('.tooltip .ok-btn').addEventListener('click', () => {
        tooltip.style.display = 'none';
    });
    
    // Initialize objects list
    updateObjectsList();
}

// Handle file selection
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (file && file.type.startsWith('video/')) {
        videoFile = file;
        document.getElementById('upload-btn').disabled = false;
    } else {
        alert('Please select a valid video file');
        document.getElementById('upload-btn').disabled = true;
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
            frameDisplay.textContent = formatTime(0);
            
            // Load the video
            await loadVideo(data.filename);
            
            // Reset state for new video
            resetState();
            
            // Show workspace
            uploadSection.style.display = 'none';
            workspace.style.display = 'flex';
            
            // Show tooltip
            tooltip.style.display = 'block';
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
        videoElement.src = `/static/videos/${filename}`;
        videoElement.crossOrigin = 'anonymous';
        
        videoElement.addEventListener('loadedmetadata', () => {
            canvasElement.width = videoWidth;
            canvasElement.height = videoHeight;
            ctx = canvasElement.getContext('2d');
            
            // Draw first frame
            videoElement.currentTime = 0;
            videoElement.addEventListener('seeked', () => {
                drawFrame();
                resolve();
            }, { once: true });
        });
        
        videoElement.addEventListener('error', (e) => {
            console.error('Error loading video:', e);
            reject(new Error('Error loading video'));
        });
    });
}

// Handle canvas click for point placement
function handleCanvasClick(event) {
    event.preventDefault();
    
    if (!videoElement || isProcessing) return;
    
    const rect = canvasElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Scale coordinates to actual video dimensions
    const scaleX = videoWidth / canvasElement.width;
    const scaleY = videoHeight / canvasElement.height;
    
    const point = {
        x: x * scaleX,
        y: y * scaleY,
        label: currentAction === 'add' ? 1 : 0
    };
    
    // Add point to current object
    const currentObject = objects.find(obj => obj.id === currentObjectId);
    if (currentObject) {
        if (!currentObject.points[currentFrame]) {
            currentObject.points[currentFrame] = [];
        }
        currentObject.points[currentFrame].push(point);
        
        // Update thumbnail if this is the first point
        if (!currentObject.thumbnail) {
            updateObjectThumbnail(currentObject.id);
        }
        
        // Redraw frame with points
        drawFrame();
    }
}

// Handle canvas right click for point removal
function handleCanvasRightClick(event) {
    event.preventDefault();
    
    if (!videoElement || isProcessing) return;
    
    const rect = canvasElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Scale coordinates to actual video dimensions
    const scaleX = videoWidth / canvasElement.width;
    const scaleY = videoHeight / canvasElement.height;
    const clickX = x * scaleX;
    const clickY = y * scaleY;
    
    // Find and remove the closest point within 10 pixels
    const currentObject = objects.find(obj => obj.id === currentObjectId);
    if (currentObject && currentObject.points[currentFrame]) {
        const points = currentObject.points[currentFrame];
        let closestIndex = -1;
        let minDistance = 10;
        
        points.forEach((point, index) => {
            const distance = Math.sqrt(
                Math.pow(point.x - clickX, 2) + Math.pow(point.y - clickY, 2)
            );
            if (distance < minDistance) {
                minDistance = distance;
                closestIndex = index;
            }
        });
        
        if (closestIndex !== -1) {
            points.splice(closestIndex, 1);
            if (points.length === 0) {
                delete currentObject.points[currentFrame];
            }
            drawFrame();
        }
    }
}

// Handle frame change
function handleFrameChange() {
    if (!videoElement) return;
    
    currentFrame = parseInt(frameSlider.value);
    videoElement.currentTime = currentFrame / fps;
    frameDisplay.textContent = formatTime(currentFrame / fps);
    
    drawFrame();
}

// Toggle play/pause
function togglePlayPause() {
    if (!videoElement) return;
    
    if (isPlaying) {
        videoElement.pause();
        playPauseBtn.innerHTML = '<span class="icon">▶</span>';
    } else {
        videoElement.play();
        playPauseBtn.innerHTML = '<span class="icon">⏸</span>';
        requestAnimationFrame(updatePlayback);
    }
    
    isPlaying = !isPlaying;
}

// Update playback
function updatePlayback() {
    if (!isPlaying) return;
    
    currentFrame = Math.floor(videoElement.currentTime * fps);
    frameSlider.value = currentFrame;
    frameDisplay.textContent = formatTime(videoElement.currentTime);
    
    drawFrame();
    
    if (currentFrame < totalFrames - 1) {
        requestAnimationFrame(updatePlayback);
    } else {
        togglePlayPause();
    }
}

// Draw current frame with points and masks
function drawFrame() {
    if (!ctx || !videoElement) return;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    // Draw video frame
    ctx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
    
    // Draw masks for current frame if available
    if (masks[currentFrame]) {
        drawMasks(masks[currentFrame]);
    }
    
    // Draw points for current frame
    objects.forEach(object => {
        const points = object.points[currentFrame];
        if (points) {
            points.forEach(point => {
                // Scale coordinates to canvas dimensions
                const x = point.x * (canvasElement.width / videoWidth);
                const y = point.y * (canvasElement.height / videoHeight);
                
                ctx.beginPath();
                ctx.arc(x, y, 5, 0, 2 * Math.PI);
                ctx.fillStyle = point.label === 1 ? 'rgba(0, 255, 0, 0.7)' : 'rgba(255, 0, 0, 0.7)';
                ctx.strokeStyle = 'white';
                ctx.fill();
                ctx.stroke();
            });
        }
    });
}

// Draw masks for the current frame
function drawMasks(frameMasks) {
    if (!ctx) return;
    
    if (DEBUG) {
        console.log('Drawing masks for frame', currentFrame, {
            objects: Object.keys(frameMasks).length,
            objectIds: Object.keys(frameMasks)
        });
    }
    
    // Create an offscreen canvas for mask composition
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = canvasElement.width;
    maskCanvas.height = canvasElement.height;
    const maskCtx = maskCanvas.getContext('2d');
    
    // Draw each object's mask
    objects.forEach((object, index) => {
        if (frameMasks[object.id]) {
            const mask = frameMasks[object.id];
            const imageData = maskCtx.createImageData(canvasElement.width, canvasElement.height);
            const data = imageData.data;
            
            // Convert mask data to RGBA
            const color = parseRGBA(object.color);
            for (let i = 0; i < mask.length; i++) {
                for (let j = 0; j < mask[i].length; j++) {
                    if (mask[i][j] > 0) {
                        const idx = (i * canvasElement.width + j) * 4;
                        data[idx] = color.r;     // R
                        data[idx + 1] = color.g; // G
                        data[idx + 2] = color.b; // B
                        data[idx + 3] = Math.floor(color.a * maskOpacity * 255); // A
                    }
                }
            }
            
            maskCtx.putImageData(imageData, 0, 0);
        }
    });
    
    // Composite mask onto main canvas
    ctx.drawImage(maskCanvas, 0, 0);
}

// Parse RGBA color string
function parseRGBA(rgba) {
    const match = rgba.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
    if (match) {
        return {
            r: parseInt(match[1]),
            g: parseInt(match[2]),
            b: parseInt(match[3]),
            a: parseFloat(match[4])
        };
    }
    return { r: 255, g: 165, b: 0, a: 0.5 }; // Default orange
}

// Handle add object button click
function handleAddObject() {
    const newId = objects.length + 1;
    objects.push({
        id: newId,
        label: `Object ${newId}`,
        thumbnail: null,
        points: {},
        color: maskColors[(newId - 1) % maskColors.length]
    });
    
    currentObjectId = newId;
    updateObjectsList();
}

// Handle start over button click
function handleStartOver() {
    if (confirm('Are you sure you want to start over? All points will be cleared.')) {
        objects.forEach(obj => {
            obj.points = {};
            obj.thumbnail = null;
        });
        drawFrame();
        updateObjectsList();
    }
}

// Handle track objects button click
async function handleTrackObjects() {
    if (!currentVideo) return;
    
    // Convert points data to the format expected by the backend
    const prompts = {};
    objects.forEach(obj => {
        Object.entries(obj.points).forEach(([frame, points]) => {
            const frameIndex = parseInt(frame);
            if (!prompts[frameIndex]) {
                prompts[frameIndex] = [];
            }
            prompts[frameIndex].push(...points);
        });
    });

    if (DEBUG) {
        console.log('Sending prompts to backend:', JSON.stringify(prompts, null, 2));
    }
    
    try {
        isProcessing = true;
        updateUIState();
        
        const response = await fetch('/process-video', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                filename: currentVideo.filename,
                prompts: prompts
            })
        });
        
        if (!response.ok) {
            throw new Error(`Processing failed: ${await response.text()}`);
        }
        
        const data = await response.json();
        
        if (data.status === 'success') {
            // Store masks data
            masks = data.masks;
            
            if (DEBUG) {
                console.log('Received masks from backend:', {
                    totalFrames: Object.keys(masks).length,
                    sampleFrame: Object.keys(masks)[0] ? {
                        frameIndex: Object.keys(masks)[0],
                        objects: Object.keys(masks[Object.keys(masks)[0]]).length,
                        dimensions: masks[Object.keys(masks)[0]][objects[0].id] ? 
                            `${masks[Object.keys(masks)[0]][objects[0].id].length}x${masks[Object.keys(masks)[0]][objects[0].id][0].length}` : 
                            'no mask data'
                    } : 'no frames'
                });
            }
            
            // Update UI to show masks
            drawFrame();
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

// Update objects list in sidebar
function updateObjectsList() {
    const objectsList = document.querySelector('.objects-list');
    objectsList.innerHTML = objects.map(obj => `
        <div class="object-item ${obj.id === currentObjectId ? 'active' : ''}" data-id="${obj.id}">
            <div class="object-preview">
                ${obj.thumbnail ? `<img src="${obj.thumbnail}" alt="${obj.label}">` : ''}
            </div>
            <div class="object-label">${obj.label}</div>
            <div class="object-controls">
                <button class="add-point-btn ${currentObjectId === obj.id && currentAction === 'add' ? 'active' : ''}" 
                        data-action="add" data-id="${obj.id}">
                    <span class="icon">+</span> Add
                </button>
                <button class="remove-point-btn ${currentObjectId === obj.id && currentAction === 'remove' ? 'active' : ''}" 
                        data-action="remove" data-id="${obj.id}">
                    <span class="icon">-</span> Remove
                </button>
            </div>
        </div>
    `).join('');
    
    // Add event listeners to object controls
    objectsList.querySelectorAll('.add-point-btn, .remove-point-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const action = e.target.closest('button').dataset.action;
            const objectId = parseInt(e.target.closest('button').dataset.id);
            
            currentObjectId = objectId;
            currentAction = action;
            
            updateObjectsList();
        });
    });
}

// Update object thumbnail
function updateObjectThumbnail(objectId) {
    const object = objects.find(obj => obj.id === objectId);
    if (!object) return;
    
    // Create a temporary canvas for the thumbnail
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = 64;
    thumbCanvas.height = 64;
    const thumbCtx = thumbCanvas.getContext('2d');
    
    // Draw current frame
    thumbCtx.drawImage(videoElement, 0, 0, 64, 64);
    
    // Store thumbnail
    object.thumbnail = thumbCanvas.toDataURL();
    
    // Update objects list to show new thumbnail
    updateObjectsList();
}

// Format time as MM:SS
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Reset state for new video
function resetState() {
    currentFrame = 0;
    isPlaying = false;
    objects = [{
        id: 1,
        label: 'Object 1',
        thumbnail: null,
        points: {},
        color: maskColors[0]
    }];
    currentObjectId = 1;
    currentAction = 'add';
    
    updateObjectsList();
}

// Update UI state based on processing state
function updateUIState() {
    const controls = [
        playPauseBtn,
        frameSlider,
        addObjectBtn,
        startOverBtn,
        trackObjectsBtn
    ];
    
    controls.forEach(control => {
        if (control) {
            control.disabled = isProcessing;
        }
    });
    
    document.querySelectorAll('.add-point-btn, .remove-point-btn').forEach(btn => {
        btn.disabled = isProcessing;
    });
    
    if (isProcessing) {
        canvasElement.style.opacity = '0.7';
    } else {
        canvasElement.style.opacity = '1';
    }
}

// Call init when the DOM is loaded
document.addEventListener('DOMContentLoaded', init); 
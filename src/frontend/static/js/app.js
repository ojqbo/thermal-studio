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
let objects = {};  // Changed from array to object for easier access
let currentObjectId = null;
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
const uploadArea = document.getElementById('upload-area');
const uploadProgress = document.getElementById('upload-progress');
const progressFill = document.querySelector('.progress-fill');
const progressText = document.querySelector('.progress-text');
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
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleDrop);
    fileInput.addEventListener('change', handleFileSelect);
    uploadArea.addEventListener('click', () => fileInput.click());
    
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

// Handle drag over
function handleDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    uploadArea.classList.add('drag-over');
}

// Handle drag leave
function handleDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    uploadArea.classList.remove('drag-over');
}

// Handle drop
function handleDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    uploadArea.classList.remove('drag-over');
    
    const file = event.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) {
        handleFile(file);
    } else {
        alert('Please drop a valid video file');
    }
}

// Handle file selection
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (file && file.type.startsWith('video/')) {
        handleFile(file);
    } else {
        alert('Please select a valid video file');
    }
}

// Handle file upload
async function handleFile(file) {
    videoFile = file;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        isProcessing = true;
        updateUIState();
        
        // Show upload progress
        uploadProgress.style.display = 'block';
        progressFill.style.width = '0%';
        progressText.textContent = 'Uploading...';
        
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`Upload failed: ${await response.text()}`);
        }
        
        const data = await response.json();
        
        if (data.status === 'success') {
            // Update progress to complete
            progressFill.style.width = '100%';
            progressText.textContent = 'Processing...';
            
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
        // Reset upload progress
        uploadProgress.style.display = 'none';
        progressFill.style.width = '0%';
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
async function handleCanvasClick(event) {
    if (!videoElement) return;
    
    const rect = canvasElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Scale coordinates to video dimensions
    const scaleX = videoWidth / rect.width;
    const scaleY = videoHeight / rect.height;
    const scaledX = x * scaleX;
    const scaledY = y * scaleY;
    
    // Create a new object if none exists
    if (currentObjectId === null) {
        // Use sequential IDs starting from 1
        currentObjectId = Object.keys(objects).length + 1;
        objects[currentObjectId] = {
            id: currentObjectId,
            label: `Object ${currentObjectId}`,
            points: [],  // Initialize points as an empty array
            masks: [],
            color: maskColors[(currentObjectId - 1) % maskColors.length]
        };
    }
    
    // Ensure points is an array
    if (!Array.isArray(objects[currentObjectId].points)) {
        objects[currentObjectId].points = [];
    }
    
    // Add point to current object with label 1 (positive point)
    objects[currentObjectId].points.push({
        x: scaledX,
        y: scaledY,
        label: 1,  // Always 1 for positive points
        obj_id: currentObjectId  // Sequential ID starting from 1
    });
    
    if (DEBUG) {
        console.log(`Added positive point with label 1 to object ${currentObjectId}`);
    }
    
    // Collect all points for current frame
    const framePoints = [];
    for (const objId in objects) {
        const obj = objects[objId];
        if (Array.isArray(obj.points)) {
            framePoints.push(...obj.points.map(point => ({
                x: point.x,
                y: point.y,
                label: point.label,
                obj_id: point.obj_id
            })));
        }
    }
    
    console.log('Sending points to server:', framePoints);
    
    try {
        const response = await fetch('/process-frame', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                frame_idx: currentFrame,
                prompts: framePoints
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('Received mask result:', result);
        
        if (result.masks) {
            // Initialize masks for current frame if not exists
            if (!masks[currentFrame]) {
                masks[currentFrame] = {};
            }
            
            // Store the mask data for the current object
            masks[currentFrame][currentObjectId] = result.masks;
            
            if (DEBUG) {
                console.log('Stored mask data:', {
                    frame: currentFrame,
                    objectId: currentObjectId,
                    maskDimensions: result.masks.length + 'x' + (result.masks[0] ? result.masks[0].length : 'unknown')
                });
            }
            
            drawFrame();  // Redraw frame with new mask
        }
    } catch (error) {
        console.error('Error processing frame:', error);
    }
}

// Handle canvas right click for point removal
async function handleCanvasRightClick(event) {
    event.preventDefault();
    
    if (!videoElement) return;
    
    const rect = canvasElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Scale coordinates to video dimensions
    const scaleX = videoWidth / rect.width;
    const scaleY = videoHeight / rect.height;
    const scaledX = x * scaleX;
    const scaledY = y * scaleY;
    
    // Create a new object if none exists
    if (currentObjectId === null) {
        // Use sequential IDs starting from 1
        currentObjectId = Object.keys(objects).length + 1;
        objects[currentObjectId] = {
            id: currentObjectId,
            label: `Object ${currentObjectId}`,
            points: [],  // Initialize points as an empty array
            masks: [],
            color: maskColors[(currentObjectId - 1) % maskColors.length]
        };
    }
    
    // Ensure points is an array
    if (!Array.isArray(objects[currentObjectId].points)) {
        objects[currentObjectId].points = [];
    }
    
    // Add negative point with label 0 to current object
    objects[currentObjectId].points.push({
        x: scaledX,
        y: scaledY,
        label: 0,  // Always 0 for negative points
        obj_id: currentObjectId  // Sequential ID starting from 1
    });
    
    if (DEBUG) {
        console.log(`Added negative point with label 0 to object ${currentObjectId}`);
    }
    
    // Collect all points for current frame
    const framePoints = [];
    for (const objId in objects) {
        const obj = objects[objId];
        if (Array.isArray(obj.points)) {
            framePoints.push(...obj.points.map(point => ({
                x: point.x,
                y: point.y,
                label: point.label,  // This will be 0 for negative points
                obj_id: point.obj_id
            })));
        }
    }
    
    console.log('Sending points to server:', framePoints);
    
    try {
        const response = await fetch('/process-frame', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                frame_idx: currentFrame,
                prompts: framePoints
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('Received mask result:', result);
        
        if (result.masks) {
            // Initialize masks for current frame if not exists
            if (!masks[currentFrame]) {
                masks[currentFrame] = {};
            }
            
            // Store the mask data for the current object
            masks[currentFrame][currentObjectId] = result.masks;
            
            if (DEBUG) {
                console.log('Stored mask data:', {
                    frame: currentFrame,
                    objectId: currentObjectId,
                    maskDimensions: result.masks.length + 'x' + (result.masks[0] ? result.masks[0].length : 'unknown')
                });
            }
            
            drawFrame();  // Redraw frame with new mask
        }
    } catch (error) {
        console.error('Error processing frame:', error);
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
        if (DEBUG) {
            console.log(`Drawing masks for frame ${currentFrame}:`, {
                objects: Object.keys(masks[currentFrame]).length,
                objectIds: Object.keys(masks[currentFrame])
            });
        }
        drawMasks(masks[currentFrame]);
    } else if (DEBUG) {
        console.log(`No masks available for frame ${currentFrame}`);
    }
    
    // Draw points for current frame
    Object.values(objects).forEach(object => {
        // Ensure points is an array
        const points = Array.isArray(object.points) ? object.points : [];
        
        if (DEBUG) {
            console.log(`Drawing points for object ${object.id}:`, {
                pointsCount: points.length,
                points: points
            });
        }
        
        points.forEach(point => {
            if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') {
                console.warn('Invalid point data:', point);
                return;
            }
            
            // Scale coordinates to canvas dimensions
            const x = point.x * (canvasElement.width / videoWidth);
            const y = point.y * (canvasElement.height / videoHeight);
            
            // Determine point color based on label
            let fillColor;
            if (point.label === 0) {
                // Negative points (background) are red
                fillColor = 'rgba(255, 0, 0, 0.7)';
            } else {
                // Positive points use the object's color
                fillColor = object.color;
            }
            
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, 2 * Math.PI);
            ctx.fillStyle = fillColor;
            ctx.strokeStyle = 'white';
            ctx.fill();
            ctx.stroke();
            
            // Add a small label number for positive points
            if (point.label > 0) {
                ctx.fillStyle = 'white';
                ctx.font = '10px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(point.label.toString(), x, y);
            }
        });
    });
    
    // Add a debug message on the canvas
    if (DEBUG) {
        ctx.fillStyle = 'white';
        ctx.font = '14px Arial';
        ctx.fillText(`Frame: ${currentFrame}`, 10, 20);
        ctx.fillText(`Masks: ${masks[currentFrame] ? Object.keys(masks[currentFrame]).length : 0}`, 10, 40);
        
        // Draw a debug visualization of the mask data
        if (masks[currentFrame] && masks[currentFrame][currentObjectId]) {
            const mask = masks[currentFrame][currentObjectId];
            const debugSize = 100;
            const debugX = canvasElement.width - debugSize - 10;
            const debugY = 10;
            
            // Draw a border around the debug visualization
            ctx.strokeStyle = 'yellow';
            ctx.lineWidth = 2;
            ctx.strokeRect(debugX, debugY, debugSize, debugSize);
            
            // Draw the mask data as a heatmap
            if (Array.isArray(mask)) {
                const cellSize = debugSize / Math.min(mask.length, 20);
                const maxRows = Math.min(mask.length, 20);
                const maxCols = Array.isArray(mask[0]) ? Math.min(mask[0].length, 20) : Math.min(Math.sqrt(mask.length), 20);
                
                for (let i = 0; i < maxRows; i++) {
                    for (let j = 0; j < maxCols; j++) {
                        const value = Array.isArray(mask[0]) ? mask[i][j] : mask[i * maxCols + j];
                        const intensity = value > 0 ? Math.min(value, 1) : 0;
                        
                        ctx.fillStyle = `rgba(255, 0, 0, ${intensity})`;
                        ctx.fillRect(
                            debugX + j * cellSize, 
                            debugY + i * cellSize, 
                            cellSize, 
                            cellSize
                        );
                    }
                }
            }
        }
    }
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
    
    // Create a single ImageData object for all masks
    const imageData = maskCtx.createImageData(canvasElement.width, canvasElement.height);
    const data = imageData.data;
    
    // Draw each object's mask
    Object.values(objects).forEach((object, index) => {
        if (frameMasks[object.id]) {
            const mask = frameMasks[object.id];
            
            if (DEBUG) {
                console.log(`Drawing mask for object ${object.id}:`, {
                    dimensions: Array.isArray(mask[0]) ? 
                        `${mask.length}x${mask[0].length}` : 
                        `${mask.length}x${Math.sqrt(mask[0].length)}`,
                    sample: mask.slice(0, 3).map(row => Array.isArray(row) ? row.slice(0, 3) : row)
                });
            }
            
            // Get the object's color
            const color = parseRGBA(object.color);
            
            // Handle different mask formats:
            // 1. 3D array [num_objects, height, width] from backend
            // 2. 2D array [height, width] for single object
            // 3. 1D array [height * width] that needs to be reshaped
            if (Array.isArray(mask) && mask.length > 0) {
                let maskData;
                let maskHeight, maskWidth;
                
                if (Array.isArray(mask[0]) && Array.isArray(mask[0][0])) {
                    // Case 1: 3D array [num_objects, height, width]
                    console.log("Processing 3D mask array format");
                    maskData = mask[index] || mask[0]; // Get the mask for this object index
                    maskHeight = maskData.length;
                    maskWidth = maskData[0].length;
                } else if (Array.isArray(mask[0])) {
                    // Case 2: 2D array [height, width]
                    console.log("Processing 2D mask array format");
                    maskData = mask;
                    maskHeight = mask.length;
                    maskWidth = mask[0].length;
                } else {
                    // Case 3: 1D array [height * width]
                    console.log("Processing 1D mask array format");
                    maskHeight = Math.sqrt(mask.length);
                    maskWidth = maskHeight;
                    maskData = mask;
                }
                
                console.log(`Processing mask with dimensions ${maskWidth}x${maskHeight}`);
                
                // Scale factors for mapping mask coordinates to canvas coordinates
                const scaleX = canvasElement.width / maskWidth;
                const scaleY = canvasElement.height / maskHeight;
                
                // Convert the mask data to canvas pixels
                for (let y = 0; y < canvasElement.height; y++) {
                    for (let x = 0; x < canvasElement.width; x++) {
                        // Map canvas coordinates back to mask coordinates
                        const maskY = Math.floor(y / scaleY);
                        const maskX = Math.floor(x / scaleX);
                        
                        // Get mask value based on data format
                        let maskValue = 0;
                        if (Array.isArray(maskData[maskY])) {
                            // 2D array format
                            maskValue = maskData[maskY][maskX] || 0;
                        } else {
                            // 1D array format
                            const idx = maskY * maskWidth + maskX;
                            maskValue = maskData[idx] || 0;
                        }
                        
                        // Check if the mask has a value at this position
                        if (maskY < maskHeight && maskX < maskWidth && maskValue > 0) {
                            const idx = (y * canvasElement.width + x) * 4;
                            // Blend the colors using alpha compositing
                            const alpha = color.a * 255;
                            data[idx] = (data[idx] * (255 - alpha) + color.r * alpha) / 255;     // R
                            data[idx + 1] = (data[idx + 1] * (255 - alpha) + color.g * alpha) / 255; // G
                            data[idx + 2] = (data[idx + 2] * (255 - alpha) + color.b * alpha) / 255; // B
                            data[idx + 3] = Math.min(255, data[idx + 3] + alpha); // A
                        }
                    }
                }
            }
        }
    });
    
    // Put the accumulated mask data onto the canvas
    maskCtx.putImageData(imageData, 0, 0);
    
    // Composite mask onto main canvas
    ctx.drawImage(maskCanvas, 0, 0);
    
    // Add a debug outline to make sure the mask is visible
    ctx.strokeStyle = 'yellow';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, canvasElement.width, canvasElement.height);
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
    // Generate a new sequential ID starting from 1
    const newId = Object.keys(objects).length + 1;
    
    // Create a new object with the next available label
    objects[newId] = {
        id: newId,
        label: `Object ${newId}`,
        points: [],  // Initialize points as an empty array
        masks: [],
        color: maskColors[(newId - 1) % maskColors.length]
    };
    
    // Set the new object as the current object
    currentObjectId = newId;
    
    // Update the objects list in the UI
    updateObjectsList();
    
    if (DEBUG) {
        console.log(`Added new object with ID ${newId} and label ${objects[newId].label}`);
    }
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
    Object.values(objects).forEach(obj => {
        if (Array.isArray(obj.points)) {
            obj.points.forEach(point => {
                const frameIndex = currentFrame;
                if (!prompts[frameIndex]) {
                    prompts[frameIndex] = [];
                }
                prompts[frameIndex].push({
                    x: point.x,
                    y: point.y,
                    label: point.label,
                    obj_id: point.obj_id
                });
            });
        }
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
                        dimensions: masks[Object.keys(masks)[0]][currentObjectId] ? 
                            `${masks[Object.keys(masks)[0]][currentObjectId].length}x${masks[Object.keys(masks)[0]][currentObjectId][0].length}` : 
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
    objectsList.innerHTML = Object.values(objects).map(obj => `
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
    objects = {};
    currentObjectId = null;
    currentAction = 'add';
    
    // Create initial object with ID 1
    currentObjectId = 1;
    objects[currentObjectId] = {
        id: currentObjectId,
        label: 'Object 1',
        points: [],
        masks: [],
        color: maskColors[0]
    };
    
    if (DEBUG) {
        console.log(`Reset state: Created initial object with ID ${currentObjectId} and label 1`);
    }
    
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
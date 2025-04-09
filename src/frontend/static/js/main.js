// Constants
const DEBUG = true;
const MASK_COLORS = [
    'rgba(255, 165, 0, 0.5)',  // Orange
    'rgba(106, 90, 205, 0.5)', // Slate blue
    'rgba(50, 205, 50, 0.5)',  // Lime green
    'rgba(255, 105, 180, 0.5)', // Hot pink
    'rgba(70, 130, 180, 0.5)'  // Steel blue
];

// State Management
class AppState {
    constructor(ui) {
        this.ui = ui;
        this.videoFile = null;
        this.videoElement = null;
        this.canvasElement = null;
        this.ctx = null;
        this.currentFrame = 0;
        this.totalFrames = 0;
        this.fps = 0;
        this.isPlaying = false;
        this.videoWidth = 0;
        this.videoHeight = 0;
        this.isProcessing = false;
        this.currentVideo = null;
        this.masks = {};
        this.maskOpacity = 0.5;
        this.objects = {};
        this.currentObjectId = null;
        this.currentAction = 'add';
    }

    reset() {
        this.currentFrame = 0;
        this.isPlaying = false;
        this.objects = {};
        this.currentObjectId = 1;
        this.currentAction = 'add';
        
        // Create initial object
        this.objects[this.currentObjectId] = {
            id: this.currentObjectId,
            label: 'Object 1',
            points: [],
            masks: [],
            color: MASK_COLORS[0]
        };
        
        // Update UI to show the first object as active
        this.ui.updateObjectsList();
    }
}

// UI Manager
class UIManager {
    constructor(state) {
        this.state = state;
        this.elements = {
            uploadForm: document.getElementById('upload-form'),
            uploadSection: document.getElementById('upload-section'),
            workspace: document.getElementById('workspace'),
            canvas: document.getElementById('canvas'),
            playPauseBtn: document.getElementById('play-pause'),
            frameSlider: document.getElementById('frame-slider'),
            frameDisplay: document.getElementById('frame-display'),
            addObjectBtn: document.getElementById('add-object'),
            startOverBtn: document.getElementById('start-over'),
            trackObjectsBtn: document.getElementById('track-objects'),
            tooltip: document.getElementById('tooltip'),
            uploadArea: document.getElementById('upload-area'),
            uploadProgress: document.getElementById('upload-progress'),
            progressFill: document.querySelector('.progress-fill'),
            progressText: document.querySelector('.progress-text'),
            fileInput: document.getElementById('file-input')
        };
    }

    updateUIState() {
        const controls = [
            this.elements.playPauseBtn,
            this.elements.frameSlider,
            this.elements.addObjectBtn,
            this.elements.startOverBtn,
            this.elements.trackObjectsBtn
        ];
        
        controls.forEach(control => {
            if (control) {
                control.disabled = this.state.isProcessing;
            }
        });
        
        this.elements.canvas.style.opacity = this.state.isProcessing ? '0.7' : '1';
    }

    updateObjectsList() {
        const objectsList = document.querySelector('.objects-list');
        objectsList.innerHTML = Object.values(this.state.objects).map(obj => `
            <div class="object-item ${obj.id === this.state.currentObjectId ? 'active' : ''}" data-id="${obj.id}">
                <div class="object-preview">
                    ${obj.thumbnail ? `<img src="${obj.thumbnail}" alt="${obj.label}">` : ''}
                </div>
                <div class="object-label">${obj.label}</div>
                <div class="object-controls">
                    <button class="remove-object-btn" title="Remove object">
                        <span class="icon">×</span>
                    </button>
                </div>
            </div>
        `).join('');
    }

    showWorkspace() {
        this.elements.uploadSection.style.display = 'none';
        this.elements.workspace.style.display = 'flex';
    }

    showTooltip() {
        this.elements.tooltip.style.display = 'block';
    }

    hideTooltip() {
        this.elements.tooltip.style.display = 'none';
    }
}

// Video Manager
class VideoManager {
    constructor(state, ui) {
        this.state = state;
        this.ui = ui;
    }

    async loadVideo(filename) {
        return new Promise((resolve, reject) => {
            this.state.videoElement = document.createElement('video');
            this.state.videoElement.src = `/static/videos/${filename}`;
            this.state.videoElement.crossOrigin = 'anonymous';
            
            this.state.videoElement.addEventListener('loadedmetadata', () => {
                this.state.canvasElement.width = this.state.videoWidth;
                this.state.canvasElement.height = this.state.videoHeight;
                this.state.ctx = this.state.canvasElement.getContext('2d');
                
                this.state.videoElement.currentTime = 0;
                this.state.videoElement.addEventListener('seeked', () => {
                    this.drawFrame();
                    resolve();
                }, { once: true });
            });
            
            this.state.videoElement.addEventListener('error', (e) => {
                console.error('Error loading video:', e);
                reject(new Error('Error loading video'));
            });
        });
    }

    togglePlayPause() {
        if (!this.state.videoElement) return;
        
        if (this.state.isPlaying) {
            this.state.videoElement.pause();
            this.ui.elements.playPauseBtn.innerHTML = '<span class="icon">▶</span>';
        } else {
            this.state.videoElement.play();
            this.ui.elements.playPauseBtn.innerHTML = '<span class="icon">⏸</span>';
            requestAnimationFrame(() => this.updatePlayback());
        }
        
        this.state.isPlaying = !this.state.isPlaying;
    }

    updatePlayback() {
        if (!this.state.isPlaying) return;
        
        this.state.currentFrame = Math.floor(this.state.videoElement.currentTime * this.state.fps);
        this.ui.elements.frameSlider.value = this.state.currentFrame;
        this.ui.elements.frameDisplay.textContent = this.formatTime(this.state.videoElement.currentTime);
        
        this.drawFrame();
        
        if (this.state.currentFrame < this.state.totalFrames - 1) {
            requestAnimationFrame(() => this.updatePlayback());
        } else {
            this.togglePlayPause();
        }
    }

    drawFrame() {
        if (!this.state.ctx || !this.state.videoElement) return;
        
        // Clear canvas
        this.state.ctx.clearRect(0, 0, this.state.canvasElement.width, this.state.canvasElement.height);
        
        // Draw video frame
        this.state.ctx.drawImage(this.state.videoElement, 0, 0, this.state.canvasElement.width, this.state.canvasElement.height);
        
        // Draw masks and points
        this.drawMasks();
        this.drawPoints();
    }

    drawMasks() {
        if (!this.state.ctx || !this.state.masks[this.state.currentFrame]) return;
        
        const frameMasks = this.state.masks[this.state.currentFrame];
        console.log('Drawing masks for frame', this.state.currentFrame, {
            objects: Object.keys(frameMasks).length,
            objectIds: Object.keys(frameMasks)
        });
        
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = this.state.canvasElement.width;
        maskCanvas.height = this.state.canvasElement.height;
        const maskCtx = maskCanvas.getContext('2d');
        
        const imageData = maskCtx.createImageData(this.state.canvasElement.width, this.state.canvasElement.height);
        const data = imageData.data;
        
        // Process each object's mask
        Object.entries(frameMasks).forEach(([objectId, mask]) => {
            const object = this.state.objects[objectId];
            if (!object) {
                console.warn(`No object found for ID ${objectId}`);
                return;
            }
            
            console.log(`Processing mask for object ${objectId}:`, {
                maskType: Array.isArray(mask) ? 'array' : typeof mask,
                maskLength: Array.isArray(mask) ? mask.length : 'N/A',
                firstElement: Array.isArray(mask) && mask.length > 0 ? 
                    (Array.isArray(mask[0]) ? 'array' : typeof mask[0]) : 'N/A'
            });
            
            const color = this.parseRGBA(object.color);
            
            // Handle different mask formats
            let maskData, maskHeight, maskWidth;
            
            if (Array.isArray(mask) && mask.length > 0) {
                if (Array.isArray(mask[0]) && Array.isArray(mask[0][0])) {
                    // Case 1: 3D array [num_objects, height, width]
                    console.log("Processing 3D mask array format");
                    // Get the mask for this object index (objectId - 1 because objectId is 1-based)
                    const objectIndex = parseInt(objectId) - 1;  // Convert to 0-based index
                    maskData = mask[objectIndex] || mask[0];
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
                
                console.log(`Processing mask for object ${objectId} with dimensions ${maskWidth}x${maskHeight}`);
                
                // Scale factors for mapping mask coordinates to canvas coordinates
                const scaleX = this.state.canvasElement.width / maskWidth;
                const scaleY = this.state.canvasElement.height / maskHeight;
                
                // Convert the mask data to canvas pixels
                for (let y = 0; y < this.state.canvasElement.height; y++) {
                    for (let x = 0; x < this.state.canvasElement.width; x++) {
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
                            const idx = (y * this.state.canvasElement.width + x) * 4;
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
        });
        
        // Put the accumulated mask data onto the canvas
        maskCtx.putImageData(imageData, 0, 0);
        
        // Composite mask onto main canvas
        this.state.ctx.drawImage(maskCanvas, 0, 0);
    }

    drawPoints() {
        if (!this.state.ctx) return;
        
        Object.values(this.state.objects).forEach(object => {
            const points = Array.isArray(object.points) ? object.points : [];
            
            points.forEach(point => {
                if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') {
                    console.warn('Invalid point data:', point);
                    return;
                }
                
                // Only draw points that match the current frame index
                if (point.frame_idx !== this.state.currentFrame) {
                    return;
                }
                
                const x = point.x * (this.state.canvasElement.width / this.state.videoWidth);
                const y = point.y * (this.state.canvasElement.height / this.state.videoHeight);
                
                const fillColor = point.label === 0 ? 'rgba(255, 0, 0, 0.7)' : object.color;
                
                this.state.ctx.beginPath();
                this.state.ctx.arc(x, y, 5, 0, 2 * Math.PI);
                this.state.ctx.fillStyle = fillColor;
                this.state.ctx.strokeStyle = 'white';
                this.state.ctx.fill();
                this.state.ctx.stroke();
                
                if (point.label > 0) {
                    this.state.ctx.fillStyle = 'white';
                    this.state.ctx.font = '10px Arial';
                    this.state.ctx.textAlign = 'center';
                    this.state.ctx.textBaseline = 'middle';
                    this.state.ctx.fillText(point.label.toString(), x, y);
                }
            });
        });
    }

    parseRGBA(rgba) {
        const match = rgba.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
        if (match) {
            return {
                r: parseInt(match[1]),
                g: parseInt(match[2]),
                b: parseInt(match[3]),
                a: parseFloat(match[4])
            };
        }
        return { r: 255, g: 165, b: 0, a: 0.5 };
    }

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}

// Object Manager
class ObjectManager {
    constructor(state, ui, videoManager) {
        this.state = state;
        this.ui = ui;
        this.videoManager = videoManager;
    }

    setActiveObject(objectId) {
        this.state.currentObjectId = objectId;
        this.ui.updateObjectsList();
    }

    addObject() {
        const newId = Object.keys(this.state.objects).length + 1;
        
        this.state.objects[newId] = {
            id: newId,
            label: `Object ${newId}`,
            points: [],
            masks: [],
            color: MASK_COLORS[(newId - 1) % MASK_COLORS.length]
        };
        
        this.state.currentObjectId = newId;
        this.ui.updateObjectsList();
    }

    startOver() {
        if (confirm('Are you sure you want to start over? All points will be cleared.')) {
            // Clear all objects, points, and masks
            this.state.objects = {};
            this.state.masks = {};
            this.state.currentFrame = 0;
            this.state.isPlaying = false;
            
            // Reset to initial state with one object
            this.state.currentObjectId = 1;
            this.state.currentAction = 'add';
            
            // Create initial object
            this.state.objects[this.state.currentObjectId] = {
                id: this.state.currentObjectId,
                label: 'Object 1',
                points: [],
                masks: [],
                color: MASK_COLORS[0]
            };
            
            // Update UI
            this.ui.updateObjectsList();
            
            // Reset video to beginning if it exists
            if (this.state.videoElement) {
                this.state.videoElement.currentTime = 0;
                this.videoManager.drawFrame();
            }
        }
    }

    async handleCanvasClick(event, isRightClick = false) {
        if (!this.state.videoElement) return;
        
        const rect = this.state.canvasElement.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        const scaleX = this.state.videoWidth / rect.width;
        const scaleY = this.state.videoHeight / rect.height;
        const scaledX = x * scaleX;
        const scaledY = y * scaleY;
        
        if (this.state.currentObjectId === null) {
            this.state.currentObjectId = Object.keys(this.state.objects).length + 1;
            this.state.objects[this.state.currentObjectId] = {
                id: this.state.currentObjectId,
                label: `Object ${this.state.currentObjectId}`,
                points: [],
                masks: [],
                color: MASK_COLORS[(this.state.currentObjectId - 1) % MASK_COLORS.length]
            };
        }
        
        if (!Array.isArray(this.state.objects[this.state.currentObjectId].points)) {
            this.state.objects[this.state.currentObjectId].points = [];
        }
        
        // Store the current frame index with the point
        const currentFrameIdx = this.state.currentFrame;
        
        // Check if a point already exists at this location
        const existingPointIndex = this.findPointAtLocation(scaledX, scaledY, currentFrameIdx);
        
        if (existingPointIndex !== -1) {
            // Remove the existing point
            this.state.objects[this.state.currentObjectId].points.splice(existingPointIndex, 1);
            console.log(`Removed point at (${scaledX}, ${scaledY})`);
        } else {
            // Add a new point
            this.state.objects[this.state.currentObjectId].points.push({
                x: scaledX,
                y: scaledY,
                label: isRightClick ? 0 : 1,  // 0 for negative prompts (right click), 1 for positive prompts (left click)
                obj_id: this.state.currentObjectId,
                frame_idx: currentFrameIdx  // Store the frame index at the time of point creation
            });
            console.log(`Added point at (${scaledX}, ${scaledY})`);
        }
        
        await this.processFrame();
        this.videoManager.drawFrame();  // Ensure the frame is redrawn after processing
    }
    
    // Helper method to find if a point exists at the given location
    findPointAtLocation(x, y, frameIdx) {
        const points = this.state.objects[this.state.currentObjectId].points;
        const clickRadius = 10; // Radius in pixels to consider a click as "on" a point
        
        for (let i = 0; i < points.length; i++) {
            const point = points[i];
            // Only check points for the current frame
            if (point.frame_idx !== frameIdx) continue;
            
            // Calculate distance between click and point
            const dx = point.x - x;
            const dy = point.y - y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // If within the click radius, consider it a hit
            if (distance < clickRadius) {
                return i;
            }
        }
        
        return -1; // No point found at this location
    }

    async processFrame() {
        const framePoints = [];
        for (const objId in this.state.objects) {
            const obj = this.state.objects[objId];
            if (Array.isArray(obj.points)) {
                framePoints.push(...obj.points.map(point => ({
                    x: point.x,
                    y: point.y,
                    label: point.label,
                    obj_id: point.obj_id - 1,  // Convert to 0-based index for backend
                    frame_idx: point.frame_idx
                })));
            }
        }
        
        console.log('Sending points to backend:', framePoints);
        
        try {
            const response = await fetch('/process-frame', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    frame_idx: this.state.currentFrame,
                    prompts: framePoints
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            console.log('Received mask result:', result);
            
            if (result.masks) {
                // Process each frame's masks in the response
                Object.entries(result.masks).forEach(([frameIdx, maskData]) => {
                    // Initialize masks for this frame if not exists
                    if (!this.state.masks[frameIdx]) {
                        this.state.masks[frameIdx] = {};
                    }
                    
                    // Store the mask data for each object that was processed
                    // The backend returns masks for each object ID
                    Object.entries(maskData).forEach(([objId, mask]) => {
                        // Convert from 0-based backend index to 1-based frontend index
                        const frontendObjId = parseInt(objId) + 1;
                        
                        // Store the mask for this object
                        this.state.masks[frameIdx][frontendObjId] = mask;
                        
                        console.log(`Stored mask for frame ${frameIdx}, object ${frontendObjId}:`, {
                            maskDimensions: Array.isArray(mask) ? 
                                `${mask.length}x${Array.isArray(mask[0]) ? mask[0].length : 'unknown'}` : 
                                'unknown format'
                        });
                    });
                });
                
                console.log('Current frame masks:', this.state.masks[this.state.currentFrame]);
                this.videoManager.drawFrame();
            }
        } catch (error) {
            console.error('Error processing frame:', error);
        }
    }

    async trackObjects() {
        if (!this.state.currentVideo) return;
        
        const prompts = [];
        for (const objId in this.state.objects) {
            const obj = this.state.objects[objId];
            if (Array.isArray(obj.points)) {
                prompts.push(...obj.points.map(point => ({
                    x: point.x,
                    y: point.y,
                    label: point.label,
                    obj_id: point.obj_id - 1,  // Convert to 0-based index for backend
                    frame_idx: point.frame_idx
                })));
            }
        }
        
        console.log('Sending video processing request with prompts:', prompts);
        
        try {
            this.state.isProcessing = true;
            this.ui.updateUIState();
            
            const response = await fetch('/process-video', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    filename: this.state.currentVideo.filename,
                    prompts: prompts
                })
            });
            
            if (!response.ok) {
                throw new Error(`Processing failed: ${await response.text()}`);
            }
            
            const data = await response.json();
            console.log('Received video processing result:', data);
            
            if (data.status === 'success') {
                // Initialize masks for all frames
                this.state.masks = {};
                
                // Process masks for each frame
                Object.entries(data.masks).forEach(([frameIdx, maskData]) => {
                    // Initialize masks for this frame if not exists
                    if (!this.state.masks[frameIdx]) {
                        this.state.masks[frameIdx] = {};
                    }
                    
                    // Store the mask data for each object that was processed
                    // The backend returns masks for each object ID
                    Object.entries(maskData).forEach(([objId, mask]) => {
                        // Convert from 0-based backend index to 1-based frontend index
                        const frontendObjId = parseInt(objId) + 1;
                        
                        // Store the mask for this object
                        this.state.masks[frameIdx][frontendObjId] = mask;
                        
                        console.log(`Stored mask for frame ${frameIdx}, object ${frontendObjId}:`, {
                            maskDimensions: Array.isArray(mask) ? 
                                `${mask.length}x${Array.isArray(mask[0]) ? mask[0].length : 'unknown'}` : 
                                'unknown format'
                        });
                    });
                });
                
                console.log('Processed all frame masks:', this.state.masks);
                this.videoManager.drawFrame();
            } else {
                throw new Error('Processing failed: ' + data.message);
            }
        } catch (error) {
            console.error('Error processing video:', error);
            alert(error.message);
        } finally {
            this.state.isProcessing = false;
            this.ui.updateUIState();
        }
    }
}

// File Manager
class FileManager {
    constructor(state, ui) {
        this.state = state;
        this.ui = ui;
    }

    async handleFile(file) {
        this.state.videoFile = file;
        
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            this.state.isProcessing = true;
            this.ui.updateUIState();
            
            this.ui.elements.uploadProgress.style.display = 'block';
            this.ui.elements.progressFill.style.width = '0%';
            this.ui.elements.progressText.textContent = 'Uploading...';
            
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                throw new Error(`Upload failed: ${await response.text()}`);
            }
            
            const data = await response.json();
            
            if (data.status === 'success') {
                this.ui.elements.progressFill.style.width = '100%';
                this.ui.elements.progressText.textContent = 'Processing...';
                
                this.state.currentVideo = {
                    filename: data.filename,
                    frames: data.frames,
                    fps: data.fps,
                    width: data.width,
                    height: data.height
                };
                
                this.state.totalFrames = data.frames;
                this.state.fps = data.fps;
                this.state.videoWidth = data.width;
                this.state.videoHeight = data.height;
                
                this.ui.elements.frameSlider.max = this.state.totalFrames - 1;
                this.ui.elements.frameSlider.value = 0;
                this.ui.elements.frameDisplay.textContent = '0:00';
                
                await this.ui.videoManager.loadVideo(data.filename);
                
                this.state.reset();
                
                this.ui.showWorkspace();
                this.ui.showTooltip();
            }
        } catch (error) {
            console.error('Error uploading file:', error);
            alert(error.message);
        } finally {
            this.state.isProcessing = false;
            this.ui.updateUIState();
        }
    }
}

// Application
class Application {
    constructor() {
        this.ui = new UIManager();
        this.state = new AppState(this.ui);
        this.ui.state = this.state;
        this.videoManager = new VideoManager(this.state, this.ui);
        this.objectManager = new ObjectManager(this.state, this.ui, this.videoManager);
        this.fileManager = new FileManager(this.state, this.ui);
        
        this.ui.videoManager = this.videoManager;
    }

    init() {
        // Initialize canvas
        this.state.canvasElement = this.ui.elements.canvas;
        if (!this.state.canvasElement) {
            console.error('Canvas element not found');
            return;
        }
        
        // File upload handlers
        this.ui.elements.uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.ui.elements.uploadArea.classList.add('drag-over');
        });
        
        this.ui.elements.uploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.ui.elements.uploadArea.classList.remove('drag-over');
        });
        
        this.ui.elements.uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.ui.elements.uploadArea.classList.remove('drag-over');
            
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('video/')) {
                this.fileManager.handleFile(file);
            } else {
                alert('Please drop a valid video file');
            }
        });
        
        this.ui.elements.fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file && file.type.startsWith('video/')) {
                this.fileManager.handleFile(file);
            } else {
                alert('Please select a valid video file');
            }
        });
        
        this.ui.elements.uploadArea.addEventListener('click', () => this.ui.elements.fileInput.click());
        
        // Video control handlers
        this.ui.elements.playPauseBtn.addEventListener('click', () => this.videoManager.togglePlayPause());
        this.ui.elements.frameSlider.addEventListener('input', (e) => {
            if (this.state.videoElement) {
                const frameValue = parseInt(e.target.value);
                this.state.currentFrame = frameValue;
                this.state.videoElement.currentTime = frameValue / this.state.fps;
                this.videoManager.drawFrame();
                this.ui.elements.frameDisplay.textContent = this.videoManager.formatTime(this.state.videoElement.currentTime);
            }
        });
        
        // Object control handlers
        this.ui.elements.addObjectBtn.addEventListener('click', () => this.objectManager.addObject());
        this.ui.elements.startOverBtn.addEventListener('click', () => this.objectManager.startOver());
        this.ui.elements.trackObjectsBtn.addEventListener('click', () => this.objectManager.trackObjects());
        
        // Add click handler for object items
        document.querySelector('.objects-list').addEventListener('click', (e) => {
            const objectItem = e.target.closest('.object-item');
            if (objectItem && !e.target.closest('.remove-object-btn')) {
                const objectId = parseInt(objectItem.dataset.id);
                this.objectManager.setActiveObject(objectId);
            }
        });
        
        // Canvas handlers
        this.state.canvasElement.addEventListener('click', (e) => {
            // Hide tooltip when user clicks on canvas
            this.ui.hideTooltip();
            this.objectManager.handleCanvasClick(e);
        });
        this.state.canvasElement.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            // Hide tooltip when user right-clicks on canvas
            this.ui.hideTooltip();
            this.objectManager.handleCanvasClick(e, true);
        });
        
        // Tooltip handler
        this.ui.elements.tooltip.querySelector('.ok-btn').addEventListener('click', () => this.ui.hideTooltip());
    }
}

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const app = new Application();
    app.init();
}); 
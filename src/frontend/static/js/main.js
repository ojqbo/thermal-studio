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
        this.histograms = null;  // Store histograms data
    }

    reset() {
        this.currentFrame = 0;
        this.isPlaying = false;
        this.objects = {};
        this.currentObjectId = 1;
        this.histograms = null;  // Reset histograms
        
        // Create initial object
        this.objects[this.currentObjectId] = {
            id: this.currentObjectId,
            label: 'Object 1',
            points: [],
            color: MASK_COLORS[0]
        };
        
        // Update UI to show the first object as active
        this.ui.updateObjectsList();
    }
}

// UI Manager
class UIManager {
    constructor(state, fileManager) {
        this.state = state;
        this.fileManager = fileManager;
        this.app = null;  // Will be set by Application class
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
            dropZone: document.getElementById('drop-zone'),
            uploadProgress: document.getElementById('upload-progress'),
            progressFill: document.querySelector('.progress-fill'),
            progressText: document.querySelector('.progress-text'),
            fileInput: document.getElementById('file-input'),
            fileInputLabel: document.querySelector('.primary-btn')
        };
        this.histogramCanvas = document.getElementById('histogramCanvas');
        this.histogramCtx = this.histogramCanvas ? this.histogramCanvas.getContext('2d') : null;
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
        this.histogramCanvas = document.getElementById('histogramCanvas');
        this.histogramCtx = this.histogramCanvas ? this.histogramCanvas.getContext('2d') : null;
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
        this.updateHistogram();
        
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
        
        // Draw histogram for current frame and active object
        // Only draw if we're in inspection mode
        if (this.ui.app.objectManager.isInspectionMode) {
            this.drawHistogram();
        }
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
                this.state.ctx.arc(x, y, 8, 0, 2 * Math.PI);
                this.state.ctx.fillStyle = fillColor;
                this.state.ctx.strokeStyle = 'white';
                this.state.ctx.fill();
                this.state.ctx.stroke();
                
                this.state.ctx.fillStyle = 'white';
                this.state.ctx.font = '12px Arial';
                this.state.ctx.textAlign = 'center';
                this.state.ctx.textBaseline = 'middle';
                this.state.ctx.fillText(point.obj_id.toString(), x, y);
            });
        });
    }

    drawHistogram() {
        if (!this.histogramCtx || !this.state.histograms || !this.state.currentObjectId) return;

        const frameHistograms = this.state.histograms.histograms[this.state.currentFrame];
        if (!frameHistograms) return;

        // Get histogram for current object (convert from 1-based to 0-based index)
        const objectIndex = this.state.currentObjectId - 1;
        
        // Check histogram format
        const hasRGBChannels = frameHistograms.length === 3; // [3, num_objects, h, w] format
        const histograms = hasRGBChannels 
            ? frameHistograms.map(channel => channel[objectIndex]) // Get RGB channels
            : [frameHistograms[0][objectIndex]]; // Get single channel
        
        const binEdges = this.state.histograms.bin_edges[0]; // Use first channel's bin edges

        if (!histograms || !binEdges) return;

        // Clear histogram canvas
        this.histogramCtx.clearRect(0, 0, this.histogramCanvas.width, this.histogramCanvas.height);

        // Set up histogram drawing
        const width = this.histogramCanvas.width;
        const height = this.histogramCanvas.height;
        const padding = { top: 20, right: 30, bottom: 30, left: 40 };
        const graphWidth = width - padding.left - padding.right;
        const graphHeight = height - padding.top - padding.bottom;

        // Draw background
        this.histogramCtx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        this.histogramCtx.fillRect(0, 0, width, height);

        // Draw axes
        this.histogramCtx.strokeStyle = '#666';
        this.histogramCtx.lineWidth = 1;
        this.histogramCtx.beginPath();
        this.histogramCtx.moveTo(padding.left, padding.top);
        this.histogramCtx.lineTo(padding.left, height - padding.bottom);
        this.histogramCtx.lineTo(width - padding.right, height - padding.bottom);
        this.histogramCtx.stroke();

        // Find max value across all channels for scaling
        const maxValue = Math.max(...histograms.map(h => Math.max(...h)));

        // Draw histogram lines for each channel
        const channelColors = hasRGBChannels ? ['#FF4444', '#44FF44', '#4444FF'] : ['#FFFFFF'];
        const barWidth = graphWidth / 256; // 256 bins

        histograms.forEach((histogram, channelIndex) => {
            this.histogramCtx.strokeStyle = channelColors[channelIndex];
            this.histogramCtx.lineWidth = 1;
            this.histogramCtx.beginPath();
            
            histogram.forEach((value, i) => {
                const x = padding.left + i * barWidth;
                const y = height - padding.bottom - (value / maxValue) * graphHeight;
                
                if (i === 0) {
                    this.histogramCtx.moveTo(x, y);
                } else {
                    this.histogramCtx.lineTo(x, y);
                }
            });
            
            this.histogramCtx.stroke();
        });

        // Draw labels
        this.histogramCtx.fillStyle = '#fff';
        this.histogramCtx.font = '10px Arial';
        
        // X-axis labels
        const numXLabels = 5;
        this.histogramCtx.textAlign = 'center';
        this.histogramCtx.textBaseline = 'top';
        for (let i = 0; i <= numXLabels; i++) {
            const x = padding.left + (i / numXLabels) * graphWidth;
            const binIndex = Math.floor((i / numXLabels) * 255);
            this.histogramCtx.fillText(binIndex.toString(), x, height - padding.bottom + 5);
        }

        // Y-axis labels
        const numYLabels = 5;
        this.histogramCtx.textAlign = 'right';
        this.histogramCtx.textBaseline = 'middle';
        for (let i = 0; i <= numYLabels; i++) {
            const y = height - padding.bottom - (i / numYLabels) * graphHeight;
            const value = Math.round((i / numYLabels) * maxValue);
            this.histogramCtx.fillText(value.toString(), padding.left - 5, y);
        }

        // Draw channel legend only if we have RGB channels
        if (hasRGBChannels) {
            const legendItems = ['R', 'G', 'B'];
            const legendWidth = 15;
            const legendSpacing = 40;
            const legendY = padding.top + 10;

            legendItems.forEach((item, i) => {
                const x = padding.left + i * legendSpacing;
                
                // Draw color box
                this.histogramCtx.fillStyle = channelColors[i];
                this.histogramCtx.fillRect(x, legendY, legendWidth, legendWidth);
                
                // Draw label
                this.histogramCtx.fillStyle = '#fff';
                this.histogramCtx.textAlign = 'left';
                this.histogramCtx.textBaseline = 'middle';
                this.histogramCtx.fillText(item, x + legendWidth + 5, legendY + legendWidth/2);
            });
        }
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

    updateHistogram() {
        if (this.ui.app.objectManager.isInspectionMode) {
            requestAnimationFrame(() => this.drawHistogram());
        }
    }
}

// Object Manager
class ObjectManager {
    constructor(state, ui, videoManager) {
        this.state = state;
        this.ui = ui;
        this.videoManager = videoManager;
        this.canvasClickHandler = (e) => {
            this.ui.hideTooltip();
            this.handleCanvasClick(e);
        };
        this.canvasRightClickHandler = (e) => {
            e.preventDefault();
            this.ui.hideTooltip();
            this.handleCanvasClick(e, true);
        };
        this.isInspectionMode = false;
    }

    setActiveObject(objectId) {
        this.state.currentObjectId = objectId;
        this.ui.updateObjectsList();
        
        // Also update the inspection mode objects list if we're in inspection mode
        if (this.isInspectionMode) {
            this.updateInspectionObjectsList();
            // Update the histogram for the newly selected object
            this.videoManager.updateHistogram();
        }
    }

    addObject() {
        const newId = Object.keys(this.state.objects).length + 1;
        
        this.state.objects[newId] = {
            id: newId,
            label: `Object ${newId}`,
            points: [],
            color: MASK_COLORS[(newId - 1) % MASK_COLORS.length]
        };
        
        this.state.currentObjectId = newId;
        this.ui.updateObjectsList();
    }

    removeObject(objectId) {
        if (Object.keys(this.state.objects).length <= 1) {
            alert("Cannot remove the last object. Use 'Start Over' to reset all objects.");
            return;
        }
        
        // Remove the object
        delete this.state.objects[objectId];
        
        // Create ID mapping from old to new
        const objectKeys = Object.keys(this.state.objects).map(id => parseInt(id));
        const idMapping = {};
        objectKeys.sort((a, b) => a - b).forEach((oldId, index) => {
            idMapping[oldId] = index + 1;
        });
        
        // Remap the remaining object IDs to be sequential from 1 to N-1
        const remappedObjects = {};
        
        // Create a new object with remapped IDs
        objectKeys.forEach(oldId => {
            const newId = idMapping[oldId];
            const oldObject = this.state.objects[oldId];
            
            // Create a new object with the updated ID
            remappedObjects[newId] = {
                ...oldObject,
                id: newId,
                label: `Object ${newId}`,
                color: MASK_COLORS[(newId - 1) % MASK_COLORS.length]
            };
            
            // Update any points that reference this object
            if (Array.isArray(remappedObjects[newId].points)) {
                remappedObjects[newId].points = remappedObjects[newId].points.map(point => ({
                    ...point,
                    obj_id: newId
                }));
            }
        });
        
        // Replace the old objects with the remapped ones
        this.state.objects = remappedObjects;
        
        // Update all masks to use the new object IDs
        if (this.state.masks) {
            const remappedMasks = {};
            
            Object.entries(this.state.masks).forEach(([frameIdx, frameMasks]) => {
                remappedMasks[frameIdx] = {};
                
                Object.entries(frameMasks).forEach(([oldObjId, mask]) => {
                    // Skip the removed object
                    if (parseInt(oldObjId) === objectId) return;
                    
                    // Map to new ID or keep the same if not in mapping
                    const newObjId = idMapping[oldObjId] || oldObjId;
                    remappedMasks[frameIdx][newObjId] = mask;
                });
            });
            
            this.state.masks = remappedMasks;
        }
        
        // If the removed object was the current one, set a new current object
        if (this.state.currentObjectId === objectId) {
            // Set the current object to the first available one
            this.state.currentObjectId = 1;
        } else {
            // Map the current object ID to its new ID
            this.state.currentObjectId = idMapping[this.state.currentObjectId] || 1;
        }
        
        // Update the UI
        this.ui.updateObjectsList();
        
        // Redraw the frame to update the display
        this.videoManager.drawFrame();
    }

    startOver(customMessage = 'Are you sure you want to start over? All points will be cleared.') {
        if (confirm(customMessage)) {
            // Clear all objects, points, and masks
            this.state.objects = {};
            this.state.masks = {};
            this.state.currentFrame = 0;
            this.state.isPlaying = false;
            
            // Reset to initial state with one object
            this.state.currentObjectId = 1;
            
            // Create initial object
            this.state.objects[this.state.currentObjectId] = {
                id: this.state.currentObjectId,
                label: 'Object 1',
                points: [],
                color: MASK_COLORS[0]
            };
            
            // Update UI
            this.ui.updateObjectsList();
            
            // Reset video to beginning if it exists
            if (this.state.videoElement) {
                this.state.videoElement.currentTime = 0;
                this.state.videoElement.pause();
                this.ui.elements.playPauseBtn.innerHTML = '<span class="icon">▶</span>';
                this.ui.elements.frameSlider.value = 0;
                this.ui.elements.frameDisplay.textContent = '0:00';
                
                // Ensure the video is fully reset before drawing the frame
                this.state.videoElement.addEventListener('seeked', () => {
                    this.videoManager.drawFrame();
                }, { once: true });
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

    switchToInspectionMode() {
        this.isInspectionMode = true;
        
        // Hide selection sidebar and show inspection sidebar
        const selectionSidebar = document.getElementById('selection-sidebar');
        const inspectionSidebar = document.getElementById('inspection-sidebar');
        const histogramContainer = document.querySelector('.histogram-container');
        
        if (selectionSidebar) selectionSidebar.style.display = 'none';
        if (inspectionSidebar) inspectionSidebar.style.display = 'block';
        if (histogramContainer) histogramContainer.style.display = 'block';
        
        // Disable point placement by removing canvas click handlers
        this.state.canvasElement.removeEventListener('click', this.canvasClickHandler);
        this.state.canvasElement.removeEventListener('contextmenu', this.canvasRightClickHandler);
        
        // Hide add object button and remove object buttons
        const addObjectBtn = document.getElementById('add-object');
        if (addObjectBtn) {
            addObjectBtn.style.display = 'none';
        }
        
        // Hide all remove object buttons
        const removeButtons = document.querySelectorAll('.remove-object-btn');
        removeButtons.forEach(btn => {
            btn.style.display = 'none';
        });
        
        // Update objects list in inspection mode
        this.updateInspectionObjectsList();
    }
    
    switchToSelectionMode() {
        this.isInspectionMode = false;
        
        // Hide inspection sidebar and show selection sidebar
        const selectionSidebar = document.getElementById('selection-sidebar');
        const inspectionSidebar = document.getElementById('inspection-sidebar');
        const histogramContainer = document.querySelector('.histogram-container');
        
        if (selectionSidebar) selectionSidebar.style.display = 'block';
        if (inspectionSidebar) inspectionSidebar.style.display = 'none';
        if (histogramContainer) histogramContainer.style.display = 'none';
        
        // Re-enable point placement by adding canvas click handlers
        this.state.canvasElement.addEventListener('click', this.canvasClickHandler);
        this.state.canvasElement.addEventListener('contextmenu', this.canvasRightClickHandler);
        
        // Show add object button and remove object buttons
        const addObjectBtn = document.getElementById('add-object');
        if (addObjectBtn) {
            addObjectBtn.style.display = 'block';
        }
        
        // Show all remove object buttons
        const removeButtons = document.querySelectorAll('.remove-object-btn');
        removeButtons.forEach(btn => {
            btn.style.display = 'block';
        });
        
        // Update objects list in selection mode
        this.ui.updateObjectsList();
    }
    
    updateInspectionObjectsList() {
        const objectsList = document.querySelector('#inspection-sidebar .objects-list');
        if (!objectsList) return;
        
        objectsList.innerHTML = Object.values(this.state.objects).map(obj => `
            <div class="object-item ${obj.id === this.state.currentObjectId ? 'active' : ''}" data-id="${obj.id}">
                <div class="object-preview">
                    ${obj.thumbnail ? `<img src="${obj.thumbnail}" alt="${obj.label}">` : ''}
                </div>
                <div class="object-label">${obj.label}</div>
            </div>
        `).join('');

        // Add click handler for inspection mode object items
        objectsList.querySelectorAll('.object-item').forEach(item => {
            item.addEventListener('click', () => {
                const objectId = parseInt(item.dataset.id);
                this.setActiveObject(objectId);
                // Redraw the histogram for the newly selected object
                this.videoManager.drawHistogram();
            });
        });
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
            
            // Switch to inspection mode
            this.switchToInspectionMode();
            
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
                
                // Store histograms data
                this.state.histograms = data.histograms;
                
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
        this.videoFile = null;
    }

    async handleFile(file) {
        this.videoFile = file;
        
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            this.state.isProcessing = true;
            this.ui.updateUIState();
            
            // Set uploading state
            this.ui.app.isUploading = true;
            
            // Disable file input label
            this.ui.elements.fileInputLabel.classList.add('disabled');
            
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
            
            // Reset uploading state
            this.ui.app.isUploading = false;
            
            // Re-enable file input label
            this.ui.elements.fileInputLabel.classList.remove('disabled');
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
        this.isUploading = false;  // Add upload state tracking
        this.ui.app = this;  // Set the app reference in UIManager
    }

    init() {
        // Initialize canvas
        this.state.canvasElement = this.ui.elements.canvas;
        if (!this.state.canvasElement) {
            console.error('Canvas element not found');
            return;
        }
        
        // Add event listeners for file upload
        this.ui.elements.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.ui.elements.dropZone.classList.add('dragover');
        });

        this.ui.elements.dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.ui.elements.dropZone.classList.remove('dragover');
        });

        this.ui.elements.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.ui.elements.dropZone.classList.remove('dragover');
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.fileManager.handleFile(files[0]);
            }
        });

        // Remove click event from drop zone and keep only the file input click
        this.ui.elements.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.fileManager.handleFile(e.target.files[0]);
            }
        });
        
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
        
        // Back to selection button handler
        const backToSelectionBtn = document.getElementById('back-to-selection');
        if (backToSelectionBtn) {
            backToSelectionBtn.addEventListener('click', () => this.objectManager.switchToSelectionMode());
        }
        
        // Back to file upload button handler
        const backToFileUploadBtn = document.getElementById('back-to-file-upload');
        if (backToFileUploadBtn) {
            backToFileUploadBtn.addEventListener('click', () => {
                // Reset objects, masks, and prompt points
                this.objectManager.startOver('Are you sure you want to go back to file upload? All objects, masks, and prompt points will be cleared.');
                
                // Hide workspace and show upload section
                this.ui.elements.workspace.style.display = 'none';
                this.ui.elements.uploadSection.style.display = 'flex';
                
                // Reset file input to allow selecting the same file again
                this.ui.elements.fileInput.value = '';
                
                // Reset upload progress
                this.ui.elements.uploadProgress.style.display = 'none';
                this.ui.elements.progressFill.style.width = '0%';
                this.ui.elements.progressText.textContent = '';
            });
        }
        
        // Add click handler for object items
        document.querySelector('.objects-list').addEventListener('click', (e) => {
            const objectItem = e.target.closest('.object-item');
            if (objectItem && !e.target.closest('.remove-object-btn')) {
                const objectId = parseInt(objectItem.dataset.id);
                this.objectManager.setActiveObject(objectId);
            }
        });
        
        // Add click handler for inspection mode object items
        document.querySelector('#inspection-sidebar .objects-list').addEventListener('click', (e) => {
            const objectItem = e.target.closest('.object-item');
            if (objectItem) {
                const objectId = parseInt(objectItem.dataset.id);
                this.objectManager.setActiveObject(objectId);
            }
        });
        
        // Add click handler for remove object buttons
        document.querySelector('.objects-list').addEventListener('click', (e) => {
            const removeBtn = e.target.closest('.remove-object-btn');
            if (removeBtn) {
                const objectItem = removeBtn.closest('.object-item');
                const objectId = parseInt(objectItem.dataset.id);
                this.objectManager.removeObject(objectId);
            }
        });
        
        // Canvas handlers
        this.state.canvasElement.addEventListener('click', this.objectManager.canvasClickHandler);
        this.state.canvasElement.addEventListener('contextmenu', this.objectManager.canvasRightClickHandler);
        
        // Tooltip handler
        this.ui.elements.tooltip.querySelector('.ok-btn').addEventListener('click', () => this.ui.hideTooltip());

        // Handle window resize
        window.addEventListener('resize', () => {
            if (this.state.canvasElement) {
                const container = this.state.canvasElement.parentElement;
                const containerWidth = container.clientWidth;
                const containerHeight = container.clientHeight;
                
                // Maintain aspect ratio
                const aspectRatio = this.state.videoWidth / this.state.videoHeight;
                let width = containerWidth;
                let height = width / aspectRatio;
                
                if (height > containerHeight) {
                    height = containerHeight;
                    width = height * aspectRatio;
                }
                
                this.state.canvasElement.style.width = `${width}px`;
                this.state.canvasElement.style.height = `${height}px`;
            }

            // Resize histogram canvas
            if (this.videoManager.histogramCanvas) {
                const container = this.videoManager.histogramCanvas.parentElement;
                this.videoManager.histogramCanvas.width = container.clientWidth;
                this.videoManager.histogramCanvas.height = 150;
                this.videoManager.drawHistogram();
            }
        });
    }
}

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const app = new Application();
    app.init();
}); 
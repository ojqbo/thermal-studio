# SAM2 Demo Webapp Implementation Plan

## Requirements Summary

1. Backend:
   - Python with aiohttp for async web server
   - Direct SAM2 model integration (no wrapper class)
   - GPU support for model inference
   - Video file upload (js and aiohttp) and processing (decord and SAM2)
   - Point-based prompting only

2. Frontend:
   - Native HTML5, JavaScript, and CSS (no frameworks)
   - Video upload interface
   - Interactive point-based segmentation interface
   - Real-time visualization using OpenCV.js
   - Canvas-based video display and interaction

3. Containerization:
   - Docker container with GPU support
   - Local deployment focus (no security features required)
   - All dependencies and model weights included

## Implementation Steps

### 1. Project Setup and Structure
- [ ] Create project directory structure
- [ ] Set up Docker configuration with GPU support
- [ ] Create requirements.txt with necessary Python dependencies
  - [ ] aiohttp
  - [ ] torch
  - [ ] torchvision
  - [ ] sam2
- [ ] Set up basic aiohttp server structure

### 2. Backend Development
- [ ] Implement direct SAM2 model integration
  - [ ] Download SAM2.1 Hiera Large model weights
  - [ ] Set up model initialization and GPU configuration
  - [ ] Implement point-based inference pipeline
- [ ] Develop API endpoints
  - [ ] Video upload endpoint
  - [ ] Point prompt processing endpoint
  - [ ] Frame extraction endpoint using decord
- [ ] Implement video processing pipeline
  - [ ] Video frame extraction with decord
  - [ ] Frame-by-frame segmentation
  - [ ] Result aggregation and response formatting

### 3. Frontend Development
- [ ] Create basic HTML structure
  - [ ] Video upload interface
  - [ ] Canvas for video display
  - [ ] Point selection interface
  - [ ] Thermal histogram visualization panel
- [ ] Implement JavaScript functionality
  - [ ] Video upload handling
  - [ ] OpenCV.js integration for image processing
  - [ ] Canvas point selection and interaction
  - [ ] API communication for segmentation
  - [ ] Real-time mask visualization
  - [ ] RGB to grayscale conversion for thermal data
  - [ ] Histogram generation and display
- [ ] Style with CSS
  - [ ] Basic responsive layout
  - [ ] Point selection UI elements
  - [ ] Loading states and feedback
  - [ ] Histogram panel styling

### 4. SAM2 Integration
- [ ] Implement point-based segmentation
  - [ ] Point prompt handling
  - [ ] Mask generation
  - [ ] Real-time visualization
  - [ ] Mask-based thermal data extraction
- [ ] Implement video frame processing
  - [ ] Frame extraction with decord
  - [ ] Frame-by-frame segmentation
  - [ ] Result visualization
  - [ ] Per-frame thermal histogram generation

### 5. Containerization
- [ ] Create Dockerfile
  - [ ] Base image with CUDA support
  - [ ] Python environment setup
  - [ ] SAM2 model installation
  - [ ] Application deployment
- [ ] Configure GPU access
- [ ] Set up volume mounts for video storage

### 6. Testing and Optimization
- [ ] Test video processing pipeline
- [ ] Performance optimization
  - [ ] GPU utilization
  - [ ] Memory management for video frames
  - [ ] Response time optimization

### 7. Documentation
- [ ] Create README with setup instructions
- [ ] Document API endpoints
- [ ] Add usage examples
- [ ] Include troubleshooting guide

## Technical Considerations

1. Model and Processing:
   - Direct SAM2.1 Hiera Large model usage
   - decord for efficient video frame extraction
   - OpenCV.js for frontend image processing
   - Point-based prompting only

2. Performance Optimization:
   - Efficient frame extraction with decord
   - WebSocket for real-time updates
   - Optimize memory usage for video processing
   - Batch processing of frames when possible

3. User Experience:
   - Clear point selection interface
   - Real-time mask visualization
   - Error handling and recovery

4. Future Thermal Camera Integration:
   - Design with thermal video processing in mind
   - Consider temperature data visualization
   - RGB to grayscale conversion for thermal data
   - Histogram generation for segmented regions
   - Real-time histogram updates per frame
   - Per-object thermal statistics tracking
   - Efficient histogram computation using OpenCV.js 
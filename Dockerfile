# Use PyTorch base image with CUDA support
FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime

# Set working directory
WORKDIR /app

# Copy requirements file
COPY requirements.txt .

# Install Python dependencies
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Set the default command
CMD ["python3", "src/backend/server.py"] 
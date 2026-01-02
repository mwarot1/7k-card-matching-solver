# Production Dockerfile for มินิเกมส์ เทพเจ้าดอจ (FastAPI Backend)

FROM python:3.10-slim

# Install system dependencies for OpenCV and other libraries
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir uvicorn fastapi python-multipart

# Copy the entire project
COPY . .

# Ensure upload and debug directories exist
RUN mkdir -p uploads debug_faces debug_screenshots

# Set PYTHONPATH to include the project root
ENV PYTHONPATH="/"

# Expose the port (Render uses $PORT)
ENV PORT=8000
EXPOSE 8000

# Start the application
CMD uvicorn api.main:app --host 0.0.0.0 --port $PORT

FROM node:20-slim

# Install LibreOffice, Tesseract, GraphicsMagick (needed by pdf2pic)
RUN apt-get update && apt-get install -y \
    libreoffice \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    tesseract-ocr \
    tesseract-ocr-eng \
    graphicsmagick \
    ghostscript \
    qpdf \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Create required directories
RUN mkdir -p uploads outputs

EXPOSE 3001

CMD ["node", "src/index.js"]

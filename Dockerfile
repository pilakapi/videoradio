# Usar imagen base con Node.js
FROM node:18-slim

# Instalar FFmpeg (necesario para el procesamiento de streams)
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Crear directorio de trabajo
WORKDIR /app

# Copiar archivos de package
COPY package*.json ./

# Instalar dependencias
RUN npm install

# Copiar código de la aplicación
COPY . .

# Crear directorio para streams
RUN mkdir -p public/stream

# Exponer puerto
EXPOSE 3000

# Comando de inicio
CMD ["node", "server.js"]

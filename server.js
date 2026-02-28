require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const ffmpeg = require('fluent-ffmpeg');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de la base de datos Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Middleware de autenticación
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.user = user;
    next();
  });
};

// Inicializar base de datos
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS streams (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        video_url TEXT NOT NULL,
        radio_url TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('✅ Base de datos inicializada correctamente');
  } catch (error) {
    console.error('❌ Error inicializando base de datos:', error.message);
  }
}

// Rutas de autenticación
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }
    
    // Verificar si el usuario ya existe
    const existingUser = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'El usuario ya existe' });
    }
    
    // Hash de contraseña
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Crear usuario
    const result = await pool.query(
      'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username',
      [username, hashedPassword]
    );
    
    // Generar token
    const token = jwt.sign(
      { id: result.rows[0].id, username: result.rows[0].username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({ token, user: result.rows[0] });
  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }
    
    // Buscar usuario
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Usuario o contraseña incorrectos' });
    }
    
    // Verificar contraseña
    const validPassword = await bcrypt.compare(password, result.rows[0].password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Usuario o contraseña incorrectos' });
    }
    
    // Generar token
    const token = jwt.sign(
      { id: result.rows[0].id, username: result.rows[0].username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({ 
      token, 
      user: { 
        id: result.rows[0].id, 
        username: result.rows[0].username 
      } 
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Rutas de streams
app.get('/api/streams', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM streams WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo streams:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

app.post('/api/streams', authenticateToken, async (req, res) => {
  try {
    const { name, video_url, radio_url } = req.body;
    
    if (!name || !video_url || !radio_url) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }
    
    // Generar slug único
    const slug = `${req.user.username}-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${uuidv4().substring(0, 8)}`;
    
    const result = await pool.query(
      'INSERT INTO streams (user_id, name, slug, video_url, radio_url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.user.id, name, slug, video_url, radio_url]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creando stream:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

app.put('/api/streams/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, video_url, radio_url } = req.body;
    
    // Verificar que el stream pertenece al usuario
    const streamCheck = await pool.query(
      'SELECT * FROM streams WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    
    if (streamCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Stream no encontrado' });
    }
    
    const result = await pool.query(
      'UPDATE streams SET name = $1, video_url = $2, radio_url = $3 WHERE id = $4 RETURNING *',
      [name, video_url, radio_url, id]
    );
    
    // Limpiar caché de stream activo si existe
    clearStreamCache(id);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error actualizando stream:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

app.delete('/api/streams/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verificar que el stream pertenece al usuario
    const streamCheck = await pool.query(
      'SELECT * FROM streams WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    
    if (streamCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Stream no encontrado' });
    }
    
    // Limpiar caché y procesos
    clearStreamCache(id);
    
    await pool.query('DELETE FROM streams WHERE id = $1', [id]);
    
    res.json({ message: 'Stream eliminado correctamente' });
  } catch (error) {
    console.error('Error eliminando stream:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Gestor de streams activos y procesos FFmpeg
const activeStreams = new Map();

function clearStreamCache(streamId) {
  if (activeStreams.has(streamId)) {
    const stream = activeStreams.get(streamId);
    if (stream.ffmpeg) {
      stream.ffmpeg.kill('SIGTERM');
    }
    if (stream.cleanupTimeout) {
      clearTimeout(stream.cleanupTimeout);
    }
    activeStreams.delete(streamId);
  }
  
  // Limpiar archivos HLS
  const streamDir = path.join(__dirname, 'public', 'stream', streamId);
  if (fs.existsSync(streamDir)) {
    fs.rmSync(streamDir, { recursive: true, force: true });
  }
}

// Generar stream HLS con FFmpeg
function generateHLSStream(streamId, videoUrl, radioUrl) {
  return new Promise((resolve, reject) => {
    const outputDir = path.join(__dirname, 'public', 'stream', streamId);
    
    // Crear directorio si no existe
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const outputPath = path.join(outputDir, 'index.m3u8');
    
    // Comando FFmpeg para combinar video + radio
    const command = ffmpeg()
      .input(videoUrl)
      .inputOptions([
        '-stream_loop', '-1',  // Loop infinito del video
        '-re'                  // Read at native frame rate
      ])
      .input(radioUrl)
      .inputOptions([
        '-re'                  // Read at native frame rate
      ])
      .outputOptions([
        '-map', '0:v',         // Video del primer input
        '-map', '1:a',         // Audio del segundo input (radio)
        '-c:v', 'copy',        // Copiar video (más rápido)
        '-c:a', 'aac',         // Codificar audio a AAC
        '-b:a', '128k',        // Bitrate de audio
        '-f', 'hls',           // Formato HLS
        '-hls_time', '6',      // Duración de segmentos
        '-hls_list_size', '10', // Tamaño de lista
        '-hls_flags', 'delete_segments+append_list+omit_endlist',
        '-start_number', '1'   // Número inicial de segmento
      ])
      .output(outputPath);
    
    command.on('start', (cmd) => {
      console.log(`🎬 FFmpeg started for stream ${streamId}:`, cmd);
    });
    
    command.on('error', (err) => {
      console.error(`❌ FFmpeg error for stream ${streamId}:`, err.message);
      activeStreams.delete(streamId);
      reject(err);
    });
    
    command.on('end', () => {
      console.log(`✅ FFmpeg finished for stream ${streamId}`);
      activeStreams.delete(streamId);
    });
    
    command.run();
    
    // Guardar referencia al proceso
    activeStreams.set(streamId, {
      ffmpeg: command,
      videoUrl,
      radioUrl,
      cleanupTimeout: setTimeout(() => {
        console.log(`🧹 Limpiando stream ${streamId} por inactividad`);
        clearStreamCache(streamId);
      }, 5 * 60 * 1000) // 5 minutos de inactividad
    });
    
    // Esperar a que el stream esté listo
    setTimeout(() => {
      if (fs.existsSync(outputPath)) {
        resolve();
      } else {
        reject(new Error('Stream no se generó correctamente'));
      }
    }, 3000);
  });
}

// Endpoint para obtener stream HLS
app.get('/stream/:id/index.m3u8', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Obtener información del stream
    const result = await pool.query('SELECT * FROM streams WHERE slug = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).send('Stream no encontrado');
    }
    
    const stream = result.rows[0];
    const streamDir = path.join(__dirname, 'public', 'stream', id);
    const m3u8Path = path.join(streamDir, 'index.m3u8');
    
    // Verificar si el stream ya está activo y es válido
    if (!activeStreams.has(id) || !fs.existsSync(m3u8Path)) {
      console.log(`🔄 Generando stream HLS para: ${stream.name}`);
      await generateHLSStream(id, stream.video_url, stream.radio_url);
    } else {
      // Reiniciar timeout de limpieza
      const streamData = activeStreams.get(id);
      if (streamData && streamData.cleanupTimeout) {
        clearTimeout(streamData.cleanupTimeout);
        streamData.cleanupTimeout = setTimeout(() => {
          console.log(`🧹 Limpiando stream ${id} por inactividad`);
          clearStreamCache(id);
        }, 5 * 60 * 1000);
      }
    }
    
    // Servir el archivo M3U8
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(m3u8Path);
  } catch (error) {
    console.error('Error en stream:', error);
    res.status(500).send('Error generando stream');
  }
});

// Playlist M3U para el stream
app.get('/u/:username/:channel.m3u', async (req, res) => {
  try {
    const { username, channel } = req.params;
    
    // Buscar stream por slug
    const result = await pool.query(
      'SELECT * FROM streams WHERE slug = $1',
      [`${username}-${channel}`]
    );
    
    if (result.rows.length === 0) {
      // Buscar por cualquier coincidencia que contenga el username
      const searchResult = await pool.query(
        'SELECT * FROM streams WHERE slug LIKE $1 LIMIT 1',
        [`${username}%`]
      );
      
      if (searchResult.rows.length === 0) {
        return res.status(404).send('#EXTM3U\n#EXTINF:-1,Stream no encontrado\n#EXTVLCOPT:network-caching=1000\nhttp://localhost:3000/error.m3u8');
      }
      
      const stream = searchResult.rows[0];
      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
      const m3uContent = `#EXTM3U
#EXTINF:-1,${stream.name}
${baseUrl}/stream/${stream.slug}/index.m3u8
`;
      
      res.setHeader('Content-Type', 'audio/x-mpegurl');
      res.setHeader('Content-Disposition', `attachment; filename="${stream.slug}.m3u"`);
      res.send(m3uContent);
      return;
    }
    
    const stream = result.rows[0];
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    
    // Generar playlist M3U
    const m3uContent = `#EXTM3U
#EXTINF:-1,${stream.name}
${baseUrl}/stream/${stream.slug}/index.m3u8
`;
    
    res.setHeader('Content-Type', 'audio/x-mpegurl');
    res.setHeader('Content-Disposition', `attachment; filename="${stream.slug}.m3u"`);
    res.send(m3uContent);
  } catch (error) {
    console.error('Error generando M3U:', error);
    res.status(500).send('#EXTM3U\n#EXTINF:-1,Error\n#EXTVLCOPT:network-caching=1000\nhttp://localhost:3000/error.m3u8');
  }
});

// Servir archivos estáticos del frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`🚀 Servidor StreamMixer corriendo en puerto ${PORT}`);
  await initDatabase();
});

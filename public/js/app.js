// StreamMixer - Frontend JavaScript

const API_BASE = '';

// Utility functions
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

function getPin() {
  return localStorage.getItem('streamMixerPin');
}

function savePin(pin) {
  localStorage.setItem('streamMixerPin', pin);
}

function logout() {
  localStorage.removeItem('streamMixerPin');
  window.location.href = '/';
}

// Check authentication
function requireAuth() {
  const pin = getPin();
  if (!pin) {
    window.location.href = '/';
    return false;
  }
  return true;
}

// PIN form (index.html)
document.addEventListener('DOMContentLoaded', () => {
  // Only run on index page
  if (!document.getElementById('pin-form')) return;
  
  // Auto-redirect if already logged in
  if (getPin()) {
    window.location.href = '/dashboard';
    return;
  }
  
  // PIN form submission
  const pinForm = document.getElementById('pin-form');
  const pinError = document.getElementById('pin-error');
  
  pinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const pin = document.getElementById('access-pin').value;
    
    if (pin.length !== 6) {
      pinError.textContent = 'El PIN debe tener 6 dígitos';
      pinError.style.display = 'block';
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE}/api/auth/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-pin': pin
        }
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'PIN inválido');
      }
      
      // Save PIN and redirect
      savePin(pin);
      window.location.href = '/dashboard';
    } catch (error) {
      pinError.textContent = error.message;
      pinError.style.display = 'block';
    }
  });
  
  // Auto-format PIN input to numbers only
  const pinInput = document.getElementById('access-pin');
  pinInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/[^0-9]/g, '');
    pinError.style.display = 'none';
  });
});

// Dashboard page
document.addEventListener('DOMContentLoaded', () => {
  // Only run on dashboard page
  if (!document.getElementById('streams-grid')) return;
  
  if (!requireAuth()) return;
  
  // Logout button
  document.getElementById('logout-btn').addEventListener('click', logout);
  
  // Load streams
  loadStreams();
  
  // Modal handling
  const streamModal = document.getElementById('stream-modal');
  const urlModal = document.getElementById('url-modal');
  
  document.getElementById('new-stream-btn').addEventListener('click', () => {
    openStreamModal();
  });
  
  document.getElementById('empty-new-stream-btn').addEventListener('click', () => {
    openStreamModal();
  });
  
  document.getElementById('close-modal').addEventListener('click', () => {
    streamModal.classList.remove('active');
  });
  
  document.getElementById('cancel-modal').addEventListener('click', () => {
    streamModal.classList.remove('active');
  });
  
  document.getElementById('close-url-modal').addEventListener('click', () => {
    urlModal.classList.remove('active');
  });
  
  document.getElementById('close-url-modal-btn').addEventListener('click', () => {
    urlModal.classList.remove('active');
  });
  
  // Stream form
  const streamForm = document.getElementById('stream-form');
  streamForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const streamId = document.getElementById('stream-id').value;
    const name = document.getElementById('stream-name').value;
    const video_url = document.getElementById('video-url').value;
    const radio_url = document.getElementById('radio-url').value;
    
    const pin = getPin();
    
    try {
      let response;
      
      if (streamId) {
        // Update existing stream
        response = await fetch(`${API_BASE}/api/streams/${streamId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'x-pin': pin
          },
          body: JSON.stringify({ name, video_url, radio_url })
        });
      } else {
        // Create new stream
        response = await fetch(`${API_BASE}/api/streams`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-pin': pin
          },
          body: JSON.stringify({ name, video_url, radio_url })
        });
      }
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Error al guardar stream');
      }
      
      streamModal.classList.remove('active');
      streamForm.reset();
      document.getElementById('stream-id').value = '';
      
      showToast('Stream guardado correctamente');
      
      // Show the M3U URL
      showStreamUrl(data);
      
      loadStreams();
    } catch (error) {
      showToast(error.message, 'error');
    }
  });
  
  // Copy URL buttons
  document.getElementById('copy-url-btn').addEventListener('click', () => {
    const url = document.getElementById('m3u-url').textContent;
    navigator.clipboard.writeText(url).then(() => {
      showToast('URL copiada al portapapeles');
    });
  });
});

let streams = [];

async function loadStreams() {
  const pin = getPin();
  
  try {
    const response = await fetch(`${API_BASE}/api/streams`, {
      headers: {
        'x-pin': pin
      }
    });
    
    if (!response.ok) {
      const data = await response.json();
      if (response.status === 401 || response.status === 403) {
        // PIN expired or invalid, redirect to login
        logout();
        return;
      }
      throw new Error(data.error || 'Error al cargar streams');
    }
    
    streams = await response.json();
    renderStreams();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderStreams() {
  const grid = document.getElementById('streams-grid');
  const emptyState = document.getElementById('empty-state');
  
  if (streams.length === 0) {
    grid.style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }
  
  grid.style.display = 'grid';
  emptyState.style.display = 'none';
  
  grid.innerHTML = streams.map(stream => {
    const baseUrl = window.location.origin;
    const m3uUrl = `${baseUrl}/u/${stream.slug}.m3u`;
    
    return `
      <div class="stream-card" data-id="${stream.id}">
        <div class="stream-header">
          <h3 class="stream-title">${escapeHtml(stream.name)}</h3>
          <div class="stream-actions">
            <button onclick="editStream(${stream.id})" title="Editar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button onclick="deleteStream(${stream.id})" title="Eliminar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        </div>
        
        <div class="stream-details">
          <div class="stream-detail">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
              <line x1="8" y1="21" x2="16" y2="21"/>
              <line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
            <span>Video: ${escapeHtml(truncateUrl(stream.video_url))}</span>
          </div>
          <div class="stream-detail">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/>
              <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/>
              <circle cx="12" cy="12" r="2"/>
              <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/>
              <path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>
            </svg>
            <span>Radio: ${escapeHtml(truncateUrl(stream.radio_url))}</span>
          </div>
        </div>
        
        <div class="stream-url">
          <code>${escapeHtml(m3uUrl)}</code>
          <button class="btn-copy-small" onclick="copyStreamUrl('${escapeHtml(m3uUrl)}')">Copiar</button>
        </div>
        
        <button class="stream-preview-btn" onclick="showStreamUrl(${escapeHtml(JSON.stringify(stream))})">
          Ver Detalles y Obtener URL
        </button>
      </div>
    `;
  }).join('');
}

function openStreamModal(stream = null) {
  const modal = document.getElementById('stream-modal');
  const title = document.getElementById('modal-title');
  const form = document.getElementById('stream-form');
  
  if (stream) {
    title.textContent = 'Editar Stream';
    document.getElementById('stream-id').value = stream.id;
    document.getElementById('stream-name').value = stream.name;
    document.getElementById('video-url').value = stream.video_url;
    document.getElementById('radio-url').value = stream.radio_url;
  } else {
    title.textContent = 'Nuevo Stream';
    form.reset();
    document.getElementById('stream-id').value = '';
  }
  
  modal.classList.add('active');
}

window.editStream = function(id) {
  const stream = streams.find(s => s.id === id);
  if (stream) {
    openStreamModal(stream);
  }
};

window.deleteStream = async function(id) {
  if (!confirm('¿Estás seguro de que quieres eliminar este stream?')) {
    return;
  }
  
  const pin = getPin();
  
  try {
    const response = await fetch(`${API_BASE}/api/streams/${id}`, {
      method: 'DELETE',
      headers: {
        'x-pin': pin
      }
    });
    
    if (!response.ok) {
      throw new Error('Error al eliminar stream');
    }
    
    showToast('Stream eliminado correctamente');
    loadStreams();
  } catch (error) {
    showToast(error.message, 'error');
  }
};

window.copyStreamUrl = function(url) {
  navigator.clipboard.writeText(url).then(() => {
    showToast('URL copiada al portapapeles');
  });
};

window.showStreamUrl = function(stream) {
  const modal = document.getElementById('url-modal');
  const baseUrl = window.location.origin;
  const m3uUrl = `${baseUrl}/u/${stream.slug}.m3u`;
  
  document.getElementById('m3u-url').textContent = m3uUrl;
  
  // Set up preview player
  const previewPlayer = document.getElementById('preview-player');
  
  // For HLS streams, use hls.js
  if (Hls.isSupported()) {
    const hls = new Hls();
    hls.loadSource(`${baseUrl}/stream/${stream.slug}/index.m3u8`);
    hls.attachMedia(previewPlayer);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      previewPlayer.play().catch(() => {});
    });
  } else if (previewPlayer.canPlayType('application/vnd.apple.mpegurl')) {
    // Native HLS support (Safari)
    previewPlayer.src = `${baseUrl}/stream/${stream.slug}/index.m3u8`;
    previewPlayer.addEventListener('loadedmetadata', () => {
      previewPlayer.play().catch(() => {});
    });
  }
  
  // For direct video playback (fallback), try loading the video URL directly
  // Note: This won't have the radio audio, just for preview
  if (!stream.video_url.includes('.m3u8')) {
    previewPlayer.src = stream.video_url;
    previewPlayer.loop = true;
  }
  
  modal.classList.add('active');
};

// Utility functions
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function truncateUrl(url) {
  if (url.length > 50) {
    return url.substring(0, 47) + '...';
  }
  return url;
}

/**
 * COLECCIÓN RETRO - FRONTEND APP
 * Manejo de escaneo, autocompletado, edición previa y gestión multimedia
 */

// Estado global de la aplicación
const state = {
  platforms: [],
  items: [],
  activeItem: null,
  activeFilterPlatform: '',
  activeFilterType: '',
  activeFilterCondition: '',
  activeFilterRegion: '',
  activeFilterFav: false,
  searchTerm: '',
  scannerInstance: null
};

// =========================================================================
// INICIALIZACIÓN
// =========================================================================
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  // setupUsbBarcodeListener() desactivado temporalmente a petición del usuario
  await loadPlatforms();
  await loadStats();
  await loadItems();

  // Registro de Service Worker para PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
});

// Toast notification helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

// =========================================================================
// CARGA DE DATOS (API)
// =========================================================================
async function loadPlatforms() {
  try {
    const res = await fetch('/api/platforms');
    const data = await res.json();
    if (data.success) {
      state.platforms = data.data;
      populatePlatformSelects(data.data);
    }
  } catch (err) {
    showToast('Error cargando plataformas', 'error');
  }
}

function populatePlatformSelects(platforms) {
  const filterSelect = document.getElementById('filter-platform');
  const formSelect = document.getElementById('form-platform');

  filterSelect.innerHTML = '<option value="">Todas las plataformas</option>';
  formSelect.innerHTML = '<option value="">Selecciona plataforma...</option>';

  platforms.forEach(p => {
    const optFilter = document.createElement('option');
    optFilter.value = p.id;
    optFilter.textContent = `${p.icon || '🎮'} ${p.name}`;
    filterSelect.appendChild(optFilter);

    const optForm = document.createElement('option');
    optForm.value = p.id;
    optForm.textContent = `${p.icon || '🎮'} ${p.name}`;
    formSelect.appendChild(optForm);
  });
}

async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    if (data.success) {
      const s = data.data;
      document.getElementById('stat-total-items').textContent = s.totalItems || 0;
      document.getElementById('stat-total-games').textContent = s.gamesCount || 0;
      document.getElementById('stat-total-consoles').textContent = s.consolesCount || 0;
      const accEl = document.getElementById('stat-total-accessories');
      if (accEl) accEl.textContent = s.accessoriesCount || 0;
      document.getElementById('stat-total-value').textContent = `${(s.totalValue || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })} €`;
    }
  } catch (e) {
    console.error('Error stats:', e);
  }
}

async function loadItems() {
  try {
    const params = new URLSearchParams();
    if (state.searchTerm) params.append('search', state.searchTerm);
    if (state.activeFilterPlatform) params.append('platform_id', state.activeFilterPlatform);
    if (state.activeFilterType) params.append('type', state.activeFilterType);
    if (state.activeFilterCondition) params.append('condition', state.activeFilterCondition);
    if (state.activeFilterRegion) params.append('region', state.activeFilterRegion);
    if (state.activeFilterFav) params.append('favorite', '1');

    const res = await fetch(`/api/items?${params.toString()}`);
    const json = await res.json();
    if (json.success) {
      state.items = json.data;
      renderItemsGrid(json.data);
    }
  } catch (err) {
    showToast('Error al conectar con la base de datos', 'error');
  }
}

// =========================================================================
// RENDERIZADO DE REJILLA DE ÍTEMS
// =========================================================================
function renderItemsGrid(items) {
  const container = document.getElementById('items-container');
  if (!items || items.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">👾</div>
        <h3>No se encontraron ítems</h3>
        <p>Prueba con otros filtros o escanea/añade un nuevo ítem a tu colección.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = items.map(item => {
    const conditionClass = `badge-condition-${(item.condition || 'cib').toLowerCase()}`;
    const coverUrl = item.cover_image || '';
    const platformDisplay = item.platform_name ? `${item.platform_icon || '🎮'} ${item.platform_name}` : 'Sin plataforma';

    return `
      <article class="item-card" data-id="${item.id}">
        <div class="item-cover-wrapper">
          <div class="item-badges-overlay">
            <span class="badge badge-platform">${platformDisplay}</span>
            <span class="badge ${conditionClass}">${item.condition || 'CIB'}</span>
          </div>
          ${coverUrl ? `
            <img class="item-cover-img" src="${coverUrl}" alt="${escapeHtml(item.title)}" loading="lazy" onerror="this.src=''; this.parentElement.innerHTML='<div class=\\'item-cover-placeholder\\'>🎮</div>';">
          ` : `
            <div class="item-cover-placeholder">
              <span>${item.type === 'console' ? '📺' : '🎮'}</span>
            </div>
          `}
        </div>
        <div class="item-body">
          <h3 class="item-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</h3>
          <div class="item-meta-row">
            <span class="item-price">${item.estimated_value ? `${item.estimated_value.toFixed(2)} €` : (item.purchase_price ? `${item.purchase_price.toFixed(2)} €` : 'Sin valor')}</span>
            <span class="item-media-count">📁 ${item.media_count || 0} adjuntos</span>
          </div>
        </div>
      </article>
    `;
  }).join('');

  // Event listener para abrir detalle
  container.querySelectorAll('.item-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-id');
      openItemDetail(id);
    });
  });
}

// =========================================================================
// FORMULARIO: ALTA Y PRE-VISUALIZACIÓN EDITABLE
// =========================================================================
function openItemForm(existingItem = null) {
  const modal = document.getElementById('modal-item-form');
  const titleEl = document.getElementById('form-modal-title');
  const form = document.getElementById('item-form');
  form.reset();

  document.getElementById('autocomplete-list').style.display = 'none';
  document.getElementById('barcode-status-msg').style.display = 'none';

  if (existingItem) {
    titleEl.textContent = '✏️ Editar Ficha de Ítem';
    document.getElementById('form-item-id').value = existingItem.id;
    document.getElementById('form-title').value = existingItem.title || '';
    document.getElementById('form-type').value = existingItem.type || 'game';
    document.getElementById('form-platform').value = existingItem.platform_id || '';
    document.getElementById('form-barcode').value = existingItem.barcode || '';
    document.getElementById('form-region').value = existingItem.region || 'PAL-ESP';
    document.getElementById('form-condition').value = existingItem.condition || 'CIB';
    document.getElementById('form-rating').value = existingItem.state_rating || 8;
    document.getElementById('form-serial').value = existingItem.serial_number || '';
    document.getElementById('form-price').value = existingItem.purchase_price || '';
    document.getElementById('form-value').value = existingItem.estimated_value || '';
    document.getElementById('form-location').value = existingItem.location || '';
    document.getElementById('form-cover').value = existingItem.cover_image || '';
    document.getElementById('form-notes').value = existingItem.notes || '';
    document.getElementById('form-fav').checked = !!existingItem.is_favorite;
    document.getElementById('form-mods').checked = !!existingItem.has_mods;
  } else {
    titleEl.textContent = '📝 Ficha de Ítem (Pre-visualización antes de guardar)';
    document.getElementById('form-item-id').value = '';
    document.getElementById('form-rating').value = 8;
    document.getElementById('form-condition').value = 'CIB';
    document.getElementById('form-region').value = 'PAL-ESP';
  }

  modal.classList.add('active');
  document.getElementById('form-title').focus();
  currentValuation = null;
  const vHint = document.getElementById('valuation-hint');
  if (vHint) vHint.style.display = 'none';
}

function closeItemForm() {
  document.getElementById('modal-item-form').classList.remove('active');
}

// Autocompletado mientras escribe en el título
let searchDebounceTimer = null;
const titleInput = document.getElementById('form-title');
const autocompleteBox = document.getElementById('autocomplete-list');

titleInput.addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  const query = titleInput.value.trim();
  if (query.length < 3) {
    autocompleteBox.style.display = 'none';
    return;
  }

  searchDebounceTimer = setTimeout(async () => {
    try {
      const platVal = document.getElementById('form-platform').value;
      const res = await fetch(`/api/lookup/search?q=${encodeURIComponent(query)}&platform=${encodeURIComponent(platVal)}`);
      const json = await res.json();
      if (json.success && json.results && json.results.length > 0) {
        autocompleteBox.innerHTML = json.results.map(r => `
          <div class="autocomplete-item" data-title="${escapeHtml(r.title)}" data-platform="${r.platform_id || ''}" data-type="${r.type || 'game'}" data-desc="${escapeHtml(r.description || '')}">
            <strong>${escapeHtml(r.title)}</strong>
            <small>${escapeHtml(r.description || '')}</small>
          </div>
        `).join('');
        autocompleteBox.style.display = 'block';

        autocompleteBox.querySelectorAll('.autocomplete-item').forEach(el => {
          el.addEventListener('click', () => {
            titleInput.value = el.getAttribute('data-title');
            const plat = el.getAttribute('data-platform');
            if (plat && document.querySelector(`#form-platform option[value="${plat}"]`)) {
              document.getElementById('form-platform').value = plat;
            }
            const itemType = el.getAttribute('data-type');
            if (itemType) {
              document.getElementById('form-type').value = itemType;
            }
            const desc = el.getAttribute('data-desc');
            const notesEl = document.getElementById('form-notes');
            if (desc && !notesEl.value) {
              notesEl.value = desc;
            }
            autocompleteBox.style.display = 'none';
            showToast('Metadatos autocompletados. Consultando precio...', 'info');

            // Consultar automáticamente la tasación en PriceCharting
            fetchValuation(titleInput.value, plat, document.getElementById('form-condition').value);
          });
        });
      } else {
        autocompleteBox.style.display = 'none';
      }
    } catch (e) {
      autocompleteBox.style.display = 'none';
    }
  }, 350);
});

let currentValuation = null;

// Consultar valoración de mercado en PriceCharting
async function fetchValuation(title, platformId, condition = 'CIB') {
  const hint = document.getElementById('valuation-hint');
  if (!title || title.trim().length < 2) return;
  hint.style.display = 'block';
  hint.textContent = '⏳ Consultando tasación en PriceCharting...';

  try {
    const res = await fetch(`/api/lookup/valuation?q=${encodeURIComponent(title.trim())}&platform=${encodeURIComponent(platformId || '')}&condition=${encodeURIComponent(condition)}`);
    const json = await res.json();
    if (json.success && json.data) {
      currentValuation = json.data;
      const p = currentValuation.prices;
      document.getElementById('form-value').value = currentValuation.recommendedEur || '';
      hint.innerHTML = `📊 <strong>PriceCharting:</strong> Suelto: ${p.loose.eur}€ | CIB: ${p.cib.eur}€ | Precintado: ${p.sealed.eur}€`;
      showToast(`Tasación de mercado calculada: ${currentValuation.recommendedEur} €`, 'info');
    } else {
      hint.textContent = 'No se encontró precio de referencia para este título.';
    }
  } catch (err) {
    hint.textContent = 'Error al consultar tasación.';
  }
}

// Lookup por código de barras
async function triggerBarcodeLookup(barcode) {
  if (!barcode || !barcode.trim()) return;
  const statusMsg = document.getElementById('barcode-status-msg');
  statusMsg.style.display = 'block';
  statusMsg.textContent = 'Buscando metadatos en bases de datos...';

  try {
    const res = await fetch('/api/lookup/barcode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ barcode: barcode.trim() })
    });
    const data = await res.json();

    if (data.success) {
      if (data.alreadyInCollection) {
        statusMsg.innerHTML = `<span style="color: var(--accent-amber);">⚠️ ¡Aviso! Ya tienes ${data.existingItems.length} unidad(es) de este ítem en tu colección.</span>`;
        showToast('Atención: Ya posees este juego/consola en tu colección', 'warn');
      } else {
        statusMsg.textContent = '✓ Código verificado';
      }

      if (data.metadata && data.metadata.title) {
        document.getElementById('form-title').value = data.metadata.title;
        if (data.metadata.platform_id) {
          document.getElementById('form-platform').value = data.metadata.platform_id;
        }
        if (data.metadata.type) {
          document.getElementById('form-type').value = data.metadata.type;
        }
        if (data.metadata.cover_image) {
          document.getElementById('form-cover').value = data.metadata.cover_image;
        }
        if (data.metadata.description && !document.getElementById('form-notes').value) {
          document.getElementById('form-notes').value = data.metadata.description;
        }

        // Si vino tasación directa de PriceCharting
        if (data.valuation && data.valuation.recommendedEur) {
          currentValuation = data.valuation;
          const p = currentValuation.prices;
          document.getElementById('form-value').value = currentValuation.recommendedEur;
          const hint = document.getElementById('valuation-hint');
          hint.style.display = 'block';
          hint.innerHTML = `📊 <strong>PriceCharting:</strong> Suelto: ${p.loose.eur}€ | CIB: ${p.cib.eur}€ | Precintado: ${p.sealed.eur}€`;
          showToast(`Tasación automática: ${currentValuation.recommendedEur} € (${data.valuation.condition})`, 'success');
        } else {
          fetchValuation(data.metadata.title, data.metadata.platform_id, document.getElementById('form-condition').value);
        }

        showToast('¡Metadatos detectados! Revisa los campos y guarda.', 'success');
      }
    }
  } catch (err) {
    statusMsg.textContent = 'No se encontraron datos automáticos, introduce los datos a mano.';
  }
}

// Guardar ítem (POST o PUT)
document.getElementById('item-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('form-item-id').value;
  const payload = {
    title: document.getElementById('form-title').value.trim(),
    type: document.getElementById('form-type').value,
    platform_id: document.getElementById('form-platform').value || null,
    barcode: document.getElementById('form-barcode').value.trim() || null,
    region: document.getElementById('form-region').value,
    condition: document.getElementById('form-condition').value,
    state_rating: parseInt(document.getElementById('form-rating').value, 10) || 8,
    serial_number: document.getElementById('form-serial').value.trim() || null,
    purchase_price: parseFloat(document.getElementById('form-price').value) || 0,
    estimated_value: parseFloat(document.getElementById('form-value').value) || 0,
    location: document.getElementById('form-location').value.trim() || null,
    cover_image: document.getElementById('form-cover').value.trim() || null,
    notes: document.getElementById('form-notes').value.trim() || null,
    is_favorite: document.getElementById('form-fav').checked ? 1 : 0,
    has_mods: document.getElementById('form-mods').checked ? 1 : 0
  };

  const isEdit = !!id;
  const url = isEdit ? `/api/items/${id}` : '/api/items';
  const method = isEdit ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.success) {
      showToast(isEdit ? 'Ficha actualizada correctamente' : '¡Ítem añadido a la colección!', 'success');
      closeItemForm();
      await loadStats();
      await loadItems();

      // Si es nuevo ítem, abrir directamente su detalle para que pueda subir fotos/documentos
      if (!isEdit && data.data && data.data.id) {
        openItemDetail(data.data.id);
      }
    } else {
      showToast(`Error: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast('Error de conexión al guardar', 'error');
  }
});

// =========================================================================
// ESCÁNER FÍSICO USB / BLUETOOTH (Desactivado temporalmente)
// =========================================================================
function setupUsbBarcodeListener() {
  // Desactivado: se habilitará en el futuro si se conecta un lector físico dedicado
}

function handleBarcodeScanned(barcode) {
  showToast(`Código detectado: ${barcode}`, 'info');
  openItemForm();
  document.getElementById('form-barcode').value = barcode;
  triggerBarcodeLookup(barcode);
}

// =========================================================================
// ESCÁNER POR CÁMARA (HTML5-QRCode)
// =========================================================================
function openScannerModal() {
  const modal = document.getElementById('modal-scanner');
  modal.classList.add('active');

  const container = document.getElementById('scanner-video-container');
  // Asegurar que no quede contenido residual previo
  container.innerHTML = '<div class="scanner-laser-line"></div>';

  if (window.Html5Qrcode) {
    try {
      state.scannerInstance = new Html5Qrcode('scanner-video-container');

      // Cuadro de escaneo amplio adaptado al tamaño real de pantalla
      const isMobile = window.innerWidth <= 768;
      const targetWidth = isMobile ? Math.floor(window.innerWidth * 0.85) : 420;
      const targetHeight = Math.floor(targetWidth * 0.62);

      state.scannerInstance.start(
        { facingMode: 'environment' },
        {
          fps: 15,
          qrbox: { width: targetWidth, height: targetHeight },
          aspectRatio: isMobile ? 1.0 : 1.333
        },
        (decodedText) => {
          stopScanner();
          modal.classList.remove('active');
          handleBarcodeScanned(decodedText);
        },
        () => {} // Ignorar errores por frame
      ).catch(err => {
        container.innerHTML = `
          <div style="padding: 1.5rem; color: var(--text-muted); font-size: 0.95rem; text-align: center;">
            <p>📷 Cámara no disponible o permiso denegado.</p>
            <p style="font-size: 0.8rem; margin-top: 0.5rem;">Asegúrate de haber accedido por HTTPS y concedido permiso a la cámara.</p>
          </div>
        `;
      });
    } catch (e) {
      console.error(e);
    }
  } else {
    container.innerHTML = `
      <div style="padding: 1.5rem; color: var(--text-muted); font-size: 0.95rem; text-align: center;">
        Módulo de cámara en modo manual.<br>Escribe el código de barras abajo.
      </div>
    `;
  }
}

function stopScanner() {
  if (state.scannerInstance) {
    try {
      state.scannerInstance.stop().then(() => state.scannerInstance.clear()).catch(() => {});
    } catch (e) {}
    state.scannerInstance = null;
  }
}

function closeScannerModal() {
  stopScanner();
  document.getElementById('modal-scanner').classList.remove('active');
}

// =========================================================================
// DETALLE DE ÍTEM & GESTIÓN DE FOTOS / DOCUMENTOS
// =========================================================================
async function openItemDetail(id) {
  try {
    const res = await fetch(`/api/items/${id}`);
    const json = await res.json();
    if (!json.success) {
      showToast('Ítem no encontrado', 'error');
      return;
    }

    const item = json.data;
    state.activeItem = item;

    document.getElementById('detail-name').textContent = item.title;
    document.getElementById('detail-cover-img').src = item.cover_image || '';
    document.getElementById('detail-cover-img').style.display = item.cover_image ? 'block' : 'none';

    document.getElementById('detail-badge-platform').textContent = item.platform_name ? `${item.platform_icon || '🎮'} ${item.platform_name}` : 'Plataforma N/D';
    document.getElementById('detail-badge-condition').textContent = item.condition || 'CIB';
    document.getElementById('detail-badge-condition').className = `badge badge-condition-${(item.condition || 'cib').toLowerCase()}`;
    document.getElementById('detail-badge-region').textContent = item.region || 'PAL-ESP';
    document.getElementById('detail-rating').textContent = `⭐ ${item.state_rating || 8}/10`;

    document.getElementById('detail-barcode').textContent = item.barcode || 'N/A';
    document.getElementById('detail-serial').textContent = item.serial_number || 'N/A';
    document.getElementById('detail-price').textContent = item.purchase_price ? `${item.purchase_price.toFixed(2)} €` : 'No especificado';
    document.getElementById('detail-value').textContent = item.estimated_value ? `${item.estimated_value.toFixed(2)} €` : 'No especificado';
    document.getElementById('detail-location').textContent = item.location || 'Sin asignar';
    document.getElementById('detail-date').textContent = item.purchase_date || item.created_at || '-';

    const notesBox = document.getElementById('detail-notes-box');
    notesBox.innerHTML = item.notes ? escapeHtml(item.notes).replace(/\n/g, '<br>') : '<em>Sin notas registradas.</em>';

    // Renderizar medios
    renderItemMedia(item.media || []);

    document.getElementById('modal-item-detail').classList.add('active');
  } catch (err) {
    showToast('Error cargando detalle', 'error');
  }
}

function renderItemMedia(mediaList) {
  const gallery = document.getElementById('detail-gallery');
  const docsList = document.getElementById('detail-docs');

  const photos = mediaList.filter(m => m.media_type === 'image');
  const docs = mediaList.filter(m => m.media_type === 'document');

  document.getElementById('photos-count').textContent = photos.length;
  document.getElementById('docs-count').textContent = docs.length;

  // Galería de fotos
  if (photos.length === 0) {
    gallery.innerHTML = '<p style="grid-column: 1/-1; font-size: 0.85rem; color: var(--text-muted); text-align: center; padding: 1rem;">No hay fotos añadidas aún. Sube fotos del cartucho, la placa base o la caja.</p>';
  } else {
    gallery.innerHTML = photos.map(p => `
      <div class="gallery-item">
        <a href="${p.file_name.startsWith('http') ? p.file_name : `/uploads/${p.file_path.split(/[\\/]/).pop()}`}" target="_blank">
          <img src="${p.file_name.startsWith('http') ? p.file_name : `/uploads/${p.file_path.split(/[\\/]/).pop()}`}" alt="${escapeHtml(p.caption || '')}">
        </a>
        <button class="gallery-delete-btn" data-media-id="${p.id}" title="Eliminar foto">&times;</button>
      </div>
    `).join('');

    gallery.querySelectorAll('.gallery-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteMedia(btn.getAttribute('data-media-id'));
      });
    });
  }

  // Lista de Documentos
  if (docs.length === 0) {
    docsList.innerHTML = '<p style="font-size: 0.85rem; color: var(--text-muted); text-align: center; padding: 1rem;">No hay manuales o documentos adjuntos.</p>';
  } else {
    docsList.innerHTML = docs.map(d => {
      const fileName = d.file_path.split(/[\\/]/).pop();
      return `
        <div class="doc-card">
          <a class="doc-info" href="/uploads/${fileName}" target="_blank">
            <span class="doc-icon">📄</span>
            <div>
              <strong style="font-size: 0.9rem;">${escapeHtml(d.file_name)}</strong>
              <div style="font-size: 0.75rem; color: var(--text-muted);">${(d.file_size / 1024).toFixed(1)} KB</div>
            </div>
          </a>
          <button class="btn btn-danger btn-sm" data-media-id="${d.id}">Eliminar</button>
        </div>
      `;
    }).join('');

    docsList.querySelectorAll('.btn-danger').forEach(btn => {
      btn.addEventListener('click', () => deleteMedia(btn.getAttribute('data-media-id')));
    });
  }
}

async function uploadFilesToItem(files, category = 'photo') {
  if (!state.activeItem || !files || files.length === 0) return;

  const formData = new FormData();
  for (let i = 0; i < files.length; i++) {
    formData.append('files', files[i]);
  }
  formData.append('category', category);

  try {
    showToast('Subiendo archivo(s)...', 'info');
    const res = await fetch(`/api/items/${state.activeItem.id}/upload`, {
      method: 'POST',
      body: formData
    });
    const json = await res.json();
    if (json.success) {
      showToast(`${json.count} archivo(s) guardado(s)`, 'success');
      // Recargar detalle y listado
      await openItemDetail(state.activeItem.id);
      await loadItems();
    } else {
      showToast(json.error, 'error');
    }
  } catch (e) {
    showToast('Error en la subida', 'error');
  }
}

async function deleteMedia(mediaId) {
  if (!confirm('¿Eliminar este archivo permanentemente?')) return;
  try {
    const res = await fetch(`/api/media/${mediaId}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      showToast('Archivo eliminado', 'success');
      if (state.activeItem) {
        await openItemDetail(state.activeItem.id);
        await loadItems();
      }
    }
  } catch (err) {
    showToast('Error eliminando archivo', 'error');
  }
}

// =========================================================================
// EVENT LISTENERS & CONTROLADORES
// =========================================================================
function setupEventListeners() {
  // Búsqueda en tiempo real
  const searchInput = document.getElementById('search-input');
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.searchTerm = searchInput.value;
      loadItems();
    }, 300);
  });

  // Filtros
  document.getElementById('filter-platform').addEventListener('change', (e) => {
    state.activeFilterPlatform = e.target.value;
    loadItems();
  });
  document.getElementById('filter-type').addEventListener('change', (e) => {
    state.activeFilterType = e.target.value;
    loadItems();
  });
  document.getElementById('filter-condition').addEventListener('change', (e) => {
    state.activeFilterCondition = e.target.value;
    loadItems();
  });
  document.getElementById('filter-region').addEventListener('change', (e) => {
    state.activeFilterRegion = e.target.value;
    loadItems();
  });

  const favBtn = document.getElementById('filter-fav-btn');
  favBtn.addEventListener('click', () => {
    state.activeFilterFav = !state.activeFilterFav;
    favBtn.classList.toggle('active', state.activeFilterFav);
    loadItems();
  });

  document.getElementById('btn-clear-filters').addEventListener('click', () => {
    searchInput.value = '';
    state.searchTerm = '';
    document.getElementById('filter-platform').value = '';
    state.activeFilterPlatform = '';
    document.getElementById('filter-type').value = '';
    state.activeFilterType = '';
    document.getElementById('filter-condition').value = '';
    state.activeFilterCondition = '';
    document.getElementById('filter-region').value = '';
    state.activeFilterRegion = '';
    state.activeFilterFav = false;
    favBtn.classList.remove('active');
    loadItems();
  });

  // Móvil LAN QR
  const btnOpenMobile = document.getElementById('btn-open-mobile');
  const modalLanMobile = document.getElementById('modal-lan-mobile');
  if (btnOpenMobile && modalLanMobile) {
    btnOpenMobile.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/lan-qr');
        const data = await res.json();
        if (data.success) {
          document.getElementById('mobile-qr-img').src = data.qrDataUrl;
          const link = document.getElementById('mobile-https-url');
          link.href = data.url;
          link.textContent = data.url;
          modalLanMobile.classList.add('active');
        }
      } catch (err) {
        showToast('Error obteniendo enlace LAN', 'error');
      }
    });

    document.getElementById('btn-close-mobile-modal').addEventListener('click', () => {
      modalLanMobile.classList.remove('active');
    });
    document.getElementById('btn-close-mobile-modal-footer').addEventListener('click', () => {
      modalLanMobile.classList.remove('active');
    });
  }

  // Modales
  document.getElementById('btn-new-item').addEventListener('click', () => openItemForm());
  document.getElementById('btn-close-form').addEventListener('click', closeItemForm);
  document.getElementById('btn-cancel-form').addEventListener('click', closeItemForm);

  // Escáner
  document.getElementById('btn-open-scanner').addEventListener('click', openScannerModal);
  document.getElementById('btn-close-scanner').addEventListener('click', closeScannerModal);
  document.getElementById('btn-scanner-manual-submit').addEventListener('click', () => {
    const val = document.getElementById('scanner-manual-code').value.trim();
    if (val) {
      closeScannerModal();
      handleBarcodeScanned(val);
    }
  });

  // Botón buscar código en formulario
  document.getElementById('btn-lookup-barcode').addEventListener('click', () => {
    const code = document.getElementById('form-barcode').value.trim();
    if (code) triggerBarcodeLookup(code);
  });

  // Detalle modal
  document.getElementById('btn-close-detail').addEventListener('click', () => {
    document.getElementById('modal-item-detail').classList.remove('active');
  });
  document.getElementById('btn-close-detail-footer').addEventListener('click', () => {
    document.getElementById('modal-item-detail').classList.remove('active');
  });

  // Modificar valor estimado al cambiar el estado de conservación
  document.getElementById('form-condition').addEventListener('change', (e) => {
    if (currentValuation && currentValuation.prices) {
      const cond = e.target.value;
      const p = currentValuation.prices;
      let val = p.cib.eur;
      if (cond === 'Loose') val = p.loose.eur;
      else if (cond === 'Boxed') val = p.boxed.eur;
      else if (cond === 'Sealed') val = p.sealed.eur;

      if (val > 0) {
        document.getElementById('form-value').value = val;
        showToast(`Tasación actualizada para ${cond}: ${val} €`, 'info');
      }
    }
  });

  // Botón manual para tasar con PriceCharting en el formulario
  const btnFetchVal = document.getElementById('btn-fetch-valuation');
  if (btnFetchVal) {
    btnFetchVal.addEventListener('click', () => {
      const title = document.getElementById('form-title').value.trim();
      const plat = document.getElementById('form-platform').value;
      const cond = document.getElementById('form-condition').value;
      if (!title) {
        showToast('Introduce el título del juego o consola primero', 'warn');
        return;
      }
      fetchValuation(title, plat, cond);
    });
  }

  // Actualizar tasación desde el detalle del ítem
  const btnDetailRevalue = document.getElementById('btn-detail-revalue');
  if (btnDetailRevalue) {
    btnDetailRevalue.addEventListener('click', async () => {
      if (!state.activeItem) return;
      showToast('Consultando tasación actualizada...', 'info');
      try {
        const res = await fetch(`/api/lookup/valuation?q=${encodeURIComponent(state.activeItem.title)}&platform=${encodeURIComponent(state.activeItem.platform_id || '')}&condition=${encodeURIComponent(state.activeItem.condition || 'CIB')}`);
        const json = await res.json();
        if (json.success && json.data && json.data.recommendedEur) {
          const newPrice = json.data.recommendedEur;
          if (confirm(`PriceCharting cotiza "${state.activeItem.title}" (${state.activeItem.condition}) en ${newPrice} €. ¿Actualizar valor estimado?`)) {
            await fetch(`/api/items/${state.activeItem.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ estimated_value: newPrice })
            });
            showToast(`Valor actualizado a ${newPrice} €`, 'success');
            await openItemDetail(state.activeItem.id);
            await loadStats();
            await loadItems();
          }
        } else {
          showToast('No se encontró cotización para este ítem', 'warn');
        }
      } catch (e) {
        showToast('Error al consultar tasación', 'error');
      }
    });
  }

  // Editar ítem desde detalle
  document.getElementById('btn-edit-item').addEventListener('click', () => {
    if (state.activeItem) {
      document.getElementById('modal-item-detail').classList.remove('active');
      openItemForm(state.activeItem);
    }
  });

  // Eliminar ítem desde detalle
  document.getElementById('btn-delete-item').addEventListener('click', async () => {
    if (!state.activeItem) return;
    if (!confirm(`¿Seguro que deseas eliminar "${state.activeItem.title}" de tu colección? Se borrarán sus fotos y ficheros asociados.`)) return;

    try {
      const res = await fetch(`/api/items/${state.activeItem.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        showToast('Ítem eliminado', 'success');
        document.getElementById('modal-item-detail').classList.remove('active');
        await loadStats();
        await loadItems();
      }
    } catch (e) {
      showToast('Error al eliminar', 'error');
    }
  });

  // Pestañas de Detalle (Fotos / Documentos)
  const tabBtnPhotos = document.getElementById('tab-btn-photos');
  const tabBtnDocs = document.getElementById('tab-btn-docs');
  const tabPhotos = document.getElementById('tab-content-photos');
  const tabDocs = document.getElementById('tab-content-docs');

  tabBtnPhotos.addEventListener('click', () => {
    tabBtnPhotos.classList.add('active');
    tabBtnDocs.classList.remove('active');
    tabPhotos.style.display = 'block';
    tabDocs.style.display = 'none';
  });

  tabBtnDocs.addEventListener('click', () => {
    tabBtnDocs.classList.add('active');
    tabBtnPhotos.classList.remove('active');
    tabPhotos.style.display = 'none';
    tabDocs.style.display = 'block';
  });

  // Dropzones para subida de fotos y docs
  setupDropzone('dropzone-photos', 'file-input-photos', (files) => uploadFilesToItem(files, 'photo'));
  setupDropzone('dropzone-docs', 'file-input-docs', (files) => uploadFilesToItem(files, 'document'));

  // Copias de seguridad: Exportar e Importar
  document.getElementById('btn-export-backup').addEventListener('click', () => {
    window.location.href = '/api/backup/export';
  });

  const modalImport = document.getElementById('modal-import');
  document.getElementById('btn-open-import').addEventListener('click', () => modalImport.classList.add('active'));
  document.getElementById('btn-close-import').addEventListener('click', () => modalImport.classList.remove('active'));
  document.getElementById('btn-cancel-import').addEventListener('click', () => modalImport.classList.remove('active'));

  document.getElementById('btn-submit-import').addEventListener('click', async () => {
    const fileInput = document.getElementById('import-file-input');
    if (!fileInput.files || fileInput.files.length === 0) {
      showToast('Selecciona un archivo JSON', 'warn');
      return;
    }
    const file = fileInput.files[0];
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const json = JSON.parse(e.target.result);
        const res = await fetch('/api/backup/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(json)
        });
        const resData = await res.json();
        if (resData.success) {
          showToast(resData.message, 'success');
          modalImport.classList.remove('active');
          await loadStats();
          await loadItems();
        } else {
          showToast(resData.error, 'error');
        }
      } catch (err) {
        showToast('Archivo JSON no válido', 'error');
      }
    };
    reader.readAsText(file);
  });
}

function setupDropzone(dropzoneId, inputId, onFiles) {
  const dropzone = document.getElementById(dropzoneId);
  const input = document.getElementById(inputId);

  dropzone.addEventListener('click', () => input.click());

  input.addEventListener('change', () => {
    if (input.files.length > 0) {
      onFiles(input.files);
      input.value = '';
    }
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  ['dragleave', 'dragend'].forEach(type => {
    dropzone.addEventListener(type, () => dropzone.classList.remove('dragover'));
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      onFiles(e.dataTransfer.files);
    }
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

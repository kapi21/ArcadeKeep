const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const https = require('node:https');
const selfsigned = require('selfsigned');
const QRCode = require('qrcode');

const { db, DATA_DIR, UPLOADS_DIR } = require('./db');
const { lookupBarcode, searchGames, getPriceChartingValuation } = require('./lookup');

const app = express();
const HTTP_PORT = process.env.PORT || 3030;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

// Obtener IP local de la red LAN (192.168.x.x o 10.x.x.x)
function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        if (iface.address.startsWith('192.168.') || iface.address.startsWith('10.') || iface.address.startsWith('172.')) {
          return iface.address;
        }
      }
    }
  }
  return 'localhost';
}

const LAN_IP = getLanIp();

// Configuración o generación de certificados SSL para HTTPS
async function getOrGenerateCertificates() {
  const certPath = path.join(DATA_DIR, 'cert.pem');
  const keyPath = path.join(DATA_DIR, 'key.pem');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return {
      cert: fs.readFileSync(certPath, 'utf8'),
      key: fs.readFileSync(keyPath, 'utf8')
    };
  }

  console.log('[SSL] Generando certificado SSL auto-firmado para soporte de cámara en móvil...');
  const attrs = [{ name: 'commonName', value: LAN_IP }];
  const pems = await selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          { type: 7, ip: LAN_IP }
        ]
      }
    ]
  });

  fs.writeFileSync(certPath, pems.cert, 'utf8');
  fs.writeFileSync(keyPath, pems.private, 'utf8');
  return { cert: pems.cert, key: pems.private };
}

// Configuración de almacenamiento para fotos y documentos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const cleanBase = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const uniqueSuffix = `${Date.now()}_${Math.round(Math.random() * 1e6)}`;
    cb(null, `${cleanBase}_${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 } // Hasta 25MB por archivo
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// Información LAN y Código QR para Móvil
// -------------------------------------------------------------
app.get('/api/lan-info', (req, res) => {
  res.json({
    success: true,
    lanIp: LAN_IP,
    httpUrl: `http://${LAN_IP}:${HTTP_PORT}`,
    httpsUrl: `https://${LAN_IP}:${HTTPS_PORT}`,
    notice: 'Para usar la cámara del móvil en Chrome/Safari se requiere HTTPS.'
  });
});

app.get('/api/lan-qr', async (req, res) => {
  try {
    const url = `https://${LAN_IP}:${HTTPS_PORT}`;
    const qrDataUrl = await QRCode.toDataURL(url, {
      width: 260,
      margin: 2,
      color: {
        dark: '#00e5ff',
        light: '#0c0f17'
      }
    });
    res.json({ success: true, url, qrDataUrl });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Rutas de Plataformas
// -------------------------------------------------------------
app.get('/api/platforms', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM platforms ORDER BY type, name').all();
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Estadísticas Globales
// -------------------------------------------------------------
app.get('/api/stats', (req, res) => {
  try {
    const totalItems = db.prepare('SELECT COUNT(*) as count FROM items').get().count;
    const totalValue = db.prepare('SELECT COALESCE(SUM(estimated_value), 0) as total FROM items').get().total;
    const gamesCount = db.prepare("SELECT COUNT(*) as count FROM items WHERE type = 'game'").get().count;
    const consolesCount = db.prepare("SELECT COUNT(*) as count FROM items WHERE type = 'console'").get().count;
    const accessoriesCount = db.prepare("SELECT COUNT(*) as count FROM items WHERE type = 'accessory'").get().count;
    
    const byPlatform = db.prepare(`
      SELECT p.name, p.icon, COUNT(i.id) as count
      FROM items i
      LEFT JOIN platforms p ON i.platform_id = p.id
      GROUP BY i.platform_id
      ORDER BY count DESC
      LIMIT 6
    `).all();

    const byCondition = db.prepare(`
      SELECT condition, COUNT(*) as count
      FROM items
      GROUP BY condition
    `).all();

    res.json({
      success: true,
      data: {
        totalItems,
        totalValue,
        gamesCount,
        consolesCount,
        accessoriesCount,
        byPlatform,
        byCondition
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Listado de Ítems con Filtros
// -------------------------------------------------------------
app.get('/api/items', (req, res) => {
  try {
    const { search, platform_id, type, condition, region, favorite } = req.query;
    let sql = `
      SELECT i.*, p.name as platform_name, p.icon as platform_icon,
        (SELECT COUNT(*) FROM item_media m WHERE m.item_id = i.id) as media_count
      FROM items i
      LEFT JOIN platforms p ON i.platform_id = p.id
      WHERE 1=1
    `;
    const params = [];

    if (search && search.trim()) {
      sql += ` AND (i.title LIKE ? OR i.barcode LIKE ? OR i.notes LIKE ? OR i.serial_number LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }
    if (platform_id) {
      sql += ` AND i.platform_id = ?`;
      params.push(platform_id);
    }
    if (type) {
      sql += ` AND i.type = ?`;
      params.push(type);
    }
    if (condition) {
      sql += ` AND i.condition = ?`;
      params.push(condition);
    }
    if (region) {
      sql += ` AND i.region = ?`;
      params.push(region);
    }
    if (favorite === '1') {
      sql += ` AND i.is_favorite = 1`;
    }

    sql += ` ORDER BY i.id DESC`;
    const stmt = db.prepare(sql);
    const items = stmt.all(...params);

    res.json({ success: true, count: items.length, data: items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Detalle de un Ítem con sus Medios y Fotos
// -------------------------------------------------------------
app.get('/api/items/:id', (req, res) => {
  try {
    const itemId = parseInt(req.params.id, 10);
    const item = db.prepare(`
      SELECT i.*, p.name as platform_name, p.icon as platform_icon, p.manufacturer
      FROM items i
      LEFT JOIN platforms p ON i.platform_id = p.id
      WHERE i.id = ?
    `).get(itemId);

    if (!item) {
      return res.status(404).json({ success: false, error: 'Ítem no encontrado' });
    }

    const media = db.prepare(`
      SELECT * FROM item_media
      WHERE item_id = ?
      ORDER BY id ASC
    `).all(itemId);

    res.json({
      success: true,
      data: {
        ...item,
        media
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Crear Ítem
// -------------------------------------------------------------
app.post('/api/items', (req, res) => {
  try {
    const {
      title,
      type = 'game',
      platform_id = null,
      barcode = null,
      region = 'PAL-ESP',
      condition = 'CIB',
      state_rating = 8,
      serial_number = null,
      purchase_price = 0,
      estimated_value = 0,
      purchase_date = null,
      location = null,
      notes = null,
      cover_image = null,
      is_favorite = 0,
      has_mods = 0
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'El título es obligatorio' });
    }

    const insert = db.prepare(`
      INSERT INTO items (
        title, type, platform_id, barcode, region, condition, state_rating,
        serial_number, purchase_price, estimated_value, purchase_date,
        location, notes, cover_image, is_favorite, has_mods
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      title.trim(),
      type,
      platform_id || null,
      barcode ? barcode.trim() : null,
      region,
      condition,
      parseInt(state_rating, 10) || 8,
      serial_number ? serial_number.trim() : null,
      parseFloat(purchase_price) || 0,
      parseFloat(estimated_value) || 0,
      purchase_date || null,
      location ? location.trim() : null,
      notes ? notes.trim() : null,
      cover_image || null,
      is_favorite ? 1 : 0,
      has_mods ? 1 : 0
    );

    const newItem = db.prepare('SELECT * FROM items ORDER BY id DESC LIMIT 1').get();
    res.status(201).json({ success: true, data: newItem });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Actualizar Ítem
// -------------------------------------------------------------
app.put('/api/items/:id', (req, res) => {
  try {
    const itemId = parseInt(req.params.id, 10);
    const existing = db.prepare('SELECT id FROM items WHERE id = ?').get(itemId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Ítem no encontrado' });
    }

    const {
      title,
      type,
      platform_id,
      barcode,
      region,
      condition,
      state_rating,
      serial_number,
      purchase_price,
      estimated_value,
      purchase_date,
      location,
      notes,
      cover_image,
      is_favorite,
      has_mods
    } = req.body;

    const update = db.prepare(`
      UPDATE items SET
        title = COALESCE(?, title),
        type = COALESCE(?, type),
        platform_id = ?,
        barcode = ?,
        region = COALESCE(?, region),
        condition = COALESCE(?, condition),
        state_rating = COALESCE(?, state_rating),
        serial_number = ?,
        purchase_price = COALESCE(?, purchase_price),
        estimated_value = COALESCE(?, estimated_value),
        purchase_date = ?,
        location = ?,
        notes = ?,
        cover_image = COALESCE(?, cover_image),
        is_favorite = COALESCE(?, is_favorite),
        has_mods = COALESCE(?, has_mods),
        updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `);

    update.run(
      title ? title.trim() : null,
      type || null,
      platform_id || null,
      barcode ? barcode.trim() : null,
      region || null,
      condition || null,
      state_rating !== undefined ? parseInt(state_rating, 10) : null,
      serial_number !== undefined ? (serial_number ? serial_number.trim() : null) : null,
      purchase_price !== undefined ? parseFloat(purchase_price) : null,
      estimated_value !== undefined ? parseFloat(estimated_value) : null,
      purchase_date || null,
      location || null,
      notes || null,
      cover_image || null,
      is_favorite !== undefined ? (is_favorite ? 1 : 0) : null,
      has_mods !== undefined ? (has_mods ? 1 : 0) : null,
      itemId
    );

    const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Eliminar Ítem y sus archivos
// -------------------------------------------------------------
app.delete('/api/items/:id', (req, res) => {
  try {
    const itemId = parseInt(req.params.id, 10);
    const mediaFiles = db.prepare('SELECT file_path FROM item_media WHERE item_id = ?').all(itemId);
    for (const m of mediaFiles) {
      if (m.file_path && fs.existsSync(m.file_path)) {
        try { fs.unlinkSync(m.file_path); } catch (e) {}
      }
    }

    db.prepare('DELETE FROM items WHERE id = ?').run(itemId);
    res.json({ success: true, message: 'Ítem eliminado correctamente' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Subida de Fotos y Documentos a un Ítem
// -------------------------------------------------------------
app.post('/api/items/:id/upload', upload.array('files', 10), (req, res) => {
  try {
    const itemId = parseInt(req.params.id, 10);
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Ítem no encontrado' });
    }

    const { category = 'photo', caption = '' } = req.body;
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ success: false, error: 'No se recibieron archivos' });
    }

    const insertMedia = db.prepare(`
      INSERT INTO item_media (item_id, media_type, category, file_name, file_path, mime_type, file_size, caption)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const inserted = [];
    let firstImageUrl = null;

    for (const file of files) {
      const isImg = file.mimetype.startsWith('image/');
      const mediaType = isImg ? 'image' : 'document';
      const fileUrl = `/uploads/${file.filename}`;

      insertMedia.run(
        itemId,
        mediaType,
        category,
        file.originalname,
        file.path,
        file.mimetype,
        file.size,
        caption || file.originalname
      );

      if (isImg && !firstImageUrl) {
        firstImageUrl = fileUrl;
      }

      inserted.push({
        file_name: file.originalname,
        url: fileUrl,
        media_type: mediaType,
        category
      });
    }

    if (!item.cover_image && firstImageUrl) {
      db.prepare('UPDATE items SET cover_image = ? WHERE id = ?').run(firstImageUrl, itemId);
    }

    res.json({ success: true, count: inserted.length, data: inserted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Eliminar un archivo multimedia específico
app.delete('/api/media/:mediaId', (req, res) => {
  try {
    const mediaId = parseInt(req.params.mediaId, 10);
    const media = db.prepare('SELECT * FROM item_media WHERE id = ?').get(mediaId);
    if (!media) {
      return res.status(404).json({ success: false, error: 'Archivo no encontrado' });
    }

    if (media.file_path && fs.existsSync(media.file_path)) {
      try { fs.unlinkSync(media.file_path); } catch (e) {}
    }

    db.prepare('DELETE FROM item_media WHERE id = ?').run(mediaId);
    res.json({ success: true, message: 'Archivo eliminado' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Lookup de Código de Barras y Autocompletado
// -------------------------------------------------------------
app.post('/api/lookup/barcode', async (req, res) => {
  try {
    const { barcode } = req.body;
    if (!barcode || !barcode.trim()) {
      return res.status(400).json({ success: false, error: 'Código de barras requerido' });
    }

    const clean = barcode.trim();
    const existing = db.prepare('SELECT i.*, p.name as platform_name FROM items i LEFT JOIN platforms p ON i.platform_id = p.id WHERE i.barcode = ?').all(clean);
    const lookupResult = await lookupBarcode(clean);

    // 3. Si se obtuvo título, consultar automáticamente la tasación de PriceCharting
    let valuation = null;
    if (lookupResult && lookupResult.title) {
      valuation = await getPriceChartingValuation(lookupResult.title, lookupResult.platform_id, 'CIB');
    }

    res.json({
      success: true,
      barcode: clean,
      alreadyInCollection: existing.length > 0,
      existingItems: existing,
      metadata: lookupResult,
      valuation
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/lookup/search', async (req, res) => {
  try {
    const { q, platform } = req.query;
    if (!q || q.trim().length < 2) {
      return res.json({ success: true, results: [] });
    }
    const results = await searchGames(q, platform || null);
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint de Tasación de Mercado en Tiempo Real (PriceCharting)
app.get('/api/lookup/valuation', async (req, res) => {
  try {
    const { q, platform, condition = 'CIB' } = req.query;
    if (!q || q.trim().length < 2) {
      return res.status(400).json({ success: false, error: 'Título de búsqueda requerido' });
    }
    const valuation = await getPriceChartingValuation(q, platform || null, condition);
    if (!valuation) {
      return res.json({ success: false, message: 'No se encontraron registros de precio para este producto' });
    }
    res.json({ success: true, data: valuation });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Copia de Seguridad: Exportación e Importación
// -------------------------------------------------------------
app.get('/api/backup/export', (req, res) => {
  try {
    const items = db.prepare('SELECT * FROM items').all();
    const media = db.prepare('SELECT * FROM item_media').all();
    const backup = {
      exportDate: new Date().toISOString(),
      version: '1.0',
      totalItems: items.length,
      items,
      media
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="coleccion_backup_${Date.now()}.json"`);
    res.send(JSON.stringify(backup, null, 2));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/backup/import', (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ success: false, error: 'Formato de importación inválido' });
    }

    const insert = db.prepare(`
      INSERT INTO items (
        title, type, platform_id, barcode, region, condition, state_rating,
        serial_number, purchase_price, estimated_value, purchase_date,
        location, notes, cover_image, is_favorite, has_mods
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let importedCount = 0;
    for (const item of items) {
      if (item.title) {
        insert.run(
          item.title,
          item.type || 'game',
          item.platform_id || null,
          item.barcode || null,
          item.region || 'PAL-ESP',
          item.condition || 'CIB',
          item.state_rating || 8,
          item.serial_number || null,
          item.purchase_price || 0,
          item.estimated_value || 0,
          item.purchase_date || null,
          item.location || null,
          item.notes || null,
          item.cover_image || null,
          item.is_favorite ? 1 : 0,
          item.has_mods ? 1 : 0
        );
        importedCount++;
      }
    }

    res.json({ success: true, count: importedCount, message: `${importedCount} ítems importados con éxito` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Iniciar Servidores: HTTP y HTTPS simultáneos
async function startServer() {
  try {
    const certs = await getOrGenerateCertificates();

    http.createServer(app).listen(HTTP_PORT, '0.0.0.0', () => {
      console.log(`[HTTP]  Activo en http://localhost:${HTTP_PORT} y http://${LAN_IP}:${HTTP_PORT}`);
    });

    https.createServer(certs, app).listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`[HTTPS] Activo en https://localhost:${HTTPS_PORT} y https://${LAN_IP}:${HTTPS_PORT}`);
      console.log(`[CÁMARA MÓVIL] Abre en tu smartphone: https://${LAN_IP}:${HTTPS_PORT}`);
    });
  } catch (err) {
    console.error('Error al iniciar servidores:', err);
  }
}

startServer();

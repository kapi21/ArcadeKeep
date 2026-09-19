const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'coleccion.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const db = new DatabaseSync(DB_FILE);

// Activar claves foráneas y WAL mode para rendimiento
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS platforms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    manufacturer TEXT,
    type TEXT DEFAULT 'console', -- console, handheld, computer, arcade
    generation INTEGER,
    icon TEXT
  );

  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'game', -- game, console, accessory, book_doc, mod_hardware
    platform_id TEXT,
    barcode TEXT,
    region TEXT DEFAULT 'PAL-ESP', -- PAL-ESP, PAL, NTSC-U, NTSC-J, Region Free
    condition TEXT DEFAULT 'CIB', -- CIB, Boxed, Loose, Sealed
    state_rating INTEGER DEFAULT 8, -- 1 a 10
    serial_number TEXT,
    purchase_price REAL DEFAULT 0.0,
    estimated_value REAL DEFAULT 0.0,
    purchase_date TEXT,
    location TEXT,
    notes TEXT,
    cover_image TEXT,
    is_favorite INTEGER DEFAULT 0,
    has_mods INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(platform_id) REFERENCES platforms(id) ON UPDATE CASCADE ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS item_media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    media_type TEXT NOT NULL, -- image, document
    category TEXT DEFAULT 'photo', -- cover, cartridge, board, box, manual, invoice, schematic, other
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    mime_type TEXT,
    file_size INTEGER,
    caption TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_items_barcode ON items(barcode);
  CREATE INDEX IF NOT EXISTS idx_items_platform ON items(platform_id);
  CREATE INDEX IF NOT EXISTS idx_items_type ON items(type);
  CREATE INDEX IF NOT EXISTS idx_media_item ON item_media(item_id);
`);

// Semilla de plataformas retro reconocidas
const seedPlatforms = [
  { id: 'nes', name: 'NES (Nintendo Entertainment System)', manufacturer: 'Nintendo', type: 'console', generation: 3, icon: '🎮' },
  { id: 'snes', name: 'Super Nintendo (SNES)', manufacturer: 'Nintendo', type: 'console', generation: 4, icon: '🎮' },
  { id: 'n64', name: 'Nintendo 64', manufacturer: 'Nintendo', type: 'console', generation: 5, icon: '🎮' },
  { id: 'gamecube', name: 'Nintendo GameCube', manufacturer: 'Nintendo', type: 'console', generation: 6, icon: '🎮' },
  { id: 'wii', name: 'Nintendo Wii', manufacturer: 'Nintendo', type: 'console', generation: 7, icon: '🎮' },
  { id: 'gameboy', name: 'Game Boy / Game Boy Color', manufacturer: 'Nintendo', type: 'handheld', generation: 4, icon: '🕹️' },
  { id: 'gba', name: 'Game Boy Advance', manufacturer: 'Nintendo', type: 'handheld', generation: 6, icon: '🕹️' },
  { id: 'nds', name: 'Nintendo DS', manufacturer: 'Nintendo', type: 'handheld', generation: 7, icon: '🕹️' },
  { id: 'mastersystem', name: 'Sega Master System', manufacturer: 'Sega', type: 'console', generation: 3, icon: '🎮' },
  { id: 'megadrive', name: 'Sega Mega Drive / Genesis', manufacturer: 'Sega', type: 'console', generation: 4, icon: '🎮' },
  { id: 'gamegear', name: 'Sega Game Gear', manufacturer: 'Sega', type: 'handheld', generation: 4, icon: '🕹️' },
  { id: 'saturn', name: 'Sega Saturn', manufacturer: 'Sega', type: 'console', generation: 5, icon: '💿' },
  { id: 'dreamcast', name: 'Sega Dreamcast', manufacturer: 'Sega', type: 'console', generation: 6, icon: '💿' },
  { id: 'ps1', name: 'Sony PlayStation (PS1 / PSX)', manufacturer: 'Sony', type: 'console', generation: 5, icon: '💿' },
  { id: 'ps2', name: 'Sony PlayStation 2', manufacturer: 'Sony', type: 'console', generation: 6, icon: '💿' },
  { id: 'psp', name: 'Sony PSP', manufacturer: 'Sony', type: 'handheld', generation: 7, icon: '🕹️' },
  { id: 'xbox', name: 'Microsoft Xbox (Clásica)', manufacturer: 'Microsoft', type: 'console', generation: 6, icon: '🎮' },
  { id: 'neogeo', name: 'SNK Neo Geo (AES / MVS / CD)', manufacturer: 'SNK', type: 'console', generation: 4, icon: '🕹️' },
  { id: 'pce', name: 'PC Engine / TurboGrafx-16', manufacturer: 'NEC', type: 'console', generation: 4, icon: '🎮' },
  { id: 'atari2600', name: 'Atari 2600 / 7800', manufacturer: 'Atari', type: 'console', generation: 2, icon: '🕹️' },
  { id: 'spectrum', name: 'ZX Spectrum', manufacturer: 'Sinclair', type: 'computer', generation: 3, icon: '💾' },
  { id: 'amstrad', name: 'Amstrad CPC', manufacturer: 'Amstrad', type: 'computer', generation: 3, icon: '💾' },
  { id: 'c64', name: 'Commodore 64', manufacturer: 'Commodore', type: 'computer', generation: 3, icon: '💾' },
  { id: 'amiga', name: 'Commodore Amiga (500/1200)', manufacturer: 'Commodore', type: 'computer', generation: 4, icon: '💾' },
  { id: 'msx', name: 'MSX / MSX2', manufacturer: 'Varios', type: 'computer', generation: 3, icon: '💾' },
  { id: 'arcade', name: 'Placas Arcade (JAMMA / CPS / NeoGeo MVS)', manufacturer: 'Varios', type: 'arcade', generation: 4, icon: '👾' },
  { id: 'retro_pc', name: 'PC Retro (MS-DOS / Win98)', manufacturer: 'IBM / Compatible', type: 'computer', generation: 4, icon: '💻' },
  { id: 'other', name: 'Otros Sistemas / Varios', manufacturer: 'Varios', type: 'console', generation: 0, icon: '📦' }
];

const checkPlatforms = db.prepare('SELECT COUNT(*) as count FROM platforms').get();
if (checkPlatforms.count === 0) {
  const insertPlatform = db.prepare(`
    INSERT INTO platforms (id, name, manufacturer, type, generation, icon)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const p of seedPlatforms) {
    insertPlatform.run(p.id, p.name, p.manufacturer, p.type, p.generation, p.icon);
  }
}

module.exports = {
  db,
  DATA_DIR,
  UPLOADS_DIR,
  DB_FILE
};

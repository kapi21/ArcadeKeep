# HANDOFF - ArcadeKeep

Fecha: 19 de septiembre de 2026  
Repositorio: [https://github.com/kapi21/ArcadeKeep](https://github.com/kapi21/ArcadeKeep)  
Servidor Producción: Proxmox LXC 109 (`coleccion`)  
URLs de Acceso:
- HTTP: `http://192.168.1.69:3030`
- HTTPS: `https://192.168.1.69:3443` (para acceso a cámara en móvil)

---

## 1. Estado del Proyecto
- **Aplicación**: Web PWA completa para inventario y tasación de videojuegos retro, consolas y accesorios.
- **Backend**: Node.js 22 + SQLite nativo (`node:sqlite`) + Express.
- **Base de Datos**: 12 ítems activos verificados y consolidados.
- **Auto-tasación**: Integración operativa con PriceCharting API / web lookup.
- **PWA**: `manifest.webmanifest`, `sw.js` e icono joystick SVG adaptados a móviles.

## 2. Infraestructura y Despliegue
- **Proxmox VE**: Host `192.168.1.58` (root).
- **LXC 109**: IP `192.168.1.69`, servicio systemd `coleccion.service`.
- **Script de Despliegue**: `python scripts/deploy_lxc.py`
  - Realiza checkpoint automático `PRAGMA wal_checkpoint(TRUNCATE)` para volcar datos en caliente.
  - Sincroniza código y base de datos con Proxmox sin exponer credenciales.
- **Seguridad**: `.secrets.json` y carpetas locales de datos están ignoradas en `.gitignore`.

## 3. Comandos de Gestión Rápida
```bash
# Sincronizar cambios locales y base de datos a Proxmox LXC 109
python scripts/deploy_lxc.py

# Arrancar servidor local de pruebas
node server.js
```

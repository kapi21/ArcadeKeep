#!/usr/bin/env python3
"""Script de despliegue automatizado de COLECCION al contenedor LXC en Proxmox."""
from __future__ import annotations

import argparse
import os
import sys
import tarfile
import tempfile
import time
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

try:
    import paramiko
except ImportError:
    paramiko = None

ROOT = Path(__file__).resolve().parents[1]

# Cargar configuración desde .secrets.json si existe
secrets_file = ROOT / ".secrets.json"
secrets = {}
if secrets_file.exists():
    try:
        import json
        secrets = json.loads(secrets_file.read_text(encoding="utf-8"))
    except Exception:
        pass

PVE_HOST = os.environ.get("PVE_HOST", secrets.get("PVE_HOST", "192.168.1.58"))
PVE_USER = os.environ.get("PVE_USER", secrets.get("PVE_USER", "root"))
PVE_PASS = os.environ.get("PVE_PASS", secrets.get("PVE_PASS", ""))
DEFAULT_VMID = os.environ.get("PVE_VMID", "109")
REMOTE_PATH = "/opt/coleccion"
SERVICE_NAME = "coleccion"

FILES_TO_DEPLOY = [
    "package.json",
    "server.js",
    "db.js",
    "lookup.js",
    "public/index.html",
    "public/css/style.css",
    "public/js/app.js",
    "public/favicon.svg",
    "public/arcadekeep-logo.svg",
    "public/manifest.webmanifest",
    "public/sw.js",
    "README.md",
    "data/coleccion.db"
]

def make_tar() -> Path:
    tmp = tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False)
    tmp.close()
    with tarfile.open(tmp.name, "w:gz") as tar:
        for rel in FILES_TO_DEPLOY:
            p = ROOT / rel
            if p.exists():
                tar.add(p, arcname=rel)
                print(f"[+] Empaquetado: {rel}")
            else:
                print(f"[-] Omitido (no existe): {rel}")
    return Path(tmp.name)

def deploy(vmid: str):
    if not paramiko:
        print("[!] Error: paramiko no está instalado en el entorno de Python actual. Instálalo con pip install paramiko.")
        return

    # 1. Consolidar archivo WAL de SQLite antes de empaquetar
    db_path = ROOT / "data" / "coleccion.db"
    if db_path.exists():
        try:
            import sqlite3
            con = sqlite3.connect(str(db_path))
            con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            con.close()
            print("[+] SQLite WAL consolidado en coleccion.db")
        except Exception as e:
            print(f"[-] Aviso al consolidar WAL: {e}")

    print(f"[*] Conectando a Proxmox {PVE_HOST}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(PVE_HOST, username=PVE_USER, password=PVE_PASS, timeout=10)

    tar_path = make_tar()
    remote_tar = f"/tmp/coleccion_{vmid}.tar.gz"

    try:
        sftp = ssh.open_sftp()
        print(f"[*] Subiendo archivo a PVE: {remote_tar}...")
        sftp.put(str(tar_path), remote_tar)
        sftp.close()

        cmds = [
            f"pct exec {vmid} -- systemctl stop {SERVICE_NAME} || true",
            f"pct exec {vmid} -- mkdir -p {REMOTE_PATH}/data/uploads",
            f"pct exec {vmid} -- rm -f {REMOTE_PATH}/data/coleccion.db-wal {REMOTE_PATH}/data/coleccion.db-shm",
            f"pct push {vmid} {remote_tar} {remote_tar}",
            f"pct exec {vmid} -- tar -xzf {remote_tar} -C {REMOTE_PATH}",
            f"pct exec {vmid} -- rm -f {remote_tar}",
            f"pct exec {vmid} -- bash -c 'cd {REMOTE_PATH} && npm install --omit=dev'",
            f"pct exec {vmid} -- systemctl restart {SERVICE_NAME}"
        ]

        for cmd in cmds:
            print(f"[*] Ejecutando: {cmd}")
            stdin, stdout, stderr = ssh.exec_command(cmd)
            out = stdout.read().decode().strip()
            err = stderr.read().decode().strip()
            if out:
                print(f"    {out}")
            if err:
                print(f"    [ERR] {err}")

        print(f"[+] Despliegue completado en LXC {vmid}!")
    finally:
        if tar_path.exists():
            os.unlink(tar_path)
        ssh.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Desplegar Colección Retro en LXC Proxmox")
    parser.add_argument("--vmid", default=DEFAULT_VMID, help="ID del contenedor LXC (ej. 107)")
    args = parser.parse_args()
    deploy(args.vmid)

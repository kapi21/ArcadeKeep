#!/usr/bin/env python3
"""Script de creación y despliegue del contenedor LXC 109 (coleccion) en Proxmox."""
from __future__ import annotations

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
    print("[!] Error: paramiko no está instalado")
    sys.exit(1)

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
VMID = os.environ.get("PVE_VMID", "109")
IP = "192.168.1.69"
HOSTNAME = "coleccion"
TEMPLATE = "local:vztmpl/debian-12-standard_12.12-1_amd64.tar.zst"
REMOTE_PATH = "/opt/coleccion"

FILES_TO_DEPLOY = [
    "package.json",
    "server.js",
    "db.js",
    "lookup.js",
    "public/index.html",
    "public/css/style.css",
    "public/js/app.js",
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
                print(f"[-] Omitido: {rel}")
    return Path(tmp.name)

def run_cmd(ssh, cmd, ignore_error=False):
    print(f"[*] Ejecutando en PVE: {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out:
        print(f"    {out}")
    if err and not ignore_error:
        print(f"    [ERR] {err}")
    return out

def main():
    print(f"[*] Conectando a Proxmox {PVE_HOST}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(PVE_HOST, username=PVE_USER, password=PVE_PASS, timeout=15)

    # 1. Comprobar si LXC 109 ya existe
    out = run_cmd(ssh, f"pct status {VMID}", ignore_error=True)
    if "status:" not in out:
        print(f"[*] Creando contenedor LXC {VMID} ({HOSTNAME}) con IP {IP}...")
        create_cmd = (
            f"pct create {VMID} {TEMPLATE} "
            f"--hostname {HOSTNAME} "
            f"--cores 2 "
            f"--memory 2048 "
            f"--swap 512 "
            f"--rootfs local-lvm:16 "
            f"--net0 name=eth0,bridge=vmbr0,gw=192.168.1.1,ip={IP}/24,type=veth "
            f"--nameserver 192.168.1.1 "
            f"--ostype debian "
            f"--unprivileged 1 "
            f"--onboot 1 "
            f"--description 'Retro Vault - Gestor de Coleccion de Videojuegos y Consolas'"
        )
        run_cmd(ssh, create_cmd)
    else:
        print(f"[i] El contenedor LXC {VMID} ya existe.")

    # 2. Iniciar contenedor si está parado
    status = run_cmd(ssh, f"pct status {VMID}")
    if "stopped" in status:
        print(f"[*] Iniciando LXC {VMID}...")
        run_cmd(ssh, f"pct start {VMID}")
        time.sleep(5)

    # 3. Esperar que la red esté activa en el LXC
    print("[*] Verificando conectividad en el contenedor...")
    for _ in range(10):
        res = run_cmd(ssh, f"pct exec {VMID} -- ping -c 1 192.168.1.1", ignore_error=True)
        if "1 received" in res or "1 packets transmitted, 1 received" in res:
            print("[+] Red activa en LXC!")
            break
        time.sleep(2)

    # 4. Instalar Node.js 22 LTS y dependencias base
    print("[*] Comprobando Node.js en el contenedor...")
    node_chk = run_cmd(ssh, f"pct exec {VMID} -- node -v", ignore_error=True)
    if "v" not in node_chk:
        print("[*] Instalando Node.js 22 LTS en el contenedor LXC...")
        run_cmd(ssh, f"pct exec {VMID} -- apt-get update")
        run_cmd(ssh, f"pct exec {VMID} -- apt-get install -y curl ca-certificates gnupg")
        run_cmd(ssh, f"pct exec {VMID} -- bash -c 'curl -fsSL https://deb.nodesource.com/setup_22.x | bash -'")
        run_cmd(ssh, f"pct exec {VMID} -- apt-get install -y nodejs")

    # 5. Transferir código fuente y base de datos
    tar_path = make_tar()
    remote_tar = f"/tmp/coleccion_{VMID}.tar.gz"
    try:
        sftp = ssh.open_sftp()
        print(f"[*] Subiendo paquete a PVE: {remote_tar}...")
        sftp.put(str(tar_path), remote_tar)
        sftp.close()

        run_cmd(ssh, f"pct exec {VMID} -- mkdir -p {REMOTE_PATH}/data/uploads")
        run_cmd(ssh, f"pct push {VMID} {remote_tar} {remote_tar}")
        run_cmd(ssh, f"pct exec {VMID} -- tar -xzf {remote_tar} -C {REMOTE_PATH}")
        run_cmd(ssh, f"pct exec {VMID} -- rm -f {remote_tar}")
        run_cmd(ssh, f"rm -f {remote_tar}")

        print("[*] Instalando dependencias de producción en LXC...")
        run_cmd(ssh, f"pct exec {VMID} -- bash -c 'cd {REMOTE_PATH} && npm install --omit=dev'")

        # 6. Configurar servicio systemd
        service_content = """[Unit]
Description=Retro Vault Coleccion
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/coleccion
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3030
Environment=HTTPS_PORT=3443

[Install]
WantedBy=multi-user.target
"""
        svc_tmp = "/tmp/coleccion.service"
        run_cmd(ssh, f"cat << 'EOF' > {svc_tmp}\n{service_content}\nEOF")
        run_cmd(ssh, f"pct push {VMID} {svc_tmp} /etc/systemd/system/coleccion.service")
        run_cmd(ssh, f"rm -f {svc_tmp}")

        run_cmd(ssh, f"pct exec {VMID} -- systemctl daemon-reload")
        run_cmd(ssh, f"pct exec {VMID} -- systemctl enable --now coleccion.service")
        run_cmd(ssh, f"pct exec {VMID} -- systemctl restart coleccion.service")
        time.sleep(3)

        # 7. Verificar estado
        svc_status = run_cmd(ssh, f"pct exec {VMID} -- systemctl is-active coleccion.service")
        print(f"[+] Estado del servicio en LXC: {svc_status}")

        print("\n=======================================================")
        print(f"  COLECCION RETRO DESPLEGADA CON EXITO EN PROXMOX LXC {VMID}")
        print(f"  - HTTP:  http://{IP}:3030")
        print(f"  - HTTPS: https://{IP}:3443 (Camara movil)")
        print("=======================================================\n")
    finally:
        if tar_path.exists():
            os.unlink(tar_path)
        ssh.close()

if __name__ == "__main__":
    main()

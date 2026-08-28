"""ComfyUI Cloudflare 临时隧道图形启动器。"""

from __future__ import annotations

import os
import queue
import re
import shutil
import socket
import subprocess
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk


URL_PATTERN = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com", re.IGNORECASE)
DEFAULT_URL = "http://127.0.0.1:8188"
DEFAULT_CLOUDFLARED_PATHS = (
    Path(r"D:\tools\cloudflared\cloudflared.exe"),
    Path(r"C:\Program Files (x86)\cloudflared\cloudflared.exe"),
    Path(r"C:\Program Files\cloudflared\cloudflared.exe"),
)


def find_cloudflared() -> str:
    """按本机常见位置和 PATH 查找 cloudflared。"""
    for candidate in DEFAULT_CLOUDFLARED_PATHS:
        if candidate.is_file():
            return str(candidate)
    from_path = shutil.which("cloudflared")
    return from_path or ""


def comfyui_is_running(url: str) -> bool:
    """只检查本地端口是否可连接，不向 ComfyUI 发起额外请求。"""
    try:
        parsed = url.removeprefix("http://").removeprefix("https://")
        host, port_text = parsed.split(":", 1)
        port = int(port_text.split("/", 1)[0])
        with socket.create_connection((host, port), timeout=0.8):
            return True
    except (OSError, ValueError):
        return False


class TunnelWindow(tk.Tk):
    """管理 cloudflared 子进程并显示临时公网地址。"""

    def __init__(self) -> None:
        super().__init__()
        self.title("ComfyUI 云酒馆隧道")
        self.geometry("700x470")
        self.minsize(620, 400)
        self.process: subprocess.Popen[str] | None = None
        self.output_queue: queue.Queue[str] = queue.Queue()
        self.public_url = ""

        self.comfy_url = tk.StringVar(value=DEFAULT_URL)
        self.cloudflared_path = tk.StringVar(value=find_cloudflared())
        self.status = tk.StringVar(value="未启动")
        self._build_ui()
        self.after(100, self._drain_output)
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    def _build_ui(self) -> None:
        """创建简洁的配置、地址和日志区域。"""
        root = ttk.Frame(self, padding=14)
        root.pack(fill=tk.BOTH, expand=True)
        root.columnconfigure(1, weight=1)
        root.rowconfigure(4, weight=1)

        ttk.Label(root, text="本地 ComfyUI 地址").grid(row=0, column=0, sticky="w", pady=5)
        ttk.Entry(root, textvariable=self.comfy_url).grid(row=0, column=1, columnspan=2, sticky="ew", pady=5)

        ttk.Label(root, text="cloudflared 路径").grid(row=1, column=0, sticky="w", pady=5)
        ttk.Entry(root, textvariable=self.cloudflared_path).grid(row=1, column=1, sticky="ew", pady=5)
        ttk.Button(root, text="浏览...", command=self._choose_executable).grid(row=1, column=2, padx=(8, 0), pady=5)

        actions = ttk.Frame(root)
        actions.grid(row=2, column=0, columnspan=3, sticky="w", pady=(8, 10))
        self.start_button = ttk.Button(actions, text="启动隧道", command=self.start_tunnel)
        self.start_button.pack(side=tk.LEFT)
        self.stop_button = ttk.Button(actions, text="停止隧道", command=self.stop_tunnel, state=tk.DISABLED)
        self.stop_button.pack(side=tk.LEFT, padx=8)
        ttk.Label(actions, textvariable=self.status).pack(side=tk.LEFT, padx=8)

        ttk.Label(root, text="公网地址（填到云酒馆）").grid(row=3, column=0, sticky="w", pady=5)
        address_frame = ttk.Frame(root)
        address_frame.grid(row=3, column=1, columnspan=2, sticky="ew", pady=5)
        address_frame.columnconfigure(0, weight=1)
        self.address_entry = ttk.Entry(address_frame, state="readonly")
        self.address_entry.grid(row=0, column=0, sticky="ew")
        self.copy_button = ttk.Button(address_frame, text="复制", command=self.copy_address, state=tk.DISABLED)
        self.copy_button.grid(row=0, column=1, padx=(8, 0))

        ttk.Label(root, text="运行日志").grid(row=4, column=0, sticky="nw", pady=(8, 5))
        self.log_text = tk.Text(root, height=14, wrap=tk.WORD, state=tk.DISABLED)
        self.log_text.grid(row=4, column=1, columnspan=2, sticky="nsew", pady=(8, 5))
        scrollbar = ttk.Scrollbar(root, orient=tk.VERTICAL, command=self.log_text.yview)
        scrollbar.grid(row=4, column=3, sticky="ns", pady=(8, 5))
        self.log_text.configure(yscrollcommand=scrollbar.set)

        ttk.Label(
            root,
            text="请先在绘世启动 ComfyUI，再点击“启动隧道”。关闭本窗口会停止隧道。",
            foreground="#666666",
        ).grid(row=5, column=0, columnspan=3, sticky="w", pady=(8, 0))

    def _choose_executable(self) -> None:
        selected = filedialog.askopenfilename(
            title="选择 cloudflared.exe",
            filetypes=(("cloudflared 程序", "cloudflared.exe"), ("所有文件", "*.*")),
        )
        if selected:
            self.cloudflared_path.set(selected)

    def _write_log(self, text: str) -> None:
        self.log_text.configure(state=tk.NORMAL)
        self.log_text.insert(tk.END, text.rstrip() + "\n")
        self.log_text.see(tk.END)
        self.log_text.configure(state=tk.DISABLED)

    def _set_address(self, url: str) -> None:
        self.public_url = url
        self.address_entry.configure(state=tk.NORMAL)
        self.address_entry.delete(0, tk.END)
        self.address_entry.insert(0, url)
        self.address_entry.configure(state="readonly")
        self.copy_button.configure(state=tk.NORMAL)

    def start_tunnel(self) -> None:
        if self.process and self.process.poll() is None:
            return
        executable = Path(self.cloudflared_path.get().strip())
        if not executable.is_file():
            messagebox.showerror("找不到程序", "请选择有效的 cloudflared.exe 文件。")
            return
        target = self.comfy_url.get().strip() or DEFAULT_URL
        if not comfyui_is_running(target):
            self._write_log(f"未检测到本地服务：{target}")
            messagebox.showwarning("ComfyUI 未启动", "请先用绘世启动 ComfyUI，确认 8188 端口正常后再试。")
            return

        self.public_url = ""
        self._set_address("")
        self.copy_button.configure(state=tk.DISABLED)
        self.status.set("启动中...")
        self.start_button.configure(state=tk.DISABLED)
        self.stop_button.configure(state=tk.NORMAL)
        command = [str(executable), "tunnel", "--no-autoupdate", "--url", target]
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            self.process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                creationflags=creation_flags,
            )
        except OSError as exc:
            self._write_log(f"启动失败：{exc}")
            self._reset_controls()
            return
        self._write_log("正在启动 Cloudflare 临时隧道...")
        threading.Thread(target=self._read_process_output, daemon=True).start()

    def _read_process_output(self) -> None:
        process = self.process
        if not process or not process.stdout:
            return
        for line in process.stdout:
            self.output_queue.put(line.rstrip())
        self.output_queue.put("__PROCESS_EXITED__")

    def _drain_output(self) -> None:
        try:
            while True:
                line = self.output_queue.get_nowait()
                if line == "__PROCESS_EXITED__":
                    self._reset_controls()
                    self.output_queue.task_done()
                    continue
                self._write_log(line)
                match = URL_PATTERN.search(line)
                if match:
                    self._set_address(match.group(0))
                    self.status.set("运行中")
                self.output_queue.task_done()
        except queue.Empty:
            pass
        self.after(100, self._drain_output)

    def copy_address(self) -> None:
        if not self.public_url:
            return
        self.clipboard_clear()
        self.clipboard_append(self.public_url)
        self.update()
        self.status.set("地址已复制")

    def stop_tunnel(self) -> None:
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()
        self._reset_controls()
        self._write_log("隧道已停止。")

    def _reset_controls(self) -> None:
        self.process = None
        self.start_button.configure(state=tk.NORMAL)
        self.stop_button.configure(state=tk.DISABLED)
        if not self.public_url:
            self.status.set("未启动")
        else:
            self.status.set("已停止")

    def _on_close(self) -> None:
        self.stop_tunnel()
        self.destroy()


if __name__ == "__main__":
    os.environ.setdefault("PYTHONUTF8", "1")
    TunnelWindow().mainloop()

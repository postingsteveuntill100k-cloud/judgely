import socket
import json
import base64
import time
import subprocess
import os
import sys

def send_cmd(s, msg_id, cmd, params=None):
    if params is None:
        params = {}
    payload = json.dumps([0, msg_id, cmd, params])
    s.sendall(f"{len(payload)}:{payload}".encode('utf-8'))
    
    # Read response
    data = b""
    while b":" not in data:
        chunk = s.recv(1024)
        if not chunk:
            raise EOFError("Socket closed")
        data += chunk
    
    length_str, rest = data.split(b":", 1)
    msg_len = int(length_str)
    
    while len(rest) < msg_len:
        chunk = s.recv(min(4096, msg_len - len(rest)))
        if not chunk:
            raise EOFError("Socket closed")
        rest += chunk
        
    res = json.loads(rest[:msg_len].decode('utf-8'))
    return res

def capture_page(target_url, output_png, wait_sec=2, click_selector=None, fill_inputs=None):
    # Launch Firefox with marionette
    tmp_prof = f"/tmp/ff_prof_{int(time.time()*1000)}"
    os.makedirs(tmp_prof, exist_ok=True)
    
    proc = subprocess.Popen([
        "firefox", "--headless", "--marionette", "--no-remote",
        "--profile", tmp_prof
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    time.sleep(2)
    
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.connect(('127.0.0.1', 2828))
        # Read handshake
        handshake_data = b""
        while b":" not in handshake_data:
            handshake_data += s.recv(1024)
        h_len, h_rest = handshake_data.split(b":", 1)
        while len(h_rest) < int(h_len):
            h_rest += s.recv(int(h_len) - len(h_rest))
            
        # 1. New Session
        res = send_cmd(s, 1, "WebDriver:NewSession", {})
        
        # 2. Set window rect
        send_cmd(s, 2, "WebDriver:SetWindowRect", {"width": 1440, "height": 900})
        
        # 3. Navigate
        send_cmd(s, 3, "WebDriver:Navigate", {"url": target_url})
        
        time.sleep(wait_sec)
        
        if click_selector:
            js = f"const el = document.querySelector('{click_selector}'); if (el) {{ el.click(); return true; }} return false;"
            send_cmd(s, 4, "WebDriver:ExecuteScript", {"script": js, "args": []})
            time.sleep(1)
            
        # Take Screenshot
        res = send_cmd(s, 5, "WebDriver:TakeScreenshot", {"full": True})
        b64 = res[3].get("value")
        if b64:
            with open(output_png, "wb") as f:
                f.write(base64.b64decode(b64))
            print(f"Captured: {output_png} ({os.path.getsize(output_png)} bytes)")
        else:
            print("Failed to capture screenshot:", res)
            
    finally:
        s.close()
        proc.terminate()
        proc.wait()

if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080/"
    out = sys.argv[2] if len(sys.argv) > 2 else "/tmp/view_public.png"
    wait = float(sys.argv[3]) if len(sys.argv) > 3 else 2.5
    capture_page(url, out, wait_sec=wait)

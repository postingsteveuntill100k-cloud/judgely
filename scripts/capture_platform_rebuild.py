import socket, json, base64, time, subprocess, os

def send_cmd(s, msg_id, cmd, params=None):
    payload = json.dumps([0, msg_id, cmd, params or {}])
    s.sendall(f"{len(payload)}:{payload}".encode('utf-8'))
    data = b""
    while b":" not in data:
        data += s.recv(1024)
    length_str, rest = data.split(b":", 1)
    msg_len = int(length_str)
    while len(rest) < msg_len:
        rest += s.recv(min(4096, msg_len - len(rest)))
    res = json.loads(rest[:msg_len].decode('utf-8'))
    return res

def capture_screenshot(s, msg_id, output_path):
    resp = send_cmd(s, msg_id, "WebDriver:TakeScreenshot", {})
    if isinstance(resp, list) and len(resp) > 3 and isinstance(resp[3], dict) and "value" in resp[3]:
        with open(output_path, "wb") as f:
            f.write(base64.b64decode(resp[3]["value"]))
        print(f"Saved {output_path} ({os.path.getsize(output_path)} bytes)")

def run():
    tmp_prof = f"/tmp/ff_plat_{int(time.time()*1000)}"
    os.makedirs(tmp_prof, exist_ok=True)
    proc = subprocess.Popen([
        "firefox", "--headless", "--marionette", "--no-remote", "--profile", tmp_prof
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2)
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    for _ in range(15):
        try:
            s.connect(("127.0.0.1", 2828))
            break
        except ConnectionRefusedError:
            time.sleep(0.5)

    # handshake
    data = b""
    while b":" not in data:
        data += s.recv(1024)
    l, r = data.split(b":", 1)
    while len(r) < int(l):
        r += s.recv(int(l) - len(r))

    send_cmd(s, 1, "WebDriver:NewSession", {})
    send_cmd(s, 2, "WebDriver:SetWindowRect", {"width": 1440, "height": 950})

    # 1. Platform Homepage & Directory
    print("[1] Navigating to http://localhost:8080...")
    send_cmd(s, 3, "WebDriver:Navigate", {"url": "http://localhost:8080"})
    time.sleep(2)
    capture_screenshot(s, 4, "/tmp/live_new_platform_directory.png")

    # 2. Host a Hackathon Modal
    print("[2] Opening Host a Hackathon wizard...")
    send_cmd(s, 5, "WebDriver:ExecuteScript", {
        "script": "const btn = document.getElementById('btn-hero-host-event') || document.getElementById('btn-directory-host-event'); if (btn) btn.click();"
    })
    time.sleep(1)
    capture_screenshot(s, 6, "/tmp/live_new_host_wizard.png")

    # Close modal
    send_cmd(s, 7, "WebDriver:ExecuteScript", {
        "script": "if (window.Judgely && window.Judgely.closeModal) window.Judgely.closeModal();"
    })
    time.sleep(0.5)

    # 3. Login / Register Tabs Modal
    print("[3] Navigating to /login...")
    send_cmd(s, 8, "WebDriver:Navigate", {"url": "http://localhost:8080/login"})
    time.sleep(1)
    capture_screenshot(s, 9, "/tmp/live_new_login_tabs.png")

    # 4. Google Account Chooser
    print("[4] Opening Google Account Chooser...")
    send_cmd(s, 10, "WebDriver:ExecuteScript", {
        "script": "const btn = document.getElementById('btn-continue-google'); if (btn) btn.click();"
    })
    time.sleep(1)
    capture_screenshot(s, 11, "/tmp/live_new_google_chooser.png")

    send_cmd(s, 12, "WebDriver:DeleteSession", {})
    s.close()
    proc.terminate()
    proc.wait()
    print("Done! All new platform screenshots captured.")

if __name__ == "__main__":
    run()

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

def exec_js(s, msg_id, script, args=None):
    if args is None:
        args = []
    res = send_cmd(s, msg_id, "WebDriver:ExecuteScript", {"script": script, "args": args})
    if isinstance(res, list) and len(res) > 3 and isinstance(res[3], dict):
        return res[3].get("value")
    return res

def wait_for_element(s, get_id, selector, timeout=10):
    start = time.time()
    while time.time() - start < timeout:
        msg_id = get_id()
        script = f"return Boolean(document.querySelector('{selector}'));"
        res = exec_js(s, msg_id, script)
        if res is True or (isinstance(res, dict) and res.get('value') is True):
            return True
        time.sleep(0.3)
    return False

def take_shot(s, msg_id, out_path):
    res = send_cmd(s, msg_id, "WebDriver:TakeScreenshot", {"full": True})
    b64 = res[3].get("value")
    if b64:
        with open(out_path, "wb") as f:
            f.write(base64.b64decode(b64))
        print(f"Captured: {out_path} ({os.path.getsize(out_path)} bytes)")
    else:
        print(f"Failed screenshot for {out_path}:", res)

def run():
    tmp_prof = f"/tmp/ff_prof_critic_{int(time.time()*1000)}"
    os.makedirs(tmp_prof, exist_ok=True)
    
    proc = subprocess.Popen([
        "firefox", "--headless", "--marionette", "--no-remote",
        "--profile", tmp_prof
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    time.sleep(2)
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    _counter = [1]
    def next_id():
        _counter[0] += 1
        return _counter[0]
        
    try:
        s.connect(('127.0.0.1', 2828))
        # Handshake
        hs = b""
        while b":" not in hs:
            hs += s.recv(1024)
        h_len, h_rest = hs.split(b":", 1)
        while len(h_rest) < int(h_len):
            h_rest += s.recv(int(h_len) - len(h_rest))
            
        send_cmd(s, next_id(), "WebDriver:NewSession", {})
        send_cmd(s, next_id(), "WebDriver:SetWindowRect", {"width": 1440, "height": 900})
        
        # 1. Public Showcase
        print("\n--- 1. Reviewing Public View ---")
        send_cmd(s, next_id(), "WebDriver:Navigate", {"url": "http://localhost:8080/"})
        wait_for_element(s, next_id, "#projects-grid", 10)
        time.sleep(1)
        take_shot(s, next_id(), "/tmp/review_public.png")
        
        # Click on first project card to review project detail modal
        exec_js(s, next_id(), """
            const card = document.querySelector('.project-card');
            if (card) card.click();
        """)
        time.sleep(1)
        take_shot(s, next_id(), "/tmp/review_public_modal.png")
        # Close modal
        exec_js(s, next_id(), "window.Judgely.closeModal();")
        time.sleep(0.5)
        
        # 2. Login View
        print("\n--- 2. Reviewing Login Experience ---")
        send_cmd(s, next_id(), "WebDriver:Navigate", {"url": "http://localhost:8080/login"})
        wait_for_element(s, next_id, "#btn-demo-organizer", 10)
        time.sleep(0.5)
        take_shot(s, next_id(), "/tmp/review_login.png")
        
        # 3. Organizer Command Center (9 Tabs)
        print("\n--- 3. Reviewing Organizer Command Center (All 9 Tabs) ---")
        exec_js(s, next_id(), "document.querySelector('#btn-demo-organizer').click();")
        wait_for_element(s, next_id, "#organizer-tabs-nav", 10)
        time.sleep(1.5)
        take_shot(s, next_id(), "/tmp/review_organizer_overview.png")
        
        tabs = ['projects', 'teams', 'judges', 'assignments', 'health', 'results', 'audit', 'settings']
        for tab in tabs:
            print(f"Checking Organizer tab: {tab}")
            exec_js(s, next_id(), f"document.querySelector('button[data-tab=\"{tab}\"]').click();")
            time.sleep(1.5)
            # Check for error banners
            has_error = exec_js(s, next_id(), "return Boolean(document.querySelector('.error-banner-box'));")
            if has_error:
                err_text = exec_js(s, next_id(), "return document.querySelector('.error-banner-box').innerText;")
                print(f"  [ERROR BANNER ON {tab}]: {err_text}")
            take_shot(s, next_id(), f"/tmp/review_organizer_{tab}.png")
            
        # 4. Judge Experience & Live Rubric Evaluation
        print("\n--- 4. Reviewing Judge Experience ---")
        exec_js(s, next_id(), "document.querySelector('#btn-header-signout')?.click();")
        time.sleep(1)
        send_cmd(s, next_id(), "WebDriver:Navigate", {"url": "http://localhost:8080/login"})
        wait_for_element(s, next_id, "#btn-demo-judge", 10)
        exec_js(s, next_id(), "document.querySelector('#btn-demo-judge')?.click();")
        wait_for_element(s, next_id, "#judge-workspace-grid", 10)
        time.sleep(1.5)
        take_shot(s, next_id(), "/tmp/review_judge_queue.png")
        
        # Interact with rubric sliders and check score
        exec_js(s, next_id(), """
            const numInputs = document.querySelectorAll('.score-number-input');
            if (numInputs.length >= 2) {
                numInputs[0].value = 4.5;
                numInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
                numInputs[1].value = 4.0;
                numInputs[1].dispatchEvent(new Event('input', { bubbles: true }));
            }
            const comment = document.querySelector('#judge-comments');
            if (comment) {
                comment.value = "Outstanding architectural execution, clear separation of concerns, and robust error handling.";
                comment.dispatchEvent(new Event('input', { bubbles: true }));
            }
        """)
        time.sleep(1)
        take_shot(s, next_id(), "/tmp/review_judge_evaluation.png")
        
        # 5. Participant Experience & Modals
        print("\n--- 5. Reviewing Participant Experience ---")
        exec_js(s, next_id(), "document.querySelector('#btn-header-signout')?.click();")
        time.sleep(1)
        send_cmd(s, next_id(), "WebDriver:Navigate", {"url": "http://localhost:8080/login"})
        wait_for_element(s, next_id, "#btn-demo-participant", 10)
        exec_js(s, next_id(), "document.querySelector('#btn-demo-participant')?.click();")
        wait_for_element(s, next_id, "#participant-content-area", 10)
        time.sleep(1.5)
        take_shot(s, next_id(), "/tmp/review_participant_dashboard.png")
        
        # Open Project Submission / Edit Modal
        exec_js(s, next_id(), """
            const btn = document.querySelector('#btn-edit-submission') || document.querySelector('#btn-open-submit-modal');
            if (btn) btn.click();
        """)
        time.sleep(1)
        take_shot(s, next_id(), "/tmp/review_participant_modal.png")
        
        print("\n=== All Experiences Evaluated and Captured Successfully ===")
        
    finally:
        s.close()
        proc.terminate()
        proc.wait()

if __name__ == "__main__":
    run()

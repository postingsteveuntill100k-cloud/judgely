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
    return res

def take_shot(s, msg_id, out_path):
    res = send_cmd(s, msg_id, "WebDriver:TakeScreenshot", {"full": True})
    b64 = res[3].get("value")
    if b64:
        with open(out_path, "wb") as f:
            f.write(base64.b64decode(b64))
        print(f"Captured: {out_path} ({os.path.getsize(out_path)} bytes)")
    else:
        print(f"Failed screenshot for {out_path}:", res)

def run_suite():
    tmp_prof = f"/tmp/ff_prof_suite_{int(time.time()*1000)}"
    os.makedirs(tmp_prof, exist_ok=True)
    
    proc = subprocess.Popen([
        "firefox", "--headless", "--marionette", "--no-remote",
        "--profile", tmp_prof
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    time.sleep(2)
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    msg_counter = 1
    
    try:
        s.connect(('127.0.0.1', 2828))
        # Handshake
        hs = b""
        while b":" not in hs:
            hs += s.recv(1024)
        h_len, h_rest = hs.split(b":", 1)
        while len(h_rest) < int(h_len):
            h_rest += s.recv(int(h_len) - len(h_rest))
            
        msg_counter += 1
        send_cmd(s, msg_counter, "WebDriver:NewSession", {})
        
        msg_counter += 1
        send_cmd(s, msg_counter, "WebDriver:SetWindowRect", {"width": 1440, "height": 900})
        
        # 1. Public View
        print("--- 1. Testing Public View ---")
        msg_counter += 1
        send_cmd(s, msg_counter, "WebDriver:Navigate", {"url": "http://localhost:8080/"})
        time.sleep(2)
        take_shot(s, msg_counter, "/tmp/review_public.png")
        
        # 2. Login View
        print("--- 2. Testing Login View ---")
        msg_counter += 1
        send_cmd(s, msg_counter, "WebDriver:Navigate", {"url": "http://localhost:8080/login"})
        time.sleep(2)
        take_shot(s, msg_counter, "/tmp/review_login.png")
        
        # 3. Organizer All Tabs
        print("--- 3. Testing Organizer Experience (All 9 Tabs) ---")
        msg_counter += 1
        exec_js(s, msg_counter, "document.querySelector('#btn-demo-organizer')?.click();")
        time.sleep(2.5)
        
        tabs = ['overview', 'projects', 'teams', 'judges', 'assignments', 'health', 'results', 'audit', 'settings']
        for tab in tabs:
            msg_counter += 1
            exec_js(s, msg_counter, f"""
                const btn = document.querySelector(`button[data-tab="{tab}"]`);
                if (btn) btn.click();
            """)
            time.sleep(1.8)
            take_shot(s, msg_counter, f"/tmp/review_organizer_{tab}.png")
            
        # 4. Judge Experience & Review Modal
        print("--- 4. Testing Judge Experience & Evaluation Review Modal ---")
        msg_counter += 1
        send_cmd(s, msg_counter, "WebDriver:Navigate", {"url": "http://localhost:8080/login"})
        time.sleep(1.5)
        msg_counter += 1
        exec_js(s, msg_counter, "document.querySelector('#btn-demo-judge')?.click();")
        time.sleep(2.5)
        take_shot(s, msg_counter, "/tmp/review_judge_queue.png")
        
        # Click the first assigned project or review action if available
        msg_counter += 1
        res = exec_js(s, msg_counter, """
            const item = document.querySelector('.assignment-card, .queue-item, .project-card, [data-project-id], tr[data-id]');
            if (item) {
                item.click();
                return 'clicked_item';
            }
            return 'no_item';
        """)
        print("Judge item click:", res)
        time.sleep(1.5)
        take_shot(s, msg_counter, "/tmp/review_judge_evaluation.png")
        
        # 5. Participant Experience & Team / Submission
        print("--- 5. Testing Participant Experience ---")
        msg_counter += 1
        send_cmd(s, msg_counter, "WebDriver:Navigate", {"url": "http://localhost:8080/login"})
        time.sleep(1.5)
        msg_counter += 1
        exec_js(s, msg_counter, "document.querySelector('#btn-demo-participant')?.click();")
        time.sleep(2.5)
        take_shot(s, msg_counter, "/tmp/review_participant_dashboard.png")
        
        # Click Edit/Submit project if available
        msg_counter += 1
        res = exec_js(s, msg_counter, """
            const btn = document.querySelector('#btn-edit-submission, #btn-create-project, button:contains("Project"), .action-btn');
            if (btn) { btn.click(); return 'clicked_btn'; }
            const buttons = Array.from(document.querySelectorAll('button'));
            const subBtn = buttons.find(b => b.innerText.includes('Submission') || b.innerText.includes('Project') || b.innerText.includes('Team'));
            if (subBtn) { subBtn.click(); return 'found_sub_btn: ' + subBtn.innerText; }
            return 'none';
        """)
        print("Participant button click:", res)
        time.sleep(1.5)
        take_shot(s, msg_counter, "/tmp/review_participant_modal.png")
        
        print("=== Complete Suite Finished Successfully ===")
        
    finally:
        s.close()
        proc.terminate()
        proc.wait()

if __name__ == "__main__":
    run_suite()

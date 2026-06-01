import os
import sys
import subprocess
import re

def kill_port(port):
    print(f"Checking for processes on port {port}...")
    try:
        output = subprocess.check_output("netstat -aon", shell=True).decode('utf-8', errors='ignore')
        pids = set()
        for line in output.splitlines():
            if f":{port}" in line and "LISTENING" in line:
                parts = line.strip().split()
                if len(parts) >= 5:
                    pid = parts[-1]
                    pids.add(int(pid))
        
        for pid in pids:
            print(f"Killing process with PID {pid} on port {port}...")
            subprocess.run(f"taskkill /F /PID {pid}", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as e:
        print(f"Error killing port {port}: {e}")

def kill_listener():
    print("Checking for desktop_listener.py processes...")
    try:
        ps_cmd = "powershell -Command \"Get-CimInstance Win32_Process -Filter \\\"Name = 'python.exe'\\\" | Select-Object ProcessId, CommandLine | ConvertTo-Json\""
        output = subprocess.check_output(ps_cmd, shell=True).decode('utf-8', errors='ignore')
        
        import json
        try:
            data = json.loads(output)
        except Exception:
            data = [json.loads(output)] if output.strip() else []
            
        if not isinstance(data, list):
            data = [data]
            
        for item in data:
            cmd = item.get("CommandLine") or ""
            pid = item.get("ProcessId")
            if "desktop_listener.py" in cmd and pid:
                print(f"Killing desktop_listener.py process with PID {pid}...")
                subprocess.run(f"taskkill /F /PID {pid}", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as e:
        print(f"Error killing listener process: {e}")

if __name__ == "__main__":
    kill_port(8000)
    kill_listener()
    print("Cleanup completed.")

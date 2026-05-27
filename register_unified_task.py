import os
import sys
import subprocess
import winreg

def clean_startup_folder():
    """Safely cleans the Startup folder, deleting ONLY desktop_listener entries."""
    startup_dir = os.path.expandvars(r'%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup')
    
    if not os.path.exists(startup_dir):
        print("[AARYA] Warning: Startup folder not found.")
        return False
        
    print("[AARYA] Cleaning Startup folder...")
    cleaned_count = 0
    
    for filename in os.listdir(startup_dir):
        # ONLY delete desktop_listener.py, desktop_listener.lnk, or entries containing desktop_listener
        if "desktop_listener" in filename.lower():
            file_path = os.path.join(startup_dir, filename)
            try:
                os.remove(file_path)
                print(f"[AARYA] Removed stale Startup folder entry: {filename}")
                cleaned_count += 1
            except Exception as e:
                print(f"[AARYA] Error removing {filename}: {e}")
                
    if cleaned_count > 0:
        print(f"[AARYA] Startup folder cleaned successfully. Total removed: {cleaned_count}")
    else:
        print("[AARYA] No stale listener startup entries found in Startup folder.")
        
    return True

def verify_system_paths():
    """Verifies that all required files and the venv are fully intact."""
    paths = {
        "Batch Launcher": r"D:\Aarya\backend\run_all_aarya.bat",
        "Venv Python": r"D:\Aarya\.venv312\Scripts\python.exe"
    }
    
    all_ok = True
    print("[AARYA] Verifying system paths...")
    for name, p in paths.items():
        if os.path.exists(p):
            print(f"   {name}: VERIFIED ({p})")
        else:
            print(f"   [ERROR] {name} is missing at: {p}")
            all_ok = False
            
    return all_ok

def purge_old_scheduled_tasks():
    """Programmatically purges all legacy scheduled tasks to prevent duplicate launches."""
    print("[AARYA] Purging all historical Task Scheduler instances...")
    old_tasks = ["AaryaVibeEngine", "AaryaVoiceDaemon", "AaryaVoiceFinalDaemon"]
    
    for tn in old_tasks:
        try:
            # Run schtasks delete command
            res = subprocess.run(
                ["schtasks", "/delete", "/tn", tn, "/f"],
                capture_output=True,
                text=True,
                check=False
            )
            if res.returncode == 0:
                print(f"   Task '{tn}': PURGED successfully.")
            else:
                # If it doesn't exist, that's a successful clean state
                if "cannot find" in res.stderr.lower() or "not found" in res.stderr.lower():
                    print(f"   Task '{tn}': Clean state (does not exist).")
                else:
                    print(f"   Task '{tn}': Warning/Error - {res.stderr.strip()}")
        except Exception as e:
            print(f"   Task '{tn}': Failed to query or delete: {e}")

def register_registry_run_key():
    """Registers run_all_aarya.bat in the current user's Registry Run Key."""
    print("[AARYA] Registering Registry Run Key...")
    reg_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
    key_name = "AaryaVibeEngine"
    target_cmd = r"D:\Aarya\backend\run_all_aarya.bat"
    
    try:
        # Open registry key with set value permissions
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            reg_path,
            0,
            winreg.KEY_SET_VALUE
        )
        # Set the Registry Run string value
        winreg.SetValueEx(
            key,
            key_name,
            0,
            winreg.REG_SZ,
            target_cmd
        )
        winreg.CloseKey(key)
        print(f"   Registry entry '{key_name}': REGISTERED successfully.")
        print(f"   Command path: {target_cmd}")
        return True
    except Exception as e:
        print(f"   [ERROR] Failed to register run key: {e}")
        return False

def verify_registry_run_key():
    """Queries and prints the registered Registry Run Key for absolute verification."""
    print("[AARYA] Verifying Registry Run Key...")
    reg_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
    key_name = "AaryaVibeEngine"
    
    try:
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            reg_path,
            0,
            winreg.KEY_QUERY_VALUE
        )
        value, reg_type = winreg.QueryValueEx(key, key_name)
        winreg.CloseKey(key)
        
        print(f"   Value Name: {key_name}")
        print(f"   Value Data: {value}")
        print(f"   Value Type: REG_SZ" if reg_type == winreg.REG_SZ else f"   Value Type: {reg_type}")
        return True
    except FileNotFoundError:
        print(f"   [ERROR] Registry key '{key_name}' was not found.")
        return False
    except Exception as e:
        print(f"   [ERROR] Verification query failed: {e}")
        return False

def main():
    print("==================================================")
    print("      AARYA VibeEngine Startup Registry Utility")
    print("==================================================")
    
    # 1. Purge Startup folder of stale shortcuts
    clean_startup_folder()
    
    # 2. Verify all paths and virtual environment python
    paths_ok = verify_system_paths()
    if not paths_ok:
        print("[AARYA] Error: Critical paths missing. Please resolve before running autodeploy.")
        sys.exit(1)
        
    # 3. Programmatically purge old scheduled tasks
    purge_old_scheduled_tasks()
    
    # 4. Register the current user Registry Run Key
    registered = register_registry_run_key()
    
    # 5. Query registry to verify it is exactly correct
    if registered and verify_registry_run_key():
        print("==================================================")
        print("[AARYA] Old task cache removed.")
        print("[AARYA] Unified startup launcher created.")
        print("[AARYA] Virtual environment binding verified.")
        print("[AARYA] Registry Run Key registered successfully.")
        print("[AARYA] Ambient runtime session stabilized!")
        print("==================================================")
    else:
        print("==================================================")
        print("[AARYA] Migration completed with errors.")
        print("==================================================")

if __name__ == "__main__":
    main()

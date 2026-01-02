import tkinter as tk
from tkinter import messagebox
import threading
import time
import os
import pygetwindow as gw
import win32gui
from solver import CardSolver

class SolverApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Card Match Solver")
        self.geometry("400x300")
        
        # Solver setup
        self.locations_path = "card_locations.json"
        self.video_path = "7kMinigames/Minigames_entry.mp4" # Placeholder
        self.template_path = "7kMinigames/BackCard.png"
        self.solver = CardSolver(self.locations_path, self.video_path, self.template_path)
        
        self.stop_event = threading.Event()
        self.solver_thread = None
        self.target_window = None  # Store window reference instead of static coordinates
        
        # UI Elements
        self.status_label = tk.Label(self, text="Status: Ready", font=("Arial", 12))
        self.status_label.pack(pady=20)
        
        self.calibrate_btn = tk.Button(self, text="Calibrate (3s Timer)", command=self.start_calibration, height=2, width=30)
        self.calibrate_btn.pack(pady=5)
        
        self.start_btn = tk.Button(self, text="Start Solver", command=self.start_solver, height=2, width=30, state=tk.DISABLED)
        self.start_btn.pack(pady=5)
        
        self.stop_btn = tk.Button(self, text="Stop", command=self.stop_solver, height=2, width=30, state=tk.DISABLED)
        self.stop_btn.pack(pady=5)
        
        self.show_btn = tk.Button(self, text="Show Solved", command=self.show_solved, height=2, width=30)
        self.show_btn.pack(pady=5)
        
    def update_status(self, text):
        self.status_label.config(text=f"Status: {text}")
        
    def start_calibration(self):
        self.calibrate_btn.config(state=tk.DISABLED)
        threading.Thread(target=self._calibration_logic, daemon=True).start()

    def get_current_window_region(self):
        """Get current window CLIENT area position and handle (excludes borders/title bar)."""
        if not self.target_window:
            return None
        
        try:
            import win32gui
            # Refresh window data to get current position
            windows = gw.getWindowsWithTitle(self.target_window.title)
            if windows:
                win = windows[0]
                hwnd = win._hWnd
                
                # Get client area rectangle (excludes title bar and borders)
                client_rect = win32gui.GetClientRect(hwnd)
                # Convert client coordinates to screen coordinates
                client_point = win32gui.ClientToScreen(hwnd, (0, 0))
                
                # Client area dimensions
                width = client_rect[2] - client_rect[0]
                height = client_rect[3] - client_rect[1]
                
                return (client_point[0], client_point[1], width, height, hwnd)
        except Exception as e:
            print(f"Error getting window region: {e}")
            # Fallback to original method
            try:
                windows = gw.getWindowsWithTitle(self.target_window.title)
                if windows:
                    win = windows[0]
                    hwnd = win._hWnd
                    return (win.left, win.top, win.width, win.height, hwnd)
            except:
                pass
        return None

    def _calibration_logic(self):
        try:
            for i in range(3, 0, -1):
                self.update_status(f"Switch to Game Window! {i}...")
                time.sleep(1)
            
            self.update_status("Capturing Window...")
            time.sleep(0.5)
            
            window = gw.getActiveWindow()
            if window:
                self.target_window = window  # Store window reference
                self.update_status(f"Calibrated: {window.title} ({window.width}x{window.height})")
                self.start_btn.config(state=tk.NORMAL)
            else:
                self.update_status("Calibration Failed: No active window found")
                
        except Exception as e:
            self.update_status(f"Error: {str(e)}")
        finally:
            self.calibrate_btn.config(state=tk.NORMAL)

    def start_solver(self):
        if not self.target_window:
            messagebox.showerror("Error", "Please calibrate first!")
            return
            
        self.stop_event.clear()
        self.start_btn.config(state=tk.DISABLED)
        self.stop_btn.config(state=tk.NORMAL)
        self.calibrate_btn.config(state=tk.DISABLED)
        
        self.solver_thread = threading.Thread(target=self._run_solver, daemon=True)
        self.solver_thread.start()
        
    def _run_solver(self):
        try:
            self.solver.solve_screen_session(
                self.get_current_window_region,  # Pass callback instead of static region
                self.update_status, 
                self.stop_event
            )
        except Exception as e:
            self.update_status(f"Error: {str(e)}")
            print(e)
        finally:
            self.start_btn.config(state=tk.NORMAL)
            self.stop_btn.config(state=tk.DISABLED)
            self.calibrate_btn.config(state=tk.NORMAL)

    def stop_solver(self):
        if self.solver_thread and self.solver_thread.is_alive():
            self.stop_event.set()
            self.update_status("Stopping...")
            
    def show_solved(self):
        path = "solved_pairs.png"
        if os.path.exists(path):
            try:
                # Use Windows start command to open with default viewer (no terminal flash)
                os.startfile(os.path.abspath(path))
            except Exception as e:
                messagebox.showerror("Error", f"Could not open image: {e}")
        else:
            messagebox.showinfo("Info", "No solution found yet.")

if __name__ == "__main__":
    app = SolverApp()
    app.mainloop()

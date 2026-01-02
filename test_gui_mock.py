import unittest
from unittest.mock import MagicMock, patch
import tkinter as tk
import threading
import time
from gui import SolverApp

class TestSolverApp(unittest.TestCase):
    def setUp(self):
        self.app = SolverApp()
        # Mock the solver to avoid actual OpenCV/Screen operations
        self.app.solver = MagicMock()
        
    def tearDown(self):
        self.app.destroy()

    @patch('gui.gw')
    def test_calibration_mock(self, mock_gw):
        # Setup mock window
        mock_window = MagicMock()
        mock_window.left = 100
        mock_window.top = 100
        mock_window.width = 800
        mock_window.height = 600
        mock_window.title = "Mock Game Window"
        mock_gw.getActiveWindow.return_value = mock_window
        
        print("\nTesting Calibration Logic...")
        # Simulate calibration click by calling logic directly to avoid threading/mock issues
        # We need to bypass the sleep for speed in test
        with patch('time.sleep', return_value=None):
             self.app._calibration_logic()
        
        # Verify results
        self.assertIsNotNone(self.app.capture_region)
        self.assertEqual(self.app.capture_region, (100, 100, 800, 600))
        print("Calibration successful. Region:", self.app.capture_region)
        
        # Verify Start button is enabled
        self.assertEqual(self.app.start_btn['state'], tk.NORMAL)

    def test_start_stop_solver(self):
        print("\nTesting Start/Stop Logic...")
        # Manually set region to skip calibration
        self.app.capture_region = (0, 0, 100, 100)
        
        # Start solver
        self.app.start_solver()
        self.assertTrue(self.app.solver_thread.is_alive())
        self.assertEqual(self.app.start_btn['state'], tk.DISABLED)
        self.assertEqual(self.app.stop_btn['state'], tk.NORMAL)
        print("Solver started.")
        
        # Stop solver
        self.app.stop_solver()
        self.app.stop_event.wait(timeout=1)
        self.assertTrue(self.app.stop_event.is_set())
        print("Solver stop signal sent.")

if __name__ == '__main__':
    unittest.main()

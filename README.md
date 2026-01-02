# 7k Card Matching Solver

A powerful agentic AI-powered tool for solving card matching minigames with high precision and dynamic resolution support.

## Features

- **Dynamic Resolution Support**: Automatically detects card locations regardless of window size or aspect ratio.
- **Robust Face Extraction**: Uses advanced filtering to handle overexposure and flashes.
- **High Accuracy**: Consistently identifies 12/12 pairs using template matching and greedy selection.
- **Record & Replay Logic**: Captures a short sequence of gameplay to ensure stable edge-case handling.
- **User-Friendly GUI**: Simple interface for calibration and execution.

## Installation

### Prerequisites

- Python 3.8+
- OpenCV (`opencv-python`)
- NumPy
- Pillow
- pygetwindow
- pywin32

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/mwarot1/7k-card-matching-solver.git
   cd 7k-card-matching-solver
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

## Usage

1. Run the GUI:
   ```bash
   python gui.py
   ```
2. Click **Calibrate** and switch to your game window within 3 seconds.
3. Click **Start Solver** once the game starts.
4. After processing, click **Show Solved** to see the results.

## Building the Executable

To build a standalone `.exe` file for Windows:

1. Install PyInstaller:
   ```bash
   pip install pyinstaller
   ```
2. Run the build command:
   ```bash
   pyinstaller --onefile --name CardSolverV2 --noconsole gui.py
   ```
3. The executable will be generated in the `dist/` folder.
4. **Important**: When distributing, ensure the `7kMinigames/` folder and `card_locations.json` are in the same directory as the `.exe`.

## Technical Details

The solver process follows these stages:
1. **Cumulative Grid Detection**: Analyzes frames to build a robust 24-card grid.
2. **State Synchronization**: Waits for a stable "all face-down" state to establish a per-card baseline.
3. **Face Extraction**: Monitors for changes against the baseline, filtering for optimal brightness.
4. **Greedy Pair Matching**: Calculates correlation scores between all discovered faces and selects the most likely 12 pairs.

## Credits

Developed by **Mwarot1**.
